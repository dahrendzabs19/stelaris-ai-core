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
export type MessageRole = "system" | "user" | "assistant" | "tool";

// ----------------------------------------------------------------------------
// Messages
// ----------------------------------------------------------------------------

/**
 * A single message in a conversation.
 *
 * This is the universal message format that all providers must support.
 * Provider-specific formats (e.g., OpenAI's `content` array with image parts)
 * are handled by the adapter layer, not here.
 */
export interface ChatMessage {
  /** The role of the message sender */
  role: MessageRole;

  /** The text content of the message */
  content: string;

  /**
   * Optional name for the message sender.
   * Used for distinguishing between multiple users or tools.
   */
  name?: string;

  /**
   * Optional tool call ID (for tool/function-calling responses).
   * Present when role is "tool" to link back to the tool call.
   */
  toolCallId?: string;
}

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
  messages: ChatMessage[];

  /**
   * The model to use for generation.
   * If omitted, the provider's default model is used.
   */
  model?: ModelId;

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
  model?: ModelId;

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
  message: ChatMessage;

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
 * A single chunk in a streaming response.
 *
 * When streaming, the response is split into multiple chunks.
 * Each chunk contains a piece of the generated content.
 * The final chunk may contain usage statistics.
 */
export interface StreamChunk {
  /** The text content of this chunk (may be empty for non-content chunks) */
  content: string;

  /** The model generating the stream */
  model: ModelId;

  /** The provider handling the stream */
  provider: ProviderId;

  /**
   * Whether this is the final chunk in the stream.
   * The final chunk may contain usage statistics.
   */
  done: boolean;

  /**
   * Token usage (only present in the final chunk when done is true).
   */
  usage?: TokenUsage;

  /**
   * The finish reason (only present in the final chunk when done is true).
   */
  finishReason?: FinishReason;
}

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
export interface AIModelCapabilities {
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
export interface AIModel {
  /** Unique identifier for this model (e.g., "qwen3:8b") */
  id: ModelId;

  /** Human-readable name (e.g., "Qwen 3 8B") */
  name: string;

  /** The provider that hosts this model */
  provider: ProviderId;

  /** The capabilities this model supports */
  capabilities: AIModelCapabilities;

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
  readonly models: AIModel[];

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
   * The stream ends when a chunk with `done: true` is received.
   */
  stream(request: ChatRequest): AsyncIterable<StreamChunk>;

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