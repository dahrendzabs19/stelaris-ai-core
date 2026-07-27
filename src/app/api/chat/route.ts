import { gateway } from "@/core/bootstrap";
import type { ModelId, ProviderId } from "@/core/ai/types";

// ----------------------------------------------------------------------------
// Request Validation
// ----------------------------------------------------------------------------

interface ChatRequestBody {
  prompt?: unknown;
  model?: unknown;
}

interface ValidatedChatRequest {
  prompt: string;
  model: string | undefined;
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

  const { prompt, model } = body as ChatRequestBody;

  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new Error(
      'Invalid request: "prompt" must be a non-empty string',
    );
  }

  if (model !== undefined && typeof model !== "string") {
    throw new Error(
      'Invalid request: "model" must be a string if provided',
    );
  }

  return { prompt: prompt.trim(), model: model ?? undefined };
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
 * All AI behavior is delegated to the AI Core (Gateway → Registry → Provider).
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const { prompt, model } = validateBody(body);

    const response = await gateway.chat("ollama" as ProviderId, {
      model: model as ModelId | undefined,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    return Response.json({
      reply: response.message.content,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred";

    return Response.json({ error: message }, { status: 400 });
  }
}