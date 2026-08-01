// ============================================================================
// Stelaris AI Core — Foundational Types
// ============================================================================
//
// This file defines the core contracts for the AI platform.
// It is the single source of truth for all AI-related types.
//
// Rules:
//   - Zero dependencies (no Next.js, React, fetch, or external libraries)
//   - Provider-agnostic (works with Ollama, OpenAI, Claude, Gemini, and local models)
//   - No implementation logic
//   - No default values
//   - No side effects
// ============================================================================

// ----------------------------------------------------------------------------
// Identifiers
// ----------------------------------------------------------------------------

/**
 * Unique identifier for an AI provider.
 *
 * Examples: "ollama", "openai", "claude", "gemini"
 *
 * Using a branded string type instead of an enum allows:
 * - Easy addition of new providers without modifying this file
 * - Runtime flexibility (providers can be registered dynamically)
 * - Type safety when used in function signatures
 */
export type ProviderId = string & { readonly __brand: "ProviderId" };

/**
 * Unique identifier for an AI model.
 *
 * Examples: "qwen3:8b", "qwen2.5-coder:7b", "gpt-4o", "claude-3-opus"
 *
 * Models are identified by string rather than enum because:
 * - New models are released frequently
 * - Different providers have different model naming conventions
 * - Users may run custom/local models with arbitrary names
 */
export type ModelId = string & { readonly __brand: "ModelId" };

// ----------------------------------------------------------------------------
// Roles
// ----------------------------------------------------------------------------

/**
 * The role of a participant in a conversation.
 *
 * - "system":    Instructions that set the behavior of the AI
 * - "user":      End-user input
 * - "assistant": AI-generated response
 * - "tool":      Result of a tool/function call (used in function-calling flows)
 */
export type MessageRole = "system" | "developer" | "user" | "assistant" | "tool";

// ----------------------------------------------------------------------------
// Messages
// ----------------------------------------------------------------------------

/**
 * A provider-agnostic unit of conversational input or output.
 *
 * A message is intentionally composed from content parts rather than a single
 * string. Provider adapters translate these canonical parts to and from their
 * native wire formats.
 */
export interface Message {
  /** The role of the message sender */
  role: MessageRole;

  /** Ordered, multimodal content carried by the message. */
  content: ContentPart[];

  /**
   * Optional name for a provider-supported message participant.
   *
   * Tool-call correlation is represented by ToolCallPart and ToolResultPart,
   * not by a message-level field.
   */
  name?: string;
}

/** Plain UTF-8 text content. */
export interface TextPart {
  type: "text";
  text: string;
}

/** A remotely accessible image. */
export interface ImageUrlSource {
  type: "url";
  url: string;
  mediaType?: string;
}

/** An inline base64-encoded image. */
export interface ImageBase64Source {
  type: "base64";
  data: string;
  mediaType: string;
}

/** A provider-neutral image input. */
export interface ImagePart {
  type: "image";
  source: ImageUrlSource | ImageBase64Source;
}

/** A requested invocation of a named tool. */
export interface ToolCallPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  arguments: unknown;
}

/** The result corresponding to a prior tool invocation. */
export interface ToolResultPart {
  type: "tool-result";
  toolCallId: string;
  result: unknown;
  isError?: boolean;
}

/**
 * Canonical content supported by the protocol.
 *
 * Reasoning is deliberately not represented here. It is reserved for a future
 * protocol revision and must not leak provider-specific reasoning formats.
 */
export type ContentPart = TextPart | ImagePart | ToolCallPart | ToolResultPart;

// ----------------------------------------------------------------------------
// Requests
// ----------------------------------------------------------------------------

/**
 * A request to generate a chat completion.
 *
 * This is the primary input type for the AI Gateway.
 * All provider adapters translate this to their native format.
 */
export interface ChatRequest {
  /** The conversation messages (system prompt + history + latest input) */
  messages: Message[];

  /**
   * The model to use for generation.
   *
   * Model selection is explicit so routing is deterministic and independent of
   * provider defaults.
   */
  model: ModelId;

  /**
   * Sampling temperature (0.0 to 2.0).
   * Lower values = more deterministic, higher values = more creative.
   * Default is provider-specific (usually 0.7 or 1.0).
   */
  temperature?: number;

  /**
   * Maximum number of tokens to generate.
   * Cuts off response after this many tokens.
   */
  maxTokens?: number;

  /**
   * Top-p sampling (nucleus sampling).
   * 0.1 means only tokens with top 10% probability mass are considered.
   */
  topP?: number;

  /**
   * Stop sequences — the model will stop generating when it encounters these.
   */
  stop?: string[];

  /**
   * Whether to stream the response token-by-token.
   * If true, use the `stream()` method instead of `chat()`.
   */
  stream?: boolean;

  /**
   * Optional unique identifier for the request.
   * Used for idempotency, logging, and tracing.
   */
  requestId?: string;
}

/**
 * A request to generate embeddings (vector representations of text).
 *
 * Embeddings are used for:
 * - Semantic search / RAG
 * - Clustering
 * - Classification
 * - Similarity comparison
 */
export interface EmbeddingRequest {
  /** The text(s) to embed. Can be a single string or an array. */
  input: string | string[];

  /** The model to use for embedding. */
  model: ModelId;

  /** Optional unique identifier for the request. */
  requestId?: string;
}

// ----------------------------------------------------------------------------
// Responses
// ----------------------------------------------------------------------------

/**
 * Token usage statistics for a single request.
 *
 * Used for:
 * - Cost tracking
 * - Usage monitoring
 * - Provider comparison
 */
export interface TokenUsage {
  /** Number of tokens in the input prompt */
  inputTokens: number;

  /** Number of tokens in the generated output */
  outputTokens: number;

  /** Total tokens (input + output) */
  totalTokens: number;
}

/**
 * The reason why generation stopped.
 *
 * - "stop":         The model hit a natural stop point or stop sequence
 * - "length":       The model hit the max token limit
 * - "tool-calls":   The model requested to call a tool/function
 * - "content-filter": The response was filtered by a content moderation system
 * - "error":        Generation ended due to an error
 */
export type FinishReason = "stop" | "length" | "tool-calls" | "content-filter" | "error";

/**
 * The response from a chat completion request.
 *
 * This is the universal response format that all providers return.
 * Provider-specific response fields are mapped to this structure by adapters.
 */
export interface ChatResponse {
  /** The generated message from the AI */
  message: Message;

  /** The model that generated the response */
  model: ModelId;

  /** Token usage statistics */
  usage: TokenUsage;

  /** The reason why generation finished */
  finishReason: FinishReason;

  /** The provider that handled this request */
  provider: ProviderId;

  /**
   * Latency of the request in milliseconds.
   * Measured from request send to response received.
   */
  latencyMs: number;
}

/**
 * Common metadata emitted with every stream event.
 */
export interface StreamEventBase {
  /** The model generating the stream */
  model: ModelId;

  /** The provider handling the stream */
  provider: ProviderId;
}

/** An incremental text fragment. */
export interface TextDeltaEvent extends StreamEventBase {
  type: "text-delta";
  delta: string;
}

/** An incremental update to a tool call under construction. */
export interface ToolCallDeltaEvent extends StreamEventBase {
  type: "tool-call-delta";
  toolCallId: string;
  toolName?: string;
  argumentsDelta?: string;
}

/** Usage information reported during or after generation. */
export interface UsageEvent extends StreamEventBase {
  type: "usage";
  usage: TokenUsage;
}

/** The terminal successful event for a stream. */
export interface FinishEvent extends StreamEventBase {
  type: "finish";
  finishReason: FinishReason;
}

/** The terminal failure event for a stream. */
export interface ErrorEvent extends StreamEventBase {
  type: "error";
  error: {
    message: string;
    code?: string;
    retryable?: boolean;
  };
}

/** A discriminated event emitted by a streaming generation. */
export type StreamEvent =
  | TextDeltaEvent
  | ToolCallDeltaEvent
  | UsageEvent
  | FinishEvent
  | ErrorEvent;

/**
 * The response from an embedding request.
 */
export interface EmbeddingResponse {
  /** The generated embedding vectors */
  embeddings: number[][];

  /** The model used for embedding */
  model: ModelId;

  /** Token usage statistics */
  usage: TokenUsage;

  /** The provider that handled this request */
  provider: ProviderId;

  /** Latency in milliseconds */
  latencyMs: number;
}

// ----------------------------------------------------------------------------
// Models & Capabilities
// ----------------------------------------------------------------------------

/**
 * The capabilities that an AI model supports.
 *
 * This is used by the Capability Registry to match tasks to models.
 * Each capability is a boolean flag indicating whether the model supports it.
 */
export interface ModelCapabilities {
  /** Can the model stream responses token-by-token? */
  streaming: boolean;

  /** Can the model call tools/functions? */
  functionCalling: boolean;

  /** Can the model process images? */
  vision: boolean;

  /** Can the model generate embeddings? */
  embeddings: boolean;

  /** Maximum number of tokens the model can generate in a single response */
  maxOutputTokens: number;

  /** Maximum number of tokens the model can accept in the context window */
  maxContextLength: number;
}

/**
 * Metadata about an AI model.
 *
 * This is registered in the AI Registry and used for:
 * - Model discovery
 * - Capability matching
 * - Cost calculation
 * - Provider routing
 */
export interface ModelDescriptor {
  /** Unique identifier for this model (e.g., "qwen3:8b") */
  id: ModelId;

  /** Human-readable name (e.g., "Qwen 3 8B") */
  name: string;

  /** The provider that hosts this model */
  provider: ProviderId;

  /** The capabilities this model supports */
  capabilities: ModelCapabilities;

  /**
   * Cost per 1,000 tokens for input and output.
   * Used for cost-based routing and usage tracking.
   * Values are in USD (or the platform's base currency).
   */
  costPer1KTokens: {
    input: number;
    output: number;
  };

  /**
   * A quality score from 0.0 to 1.0.
   * Higher = better quality.
   * Used for quality-based routing decisions.
   */
  qualityScore: number;
}

// ----------------------------------------------------------------------------
// Provider Interface
// ----------------------------------------------------------------------------

/**
 * Health status of an AI provider.
 *
 * Returned by the `health()` method on every provider adapter.
 * Used by the AI Registry to track provider availability.
 */
export interface HealthStatus {
  /** Whether the provider is currently healthy and accepting requests */
  healthy: boolean;

  /** The provider being checked */
  provider: ProviderId;

  /** Timestamp of the last health check (Unix milliseconds) */
  lastChecked: number;

  /**
   * Optional error message if the provider is unhealthy.
   * Contains diagnostic information for debugging.
   */
  error?: string;

  /**
   * Latency of the health check request in milliseconds.
   * Useful for monitoring provider responsiveness.
   */
  latencyMs: number;
}

/**
 * The core interface that every AI provider adapter must implement.
 *
 * This is the primary port in the Hexagonal Architecture.
 * All business logic in the core layer depends on this interface,
 * never on concrete provider implementations.
 *
 * To add a new provider:
 * 1. Create a new adapter class that implements this interface
 * 2. Register it with the AI Registry
 * 3. No changes to core business logic needed
 */
export interface AIProvider {
  /** Unique identifier for this provider (e.g., "ollama", "openai") */
  readonly id: ProviderId;

  /** Human-readable name (e.g., "Ollama", "OpenAI") */
  readonly name: string;

  /** The models this provider offers */
  readonly models: ModelDescriptor[];

  /**
   * Send a chat completion request and receive the full response.
   *
   * Use this for non-streaming requests where you want the complete
   * response in a single call.
   */
  chat(request: ChatRequest): Promise<ChatResponse>;

  /**
   * Send a chat completion request and receive a stream of chunks.
   *
   * Use this for real-time streaming where you want to display
   * tokens as they are generated.
   *
   * A successful stream ends with a FinishEvent. A protocol-level stream
   * failure is represented by an ErrorEvent.
   */
  stream(request: ChatRequest): AsyncIterable<StreamEvent>;

  /**
   * Generate embeddings for the given text(s).
   *
   * Embeddings are vector representations of text that can be used
   * for semantic search, clustering, and similarity comparison.
   */
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;

  /**
   * Check the health of this provider.
   *
   * Should be called periodically by the AI Registry to track
   * provider availability and update routing decisions.
   */
  health(): Promise<HealthStatus>;
}
