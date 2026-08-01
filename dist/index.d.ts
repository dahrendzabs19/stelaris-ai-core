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
type ProviderId = string & {
    readonly __brand: "ProviderId";
};
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
type ModelId = string & {
    readonly __brand: "ModelId";
};
/**
 * The role of a participant in a conversation.
 *
 * - "system":    Instructions that set the behavior of the AI
 * - "user":      End-user input
 * - "assistant": AI-generated response
 * - "tool":      Result of a tool/function call (used in function-calling flows)
 */
type MessageRole = "system" | "developer" | "user" | "assistant" | "tool";
/**
 * A provider-agnostic unit of conversational input or output.
 *
 * A message is intentionally composed from content parts rather than a single
 * string. Provider adapters translate these canonical parts to and from their
 * native wire formats.
 */
interface Message {
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
interface TextPart {
    type: "text";
    text: string;
}
/** A remotely accessible image. */
interface ImageUrlSource {
    type: "url";
    url: string;
    mediaType?: string;
}
/** An inline base64-encoded image. */
interface ImageBase64Source {
    type: "base64";
    data: string;
    mediaType: string;
}
/** A provider-neutral image input. */
interface ImagePart {
    type: "image";
    source: ImageUrlSource | ImageBase64Source;
}
/** A requested invocation of a named tool. */
interface ToolCallPart {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    arguments: unknown;
}
/** The result corresponding to a prior tool invocation. */
interface ToolResultPart {
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
type ContentPart = TextPart | ImagePart | ToolCallPart | ToolResultPart;
/**
 * A request to generate a chat completion.
 *
 * This is the primary input type for the AI Gateway.
 * All provider adapters translate this to their native format.
 */
interface ChatRequest {
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
interface EmbeddingRequest {
    /** The text(s) to embed. Can be a single string or an array. */
    input: string | string[];
    /** The model to use for embedding. */
    model: ModelId;
    /** Optional unique identifier for the request. */
    requestId?: string;
}
/**
 * Token usage statistics for a single request.
 *
 * Used for:
 * - Cost tracking
 * - Usage monitoring
 * - Provider comparison
 */
interface TokenUsage {
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
type FinishReason = "stop" | "length" | "tool-calls" | "content-filter" | "error";
/**
 * The response from a chat completion request.
 *
 * This is the universal response format that all providers return.
 * Provider-specific response fields are mapped to this structure by adapters.
 */
interface ChatResponse {
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
interface StreamEventBase {
    /** The model generating the stream */
    model: ModelId;
    /** The provider handling the stream */
    provider: ProviderId;
}
/** An incremental text fragment. */
interface TextDeltaEvent extends StreamEventBase {
    type: "text-delta";
    delta: string;
}
/** An incremental update to a tool call under construction. */
interface ToolCallDeltaEvent extends StreamEventBase {
    type: "tool-call-delta";
    toolCallId: string;
    toolName?: string;
    argumentsDelta?: string;
}
/** Usage information reported during or after generation. */
interface UsageEvent extends StreamEventBase {
    type: "usage";
    usage: TokenUsage;
}
/** The terminal successful event for a stream. */
interface FinishEvent extends StreamEventBase {
    type: "finish";
    finishReason: FinishReason;
}
/** The terminal failure event for a stream. */
interface ErrorEvent extends StreamEventBase {
    type: "error";
    error: {
        message: string;
        code?: string;
        retryable?: boolean;
    };
}
/** A discriminated event emitted by a streaming generation. */
type StreamEvent = TextDeltaEvent | ToolCallDeltaEvent | UsageEvent | FinishEvent | ErrorEvent;
/**
 * The response from an embedding request.
 */
interface EmbeddingResponse {
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
/**
 * The capabilities that an AI model supports.
 *
 * This is used by the Capability Registry to match tasks to models.
 * Each capability is a boolean flag indicating whether the model supports it.
 */
interface ModelCapabilities {
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
interface ModelDescriptor {
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
/**
 * Health status of an AI provider.
 *
 * Returned by the `health()` method on every provider adapter.
 * Used by the AI Registry to track provider availability.
 */
interface HealthStatus {
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
interface AIProvider {
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

/**
 * Error thrown when attempting to register a provider that already exists.
 */
declare class ProviderAlreadyRegisteredError extends Error {
    constructor(providerId: ProviderId);
}
/**
 * Error thrown when attempting to retrieve a provider that is not registered.
 */
declare class ProviderNotFoundError extends Error {
    constructor(providerId: ProviderId);
}
/**
 * The AI Registry — a lightweight catalog of AI providers.
 *
 * Usage:
 * ```ts
 * const registry = new AIRegistry();
 * registry.register(ollamaAdapter);
 *
 * const provider = registry.get("ollama");
 * const all = registry.list();
 * ```
 *
 * The registry is intentionally simple.
 * Future phases may add:
 *   - Provider health tracking
 *   - Capability-based lookups
 *   - Model discovery
 *   - Runtime configuration
 */
declare class AIRegistry {
    /** Internal storage: provider ID → provider instance */
    private readonly providers;
    /**
     * Register a new provider.
     *
     * Throws `ProviderAlreadyRegisteredError` if a provider with the same ID
     * is already registered. This prevents silent overwrites and makes
     * duplicate registration bugs visible immediately.
     */
    register(provider: AIProvider): void;
    /**
     * Unregister a provider by its ID.
     *
     * Throws `ProviderNotFoundError` if no provider with the given ID exists.
     * This ensures callers are aware when they try to remove something
     * that doesn't exist.
     */
    unregister(providerId: ProviderId): void;
    /**
     * Retrieve a provider by its ID.
     *
     * Throws `ProviderNotFoundError` if the provider is not registered.
     * Fail-fast behavior ensures that missing providers are caught early
     * rather than causing cryptic errors downstream.
     */
    get(providerId: ProviderId): AIProvider;
    /**
     * List all registered providers.
     *
     * Returns a new array each time to prevent callers from mutating
     * the internal registry state.
     */
    list(): AIProvider[];
    /**
     * Check whether a provider is registered.
     *
     * Useful for conditional logic without exception handling:
     * ```ts
     * if (registry.has("ollama")) {
     *   const provider = registry.get("ollama");
     * }
     * ```
     */
    has(providerId: ProviderId): boolean;
    /**
     * Get the number of registered providers.
     */
    get size(): number;
}

/**
 * Error thrown when attempting to register a model that already exists.
 */
declare class ModelAlreadyRegisteredError extends Error {
    constructor(modelId: ModelId);
}
/**
 * Error thrown when attempting to look up a model that is not registered.
 */
declare class ModelNotFoundError extends Error {
    constructor(modelId: ModelId);
}
/**
 * A mapping entry returned by `list()`.
 */
interface ModelMapping {
    /** The model identifier (e.g., "gpt-4o", "qwen3:8b") */
    modelId: ModelId;
    /** The provider that hosts this model (e.g., "openai", "ollama") */
    providerId: ProviderId;
}
/**
 * The Model Registry — a lightweight catalog of model-to-provider mappings.
 *
 * Usage:
 * ```ts
 * const models = new ModelRegistry();
 * models.register("gpt-4o", "openai");
 * models.register("qwen3:8b", "ollama");
 *
 * const provider = models.getProvider("gpt-4o"); // "openai"
 * const all = models.list(); // [{ modelId: "gpt-4o", providerId: "openai" }, ...]
 * ```
 *
 * The registry is intentionally simple.
 * Future phases may add:
 *   - Capability-based lookups
 *   - Model aliasing
 *   - Version resolution
 */
declare class ModelRegistry {
    /** Internal storage: model ID → provider ID */
    private readonly mappings;
    /**
     * Register a model-to-provider mapping.
     *
     * Throws `ModelAlreadyRegisteredError` if the model is already mapped.
     * This prevents silent overwrites and makes duplicate registration bugs
     * visible immediately.
     */
    register(modelId: ModelId, providerId: ProviderId): void;
    /**
     * Look up the provider that hosts a given model.
     *
     * Throws `ModelNotFoundError` if the model is not registered.
     * Fail-fast behavior ensures that missing models are caught early
     * rather than causing cryptic errors downstream.
     */
    getProvider(modelId: ModelId): ProviderId;
    /**
     * Check whether a model is registered.
     *
     * Useful for conditional logic without exception handling:
     * ```ts
     * if (models.has("gpt-4o")) {
     *   const provider = models.getProvider("gpt-4o");
     * }
     * ```
     */
    has(modelId: ModelId): boolean;
    /**
     * List all registered model-to-provider mappings.
     *
     * Returns a new array each time to prevent callers from mutating
     * the internal registry state.
     */
    list(): ModelMapping[];
    /**
     * Remove a model mapping by its model ID.
     *
     * Throws `ModelNotFoundError` if no mapping with the given model ID exists.
     * This ensures callers are aware when they try to remove something
     * that doesn't exist.
     */
    remove(modelId: ModelId): void;
    /**
     * Remove all model mappings.
     */
    clear(): void;
    /**
     * Get the number of registered model mappings.
     */
    get size(): number;
}

/**
 * Error thrown when a model ID is not registered in the ModelRegistry.
 */
declare class UnknownModelError extends Error {
    constructor(modelId: ModelId);
}
/**
 * Error thrown when the provider for a model is not available in the AIRegistry.
 */
declare class ProviderUnavailableError extends Error {
    constructor(modelId: ModelId, providerId: string);
}
/**
 * Resolves a model ID to an AIProvider instance.
 *
 * Usage:
 * ```ts
 * const router = new ProviderRouter(modelRegistry, aiRegistry);
 *
 * const provider = router.resolve("gpt-4o");
 * const response = await provider.chat({ model: "gpt-4o", messages: [...] });
 * ```
 *
 * The router performs a pure two-step lookup — no heuristics, no fallback.
 */
declare class ProviderRouter {
    private readonly modelRegistry;
    private readonly aiRegistry;
    constructor(modelRegistry: ModelRegistry, aiRegistry: AIRegistry);
    /**
     * Resolve a model ID to its AIProvider instance.
     *
     * @param modelId - The model to look up
     * @returns The AIProvider that hosts this model
     * @throws {UnknownModelError} If the model is not registered in the ModelRegistry
     * @throws {ProviderUnavailableError} If the provider is not registered in the AIRegistry
     */
    resolve(modelId: ModelId): AIProvider;
}

/**
 * Ollama-specific configuration.
 *
 * Ollama is the first provider integrated into the platform.
 * It requires a base URL pointing to the running Ollama server.
 */
interface OllamaConfig {
    /** Base URL of the Ollama server (e.g., "http://localhost:11434") */
    readonly baseUrl: string;
}
/**
 * OpenAI-specific configuration.
 *
 * Optional until OpenAI provider integration is implemented.
 */
interface OpenAIConfig {
    /** OpenAI API key */
    readonly apiKey?: string;
}
/**
 * Claude (Anthropic)-specific configuration.
 *
 * Optional until Claude provider integration is implemented.
 */
interface ClaudeConfig {
    /** Anthropic API key */
    readonly apiKey?: string;
}
/**
 * Gemini-specific configuration.
 *
 * Optional until Gemini provider integration is implemented.
 */
interface GeminiConfig {
    /** Google AI API key */
    readonly apiKey?: string;
}
/**
 * AI platform configuration section.
 *
 * Contains configuration for every supported AI provider.
 * Providers without an active integration simply have empty config objects.
 */
interface AIConfig {
    /** Timeout in milliseconds for all outbound AI HTTP requests */
    readonly timeoutMs: number;
    /** Maximum number of retries for transient failures (0 = no retries) */
    readonly retryCount: number;
    readonly ollama: OllamaConfig;
    readonly openai: OpenAIConfig;
    readonly claude: ClaudeConfig;
    readonly gemini: GeminiConfig;
}
/**
 * Top-level application configuration.
 *
 * This is the complete configuration object returned by `createConfig()`.
 * All properties are readonly — configuration is immutable after creation.
 */
interface AppConfig {
    readonly ai: AIConfig;
}
/**
 * Create the application configuration from environment variables.
 *
 * This is the ONLY place where `process.env` is read directly.
 * Every other module that needs configuration receives it via this object.
 *
 * The returned configuration is deeply frozen to enforce immutability.
 *
 * @throws {ConfigValidationError} If any required environment variables are missing.
 */
declare function createConfig(): AppConfig;
/**
 * Error thrown when required configuration is missing or invalid.
 */
declare class ConfigValidationError extends Error {
    constructor(message: string);
}

/**
 * Structured metadata for log entries.
 *
 * Contains safe, non-sensitive information about the operation being logged.
 * Never include:
 *   - API keys or tokens
 *   - Authorization headers
 *   - User prompt contents
 *   - AI response contents
 *   - Embedding vectors
 *   - Personally identifiable information (PII)
 */
interface LogMetadata {
    /** The provider handling the request (e.g., "ollama", "openai") */
    provider?: string;
    /** The model being used (e.g., "gpt-4o", "qwen3:8b") */
    model?: string;
    /** Duration of the operation in milliseconds */
    latencyMs?: number;
    /** HTTP status code (for API responses) */
    status?: number;
    /** Error name (for error entries) */
    error?: string;
    /** Any other safe, non-sensitive metadata */
    [key: string]: unknown;
}
/**
 * Logger interface for structured, safe logging.
 *
 * Every module that needs logging should depend on this interface,
 * never on a concrete logger implementation.
 *
 * Usage:
 * ```ts
 * class MyModule {
 *   constructor(private readonly log: Logger) {}
 *
 *   doSomething(): void {
 *     this.log.info("Operation started", { model: "gpt-4o" });
 *   }
 * }
 * ```
 */
interface Logger {
    /**
     * Log a debug message.
     *
     * Use for detailed diagnostic information during development.
     */
    debug(message: string, metadata?: LogMetadata): void;
    /**
     * Log an informational message.
     *
     * Use for normal operation events (request started, request finished).
     */
    info(message: string, metadata?: LogMetadata): void;
    /**
     * Log a warning message.
     *
     * Use for unexpected but non-fatal situations (timeouts, retries).
     */
    warn(message: string, metadata?: LogMetadata): void;
    /**
     * Log an error message.
     *
     * Use for failures that may require attention.
     */
    error(message: string, metadata?: LogMetadata): void;
}

/**
 * Error thrown when a gateway operation fails.
 *
 * Wraps underlying provider errors so callers can handle them uniformly
 * without depending on provider-specific error types.
 */
declare class GatewayError extends Error {
    readonly providerId: ProviderId;
    readonly cause?: unknown | undefined;
    constructor(message: string, providerId: ProviderId, cause?: unknown | undefined);
}
/**
 * Central orchestration layer for AI operations.
 *
 * The Gateway sits between application code and AI providers.
 * It receives generic contracts (ChatRequest, EmbeddingRequest),
 * resolves the provider via the ProviderRouter, delegates
 * the operation, and returns the result.
 *
 * Usage:
 * ```ts
 * const config = createConfig();
 * const router = new ProviderRouter(modelRegistry, aiRegistry);
 * const gateway = new AIGateway(config, router, logger);
 *
 * const response = await gateway.chat({
 *   model: "qwen3:8b",
 *   messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
 * });
 * ```
 *
 * The Gateway has no provider-specific logic.
 * It delegates entirely to the provider adapter.
 */
declare class AIGateway {
    private readonly config;
    private readonly router;
    private readonly log;
    /**
     * @param config - Application configuration (provider settings, etc.)
     * @param router - Provider router that resolves model IDs to AIProvider instances
     * @param log    - Logger for structured, safe logging
     */
    constructor(config: AppConfig, router: ProviderRouter, log: Logger);
    /**
     * Send a chat completion request to the appropriate provider.
     *
     * The provider is determined automatically from the model ID in the request.
     *
     * @param request - The generic chat completion request
     * @returns The generic chat completion response
     * @throws {GatewayError} If the provider is not found or the request fails
     */
    chat(request: ChatRequest): Promise<ChatResponse>;
    /**
     * Send a streaming chat completion request to the appropriate provider.
     *
     * The provider is determined automatically from the model ID in the request.
     * Yields discriminated StreamEvents as they arrive from the provider.
     * A successful stream ends with a FinishEvent; a protocol-level failure is
     * represented by an ErrorEvent.
     *
     * @param request - The generic chat completion request
     * @returns An async iterable of stream events
     * @throws {GatewayError} If the provider is not found or the stream fails
     */
    stream(request: ChatRequest): AsyncIterable<StreamEvent>;
    /**
     * Generate embeddings using the appropriate provider.
     *
     * The provider is determined automatically from the model ID in the request.
     *
     * @param request - The generic embedding request
     * @returns The generic embedding response
     * @throws {GatewayError} If the provider is not found or the request fails
     */
    embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
    /**
     * Check the health of the provider for a given model.
     *
     * @param modelId - The model ID to resolve the provider
     * @returns The health status of the provider
     * @throws {GatewayError} If the provider for the given model is not found
     */
    health(modelId: string): Promise<HealthStatus>;
}

/**
 * Logger implementation that writes to the console.
 *
 * Each log entry is formatted as:
 *   [LEVEL] YYYY-MM-DDTHH:mm:ss.sssZ message { metadata }
 *
 * The metadata is serialized as compact JSON. If no metadata is provided,
 * the JSON portion is omitted.
 *
 * Usage:
 * ```ts
 * const log = new ConsoleLogger();
 * log.info("Request started", { provider: "ollama", model: "qwen3:8b" });
 * // Output: [INFO] 2026-07-27T22:00:00.000Z Request started { "provider": "ollama", "model": "qwen3:8b" }
 * ```
 */
declare class ConsoleLogger implements Logger {
    debug(message: string, metadata?: LogMetadata): void;
    info(message: string, metadata?: LogMetadata): void;
    warn(message: string, metadata?: LogMetadata): void;
    error(message: string, metadata?: LogMetadata): void;
    /**
     * Format a log entry into a consistent string.
     */
    private format;
}

/**
 * Error thrown when an HTTP request exceeds the configured timeout.
 */
declare class TimeoutError extends Error {
    constructor(timeoutMs: number);
}
/**
 * Wraps the native fetch API with an AbortController-based timeout.
 *
 * If the request does not complete within `timeoutMs` milliseconds,
 * the signal is aborted and a `TimeoutError` is thrown.
 *
 * @param url     - The URL to fetch
 * @param options - Standard fetch options (method, headers, body, etc.)
 * @param timeoutMs - Timeout in milliseconds
 * @returns The fetch Response
 * @throws {TimeoutError} If the request exceeds the timeout
 * @throws {Error} Any error from the underlying fetch
 */
declare function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response>;

/**
 * Wraps fetchWithTimeout with a simple retry mechanism.
 *
 * The initial request plus up to `retryCount` retries are attempted.
 * With retryCount=0, exactly 1 request is made (no retries).
 * With retryCount=2, up to 3 total attempts are made.
 *
 * Retries only occur for:
 *   - TimeoutError (request exceeded timeout)
 *   - Network errors (DNS failures, connection refused)
 *   - HTTP 502, 503, 504 (server-side transient errors)
 *
 * All other errors are thrown immediately without retry.
 *
 * @param url       - The URL to fetch
 * @param options   - Standard fetch options
 * @param timeoutMs - Timeout in milliseconds per attempt
 * @param retryCount - Maximum number of retries (0 = no retries)
 * @param log       - Logger for structured logging
 * @param metadata  - Safe metadata (provider, model) for log context
 * @returns The fetch Response
 * @throws {Error} The last error encountered if all retries are exhausted
 */
declare function fetchWithRetry(url: string, options: RequestInit, timeoutMs: number, retryCount: number, log: Logger, metadata: {
    provider: string;
    model?: string;
}): Promise<Response>;

interface OllamaProviderConfig {
    /** Base URL of the Ollama server (e.g., "http://localhost:11434") */
    baseUrl: string;
    /** Timeout in milliseconds for all outbound HTTP requests */
    timeoutMs: number;
    /** Maximum number of retries for transient failures */
    retryCount: number;
}
declare class OllamaProvider implements AIProvider {
    readonly id: ProviderId;
    readonly name = "Ollama";
    readonly models: ModelDescriptor[];
    private readonly baseUrl;
    private readonly timeoutMs;
    private readonly retryCount;
    private readonly log;
    constructor(config: OllamaProviderConfig, log: Logger);
    private buildModels;
    chat(request: ChatRequest): Promise<ChatResponse>;
    stream(request: ChatRequest): AsyncIterable<StreamEvent>;
    private parseStreamEvents;
    embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
    health(): Promise<HealthStatus>;
    private cleanUndefinedOptions;
    private isOllamaChatResponse;
    private isOllamaStreamPayload;
    private isOllamaEmbedResponse;
}

/**
 * Extended configuration for the OpenAI provider.
 *
 * Extends the core OpenAIConfig with an optional custom base URL.
 * The API key is required — no hardcoded defaults.
 */
interface OpenAIProviderConfig extends OpenAIConfig {
    /** Base URL of the OpenAI API (defaults to "https://api.openai.com/v1") */
    baseUrl?: string;
    /** Timeout in milliseconds for all outbound HTTP requests */
    timeoutMs: number;
    /** Maximum number of retries for transient failures */
    retryCount: number;
}
declare class OpenAIProvider implements AIProvider {
    readonly id: ProviderId;
    readonly name = "OpenAI";
    readonly models: ModelDescriptor[];
    private readonly apiKey;
    private readonly baseUrl;
    private readonly timeoutMs;
    private readonly retryCount;
    private readonly log;
    constructor(config: OpenAIProviderConfig, log: Logger);
    private buildModels;
    chat(request: ChatRequest): Promise<ChatResponse>;
    stream(request: ChatRequest): AsyncIterable<StreamEvent>;
    private parseStreamEvents;
    embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
    health(): Promise<HealthStatus>;
    private fetchOpenAI;
    private isOpenAIStreamPayload;
}

declare function createGateway(config: AppConfig): AIGateway;

export { type AIConfig, AIGateway, type AIProvider, AIRegistry, type AppConfig, type ChatRequest, type ChatResponse, type ClaudeConfig, ConfigValidationError, ConsoleLogger, type ContentPart, type EmbeddingRequest, type EmbeddingResponse, type ErrorEvent, type FinishEvent, type FinishReason, GatewayError, type GeminiConfig, type HealthStatus, type ImageBase64Source, type ImagePart, type ImageUrlSource, type LogMetadata, type Logger, type Message, type MessageRole, ModelAlreadyRegisteredError, type ModelCapabilities, type ModelDescriptor, type ModelId, type ModelMapping, ModelNotFoundError, ModelRegistry, type OllamaConfig, OllamaProvider, type OllamaProviderConfig, type OpenAIConfig, OpenAIProvider, type OpenAIProviderConfig, ProviderAlreadyRegisteredError, type ProviderId, ProviderNotFoundError, ProviderRouter, ProviderUnavailableError, type StreamEvent, type StreamEventBase, type TextDeltaEvent, type TextPart, TimeoutError, type TokenUsage, type ToolCallDeltaEvent, type ToolCallPart, type ToolResultPart, UnknownModelError, type UsageEvent, createConfig, createGateway, fetchWithRetry, fetchWithTimeout };
