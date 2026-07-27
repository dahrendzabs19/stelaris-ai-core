// ============================================================================
// Stelaris AI Core — AI Gateway
// ============================================================================
//
// The AI Gateway is the central orchestration layer for all AI operations.
//
// Responsibilities:
//   - Receive generic requests
//   - Look up the requested provider from the AIRegistry
//   - Delegate to the provider
//   - Return the result
//
// Non-responsibilities (handled by future phases):
//   - Retries
//   - Fallback
//   - Routing
//   - Model selection
//   - Logging
//   - Metrics
//   - Caching
//
// Rules:
//   - Provider-agnostic (zero Ollama/OpenAI/Claude-specific logic)
//   - No React, no Next.js, no fetch, no process.env
//   - No singleton — every instance receives its dependencies
//   - No provider instantiation — providers are registered externally
// ============================================================================

import type {
  ChatRequest,
  ChatResponse,
  StreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  HealthStatus,
  ModelId,
  ProviderId,
} from "./types";

import { ProviderRouter } from "./provider-router";
import type { AppConfig } from "../config/config";

// ----------------------------------------------------------------------------
// Error
// ----------------------------------------------------------------------------

/**
 * Error thrown when a gateway operation fails.
 *
 * Wraps underlying provider errors so callers can handle them uniformly
 * without depending on provider-specific error types.
 */
export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly providerId: ProviderId,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

// ----------------------------------------------------------------------------
// Gateway
// ----------------------------------------------------------------------------

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
 * const gateway = new AIGateway(config, router);
 *
 * const response = await gateway.chat({
 *   model: "qwen3:8b",
 *   messages: [{ role: "user", content: "Hello" }],
 * });
 * ```
 *
 * The Gateway has no provider-specific logic.
 * It delegates entirely to the provider adapter.
 */
export class AIGateway {
  private readonly config: AppConfig;
  private readonly router: ProviderRouter;

  /**
   * @param config - Application configuration (provider settings, etc.)
   * @param router - Provider router that resolves model IDs to AIProvider instances
   */
  constructor(config: AppConfig, router: ProviderRouter) {
    this.config = config;
    this.router = router;
  }

  // --------------------------------------------------------------------------
  // Chat
  // --------------------------------------------------------------------------

  /**
   * Send a chat completion request to the appropriate provider.
   *
   * The provider is determined automatically from the model ID in the request.
   *
   * @param request - The generic chat completion request
   * @returns The generic chat completion response
   * @throws {GatewayError} If the provider is not found or the request fails
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const provider = this.router.resolve(request.model!);

    try {
      return await provider.chat(request);
    } catch (error) {
      throw new GatewayError(
        `Chat request for model "${request.model}" failed`,
        request.model as unknown as ProviderId,
        error,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Stream
  // --------------------------------------------------------------------------

  /**
   * Send a streaming chat completion request to the appropriate provider.
   *
   * The provider is determined automatically from the model ID in the request.
   * Yields StreamChunks as they arrive from the provider.
   * The stream ends when a chunk with `done: true` is received.
   *
   * @param request - The generic chat completion request
   * @returns An async iterable of stream chunks
   * @throws {GatewayError} If the provider is not found or the stream fails
   */
  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const provider = this.router.resolve(request.model!);

    try {
      for await (const chunk of provider.stream(request)) {
        yield chunk;
      }
    } catch (error) {
      throw new GatewayError(
        `Stream request for model "${request.model}" failed`,
        request.model as unknown as ProviderId,
        error,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Embed
  // --------------------------------------------------------------------------

  /**
   * Generate embeddings using the appropriate provider.
   *
   * The provider is determined automatically from the model ID in the request.
   *
   * @param request - The generic embedding request
   * @returns The generic embedding response
   * @throws {GatewayError} If the provider is not found or the request fails
   */
  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const provider = this.router.resolve(request.model!);

    try {
      return await provider.embed(request);
    } catch (error) {
      throw new GatewayError(
        `Embed request for model "${request.model}" failed`,
        request.model as unknown as ProviderId,
        error,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------

  /**
   * Check the health of the provider for a given model.
   *
   * @param modelId - The model ID to resolve the provider
   * @returns The health status of the provider
   * @throws {GatewayError} If the provider for the given model is not found
   */
  async health(modelId: string): Promise<HealthStatus> {
    const provider = this.router.resolve(modelId as ModelId);

    try {
      return await provider.health();
    } catch (error) {
      throw new GatewayError(
        `Health check for model "${modelId}" failed`,
        modelId as ProviderId,
        error,
      );
    }
  }
}