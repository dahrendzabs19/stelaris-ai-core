// ============================================================================
// Stelaris AI — OpenAI Provider Adapter
// ============================================================================
//
// This adapter implements the AIProvider interface for the OpenAI REST API.
//
// OpenAI API documentation:
//   - Chat Completions: POST /v1/chat/completions
//   - Embeddings:       POST /v1/embeddings
//   - List models:      GET  /v1/models  (used for health checks)
//
// All OpenAI-specific request/response formats are converted to and from
// the generic contracts defined in src/core/ai/types.ts.
// ============================================================================

import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  StreamEvent,
  EmbeddingRequest,
  EmbeddingResponse,
  HealthStatus,
  ProviderId,
  ModelId,
  ModelDescriptor,
  TokenUsage,
  FinishReason,
  ContentPart,
  Message,
} from "@/core/ai/types";

import type { OpenAIConfig } from "@/core/config/config";
import type { Logger } from "@/core/logging/logger";
import { fetchWithRetry } from "@/infrastructure/http/fetch-with-retry";

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

/**
 * Extended configuration for the OpenAI provider.
 *
 * Extends the core OpenAIConfig with an optional custom base URL.
 * The API key is required — no hardcoded defaults.
 */
export interface OpenAIProviderConfig extends OpenAIConfig {
  /** Base URL of the OpenAI API (defaults to "https://api.openai.com/v1") */
  baseUrl?: string;
  /** Timeout in milliseconds for all outbound HTTP requests */
  timeoutMs: number;
  /** Maximum number of retries for transient failures */
  retryCount: number;
}

// ----------------------------------------------------------------------------
// OpenAI API Types (internal to this adapter)
// ----------------------------------------------------------------------------

interface OpenAIMessage {
  role: string;
  content: string | OpenAIContentPart[];
  name?: string;
}

interface OpenAITextContentPart {
  type: "text";
  text: string;
}

interface OpenAIImageContentPart {
  type: "image_url";
  image_url: { url: string };
}

type OpenAIContentPart = OpenAITextContentPart | OpenAIImageContentPart;

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream: boolean;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  max_tokens?: number;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIResponseMessage {
  role: string;
  content: string;
}

interface OpenAIChoice {
  index: number;
  message: OpenAIResponseMessage;
  finish_reason: string;
}

interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: OpenAIUsage;
}

interface OpenAIStreamChoice {
  index: number;
  delta: {
    content?: string;
    role?: string;
  };
  finish_reason: string | null;
}

interface OpenAIStreamPayload {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIStreamChoice[];
  usage?: OpenAIUsage;
}

interface OpenAIEmbedRequest {
  input: string | string[];
  model: string;
}

interface OpenAIEmbedData {
  object: string;
  index: number;
  embedding: number[];
}

interface OpenAIEmbedResponse {
  object: string;
  data: OpenAIEmbedData[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

// ----------------------------------------------------------------------------
// Error Helpers
// ----------------------------------------------------------------------------

class OpenAIAPIError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "OpenAIAPIError";
  }
}

class OpenAIConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIConfigurationError";
  }
}

// ----------------------------------------------------------------------------
// Model Mappings
// ----------------------------------------------------------------------------

function mapFinishReason(reason: string | null | undefined): FinishReason {
  if (reason === "stop") return "stop";
  if (reason === "length") return "length";
  if (reason === "tool_calls") return "tool-calls";
  if (reason === "content_filter") return "content-filter";
  return "stop";
}

function toOpenAIContentPart(part: ContentPart): OpenAIContentPart {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "image":
      return {
        type: "image_url",
        image_url: {
          url:
            part.source.type === "url"
              ? part.source.url
              : `data:${part.source.mediaType};base64,${part.source.data}`,
        },
      };
    case "tool-call":
    case "tool-result":
      throw new OpenAIConfigurationError(
        "OpenAI tool-call content is not supported by this adapter yet",
      );
  }
}

function toOpenAIMessage(msg: Message): OpenAIMessage {
  return {
    role: msg.role,
    content: msg.content.map(toOpenAIContentPart),
    name: msg.name,
  };
}

function toTokenUsage(usage: OpenAIUsage): TokenUsage {
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

// ----------------------------------------------------------------------------
// OpenAI Provider
// ----------------------------------------------------------------------------

export class OpenAIProvider implements AIProvider {
  readonly id: ProviderId = "openai" as ProviderId;
  readonly name = "OpenAI";
  readonly models: ModelDescriptor[];

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly log: Logger;

  constructor(config: OpenAIProviderConfig, log: Logger) {
    if (!config.apiKey) {
      throw new OpenAIConfigurationError(
        "OpenAIProvider requires an apiKey in its configuration",
      );
    }

    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(
      /\/+$/,
      "",
    );
    this.timeoutMs = config.timeoutMs;
    this.retryCount = config.retryCount;
    this.log = log;
    this.models = this.buildModels();
  }

  private buildModels(): ModelDescriptor[] {
    return [
      {
        id: "gpt-4.1" as ModelId,
        name: "GPT-4.1",
        provider: this.id,
        capabilities: {
          streaming: true,
          functionCalling: true,
          vision: true,
          embeddings: false,
          maxOutputTokens: 32768,
          maxContextLength: 200000,
        },
        costPer1KTokens: { input: 2, output: 8 },
        qualityScore: 0.97,
      },
      {
        id: "gpt-4.1-mini" as ModelId,
        name: "GPT-4.1 Mini",
        provider: this.id,
        capabilities: {
          streaming: true,
          functionCalling: true,
          vision: true,
          embeddings: false,
          maxOutputTokens: 16384,
          maxContextLength: 200000,
        },
        costPer1KTokens: { input: 0.4, output: 1.6 },
        qualityScore: 0.92,
      },
      {
        id: "gpt-4o" as ModelId,
        name: "GPT-4o",
        provider: this.id,
        capabilities: {
          streaming: true,
          functionCalling: true,
          vision: true,
          embeddings: false,
          maxOutputTokens: 16384,
          maxContextLength: 128000,
        },
        costPer1KTokens: { input: 2.5, output: 10 },
        qualityScore: 0.95,
      },
      {
        id: "gpt-4o-mini" as ModelId,
        name: "GPT-4o Mini",
        provider: this.id,
        capabilities: {
          streaming: true,
          functionCalling: true,
          vision: true,
          embeddings: false,
          maxOutputTokens: 16384,
          maxContextLength: 128000,
        },
        costPer1KTokens: { input: 0.15, output: 0.6 },
        qualityScore: 0.85,
      },
      {
        id: "text-embedding-3-small" as ModelId,
        name: "Text Embedding 3 Small",
        provider: this.id,
        capabilities: {
          streaming: false,
          functionCalling: false,
          vision: false,
          embeddings: true,
          maxOutputTokens: 1,
          maxContextLength: 8191,
        },
        costPer1KTokens: { input: 0.02, output: 0 },
        qualityScore: 0.8,
      },
      {
        id: "text-embedding-3-large" as ModelId,
        name: "Text Embedding 3 Large",
        provider: this.id,
        capabilities: {
          streaming: false,
          functionCalling: false,
          vision: false,
          embeddings: true,
          maxOutputTokens: 1,
          maxContextLength: 8191,
        },
        costPer1KTokens: { input: 0.13, output: 0 },
        qualityScore: 0.9,
      },
    ];
  }

  // --------------------------------------------------------------------------
  // Chat (Non-Streaming)
  // --------------------------------------------------------------------------

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!request.model) {
      throw new OpenAIConfigurationError(
        "OpenAIProvider.chat() requires a model in the request",
      );
    }

    this.log.info("OpenAI: chat request started", {
      provider: this.id,
      model: request.model,
    });

    const startTime = performance.now();

    const openaiRequest: OpenAIChatRequest = {
      model: request.model,
      messages: request.messages.map(toOpenAIMessage),
      stream: false,
      temperature: request.temperature,
      top_p: request.topP,
      stop: request.stop,
      max_tokens: request.maxTokens,
    };

    try {
      const data = await this.fetchOpenAI<OpenAIChatResponse>(
        "/chat/completions",
        openaiRequest,
        request.model,
      );

      const latencyMs = Math.round(performance.now() - startTime);

      const choice = data.choices[0];

      this.log.info("OpenAI: chat request finished", {
        provider: this.id,
        model: request.model,
        latencyMs,
      });

      return {
        message: {
          role: "assistant",
          content: [{ type: "text", text: choice.message.content }],
        },
        model: data.model as ModelId,
        usage: toTokenUsage(data.usage),
        finishReason: mapFinishReason(choice.finish_reason),
        provider: this.id,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);

      this.log.error("OpenAI: chat request failed", {
        provider: this.id,
        model: request.model,
        error: error instanceof Error ? error.name : "UnknownError",
        latencyMs,
      });

      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Stream
  // --------------------------------------------------------------------------

  async *stream(request: ChatRequest): AsyncIterable<StreamEvent> {
    if (!request.model) {
      throw new OpenAIConfigurationError(
        "OpenAIProvider.stream() requires a model in the request",
      );
    }

    this.log.info("OpenAI: stream request started", {
      provider: this.id,
      model: request.model,
    });

    const openaiRequest: OpenAIChatRequest = {
      model: request.model,
      messages: request.messages.map(toOpenAIMessage),
      stream: true,
      temperature: request.temperature,
      top_p: request.topP,
      stop: request.stop,
      max_tokens: request.maxTokens,
    };

    try {
      const response = await fetchWithRetry(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(openaiRequest),
        },
        this.timeoutMs,
        this.retryCount,
        this.log,
        { provider: this.id, model: request.model },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new OpenAIAPIError(
          `OpenAI stream API returned status ${response.status}: ${text}`,
          response.status,
          text,
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new OpenAIAPIError(
          "OpenAI stream response body is not readable",
        );
      }

      const decoder = new TextDecoder();
      let buffer = "";

      let finished = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const line = part.trim();
            if (!line || !line.startsWith("data: ")) continue;

            const payload = line.slice(6);

            if (payload === "[DONE]") {
              if (!finished) {
                yield {
                  type: "finish",
                  model: request.model,
                  provider: this.id,
                  finishReason: "stop",
                };
              }
              return;
            }

            const events = this.parseStreamEvents(payload);
            for (const event of events) {
              yield event;
              if (event.type === "finish") {
                finished = true;
                return;
              }
            }
          }
        }

        if (buffer.trim()) {
          const line = buffer.trim();
          if (line.startsWith("data: ")) {
            const payload = line.slice(6);
            if (payload !== "[DONE]") {
              const events = this.parseStreamEvents(payload);
              for (const event of events) {
                yield event;
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      this.log.info("OpenAI: stream request finished", {
        provider: this.id,
        model: request.model,
      });
    } catch (error) {
      this.log.error("OpenAI: stream request failed", {
        provider: this.id,
        model: request.model,
        error: error instanceof Error ? error.name : "UnknownError",
      });

      yield {
        type: "error",
        model: request.model,
        provider: this.id,
        error: {
          message: error instanceof Error ? error.message : "Unknown OpenAI stream error",
          code: error instanceof OpenAIAPIError ? String(error.status ?? "api-error") : undefined,
        },
      };
    }
  }

  private parseStreamEvents(payload: string): StreamEvent[] {
    try {
      const data: unknown = JSON.parse(payload);

      if (!this.isOpenAIStreamPayload(data)) return [];

      const choice = data.choices[0];
      const events: StreamEvent[] = [];

      if (choice?.delta?.content) {
        events.push({
          type: "text-delta",
          delta: choice.delta.content,
          model: data.model as ModelId,
          provider: this.id,
        });
      }

      if (data.usage) {
        events.push({
          type: "usage",
          usage: toTokenUsage(data.usage),
          model: data.model as ModelId,
          provider: this.id,
        });
      }

      if (choice?.finish_reason) {
        events.push({
          type: "finish",
          finishReason: mapFinishReason(choice.finish_reason),
          model: data.model as ModelId,
          provider: this.id,
        });
      }

      return events;
    } catch {
      return [];
    }
  }

  // --------------------------------------------------------------------------
  // Embed
  // --------------------------------------------------------------------------

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (!request.model) {
      throw new OpenAIConfigurationError(
        "OpenAIProvider.embed() requires a model in the request",
      );
    }

    this.log.info("OpenAI: embed request started", {
      provider: this.id,
      model: request.model,
    });

    const startTime = performance.now();

    const openaiRequest: OpenAIEmbedRequest = {
      input: request.input,
      model: request.model,
    };

    try {
      const data = await this.fetchOpenAI<OpenAIEmbedResponse>(
        "/embeddings",
        openaiRequest,
        request.model,
      );

      const latencyMs = Math.round(performance.now() - startTime);

      const sorted = [...data.data].sort((a, b) => a.index - b.index);

      this.log.info("OpenAI: embed request finished", {
        provider: this.id,
        model: request.model,
        latencyMs,
      });

      return {
        embeddings: sorted.map((e) => e.embedding),
        model: data.model as ModelId,
        usage: {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: 0,
          totalTokens: data.usage.total_tokens,
        },
        provider: this.id,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);

      this.log.error("OpenAI: embed request failed", {
        provider: this.id,
        model: request.model,
        error: error instanceof Error ? error.name : "UnknownError",
        latencyMs,
      });

      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------

  async health(): Promise<HealthStatus> {
    this.log.info("OpenAI: health check started", { provider: this.id });

    const startTime = performance.now();

    try {
      const response = await fetchWithRetry(
        `${this.baseUrl}/models`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        },
        this.timeoutMs,
        this.retryCount,
        this.log,
        { provider: this.id },
      );

      const latencyMs = Math.round(performance.now() - startTime);

      if (!response.ok) {
        this.log.warn("OpenAI: health check unhealthy", {
          provider: this.id,
          status: response.status,
          latencyMs,
        });

        return {
          healthy: false,
          provider: this.id,
          lastChecked: Date.now(),
          error: `OpenAI health check failed with status ${response.status}`,
          latencyMs,
        };
      }

      this.log.info("OpenAI: health check healthy", {
        provider: this.id,
        latencyMs,
      });

      return {
        healthy: true,
        provider: this.id,
        lastChecked: Date.now(),
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);

      this.log.warn("OpenAI: health check error", {
        provider: this.id,
        error: error instanceof Error ? error.name : "UnknownError",
        latencyMs,
      });

      return {
        healthy: false,
        provider: this.id,
        lastChecked: Date.now(),
        error:
          error instanceof Error
            ? error.message
            : "Unknown error during health check",
        latencyMs,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private async fetchOpenAI<T>(
    path: string,
    body: unknown,
    model: string,
  ): Promise<T> {
    const response = await fetchWithRetry(
      `${this.baseUrl}${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      this.timeoutMs,
      this.retryCount,
      this.log,
      { provider: this.id, model },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new OpenAIAPIError(
        `OpenAI API returned status ${response.status}: ${text}`,
        response.status,
        text,
      );
    }

    return response.json() as Promise<T>;
  }

  // --------------------------------------------------------------------------
  // Type Guards
  // --------------------------------------------------------------------------

  private isOpenAIStreamPayload(data: unknown): data is OpenAIStreamPayload {
    if (typeof data !== "object" || data === null) return false;
    const d = data as Record<string, unknown>;
    return (
      typeof d.model === "string" &&
      Array.isArray(d.choices)
    );
  }
}
