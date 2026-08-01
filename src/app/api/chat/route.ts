import { createConfig } from "@/core/config/config";
import { createGateway } from "@/core/bootstrap";
import type { ContentPart, Message, ModelId, StreamEvent } from "@/core/ai/types";

// ----------------------------------------------------------------------------
// Gateway Initialization
// ----------------------------------------------------------------------------
//
// The gateway is created once at module load time using the factory.
// Configuration is read from environment variables via createConfig().
// This replaces the previous singleton export pattern.

const config = createConfig();
export const gateway = createGateway(config);

// ----------------------------------------------------------------------------
// Request Validation
// ----------------------------------------------------------------------------

interface ChatRequestBody {
  prompt?: unknown;
  model?: unknown;
  stream?: unknown;
}

interface ValidatedChatRequest {
  prompt: string;
  model: ModelId;
  stream: boolean;
}

/**
 * Validate the incoming HTTP request body.
 *
 * Returns a typed and validated request object, or throws a descriptive
 * error if required fields are missing or have the wrong type.
 */
function validateBody(body: unknown): ValidatedChatRequest {
  if (typeof body !== "object" || body === null) {
    throw new Error("Request body must be a JSON object");
  }

  const { prompt, model, stream } = body as ChatRequestBody;

  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new Error(
      'Invalid request: "prompt" must be a non-empty string',
    );
  }

  if (typeof model !== "string" || model.trim() === "") {
    throw new Error(
      'Invalid request: "model" must be a non-empty string',
    );
  }

  if (stream !== undefined && typeof stream !== "boolean") {
    throw new Error('Invalid request: "stream" must be a boolean if provided');
  }

  return { prompt: prompt.trim(), model: model as ModelId, stream: stream ?? false };
}

function createUserMessage(prompt: string): Message {
  const content: ContentPart[] = [{ type: "text", text: prompt }];
  return { role: "user", content };
}

function serializeStreamEvent(event: StreamEvent): string | null {
  switch (event.type) {
    case "text-delta":
    case "usage":
    case "finish":
    case "error":
      return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    case "tool-call-delta":
      return null;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

// ----------------------------------------------------------------------------
// POST /api/chat
// ----------------------------------------------------------------------------

/**
 * Handle chat completion requests.
 *
 * Responsibilities are limited to:
 *   1. HTTP — receive the request, return a response
 *   2. Validation — ensure the payload is well-formed
 *   3. Serialization — convert ChatResponse back to HTTP JSON
 *
 * All AI behavior is delegated to the AI Core (Gateway → Router → Provider).
 *
 * The provider is determined automatically from the model ID.
 * The route no longer specifies a provider — the ModelRegistry and
 * ProviderRouter handle resolution based on the model in the request.
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const { prompt, model, stream } = validateBody(body);

    const chatRequest = {
      model,
      messages: [createUserMessage(prompt)],
    };

    if (stream) {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          void (async () => {
            try {
              for await (const event of gateway.stream(chatRequest)) {
                const serialized = serializeStreamEvent(event);
                if (serialized) controller.enqueue(encoder.encode(serialized));
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : "An unexpected stream error occurred";
              controller.enqueue(
                encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`),
              );
            } finally {
              controller.close();
            }
          })();
        },
      });

      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const response = await gateway.chat(chatRequest);

    return Response.json({
      message: response.message,
      model: response.model,
      usage: response.usage,
      finishReason: response.finishReason,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred";

    return Response.json({ error: message }, { status: 400 });
  }
}
