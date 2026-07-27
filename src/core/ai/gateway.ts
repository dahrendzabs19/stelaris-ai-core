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
  AIProvider,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  HealthStatus,
  ProviderId,
} from "./types";

import { AIRegistry, ProviderNotFoundError } from "./registry";
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
 * looks up the requested provider from the registry, delegates
 * the operation, and returns the result.
 *
 * Usage:
 * ```ts
 * const config = createConfig();
 * const registry = new AIRegistry();
 * registry.register(new OllamaProvider(config.ai.ollama));
 *
 * const gateway = new AIGateway(config, registry);
 *
 * const response = await gateway.chat("ollama", {
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
  private readonly registry: AIRegistry;

  /**
   * @param config   - Application configuration (provider settings, etc.)
   * @param registry - Provider registry where adapters have been registered
   */
  constructor(config: AppConfig, registry: AIRegistry) {
    this.config = config;
    this.registry = registry;
  }

  // --------------------------------------------------------------------------
  // Chat
  // --------------------------------------------------------------------------

  /**
   * Send a chat completion request to the specified provider.
   *
   * @param providerId - The provider to route the request to
   * @param request    - The generic chat completion request
   * @returns The generic chat completion response
   * @throws {GatewayError} If the provider is not found or the request fails
   */
  async chat(
    providerId: ProviderId,
    request: ChatRequest,
  ): Promise<ChatResponse> {
    const provider = this.getProvider(providerId);

    try {
      return await provider.chat(request);
    } catch (error) {
      throw new GatewayError(
        `Chat request to provider "${providerId}" failed`,
        providerId,
        error,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Stream
  // --------------------------------------------------------------------------

  /**
   * Send a streaming chat completion request to the specified provider.
   *
   * Yields StreamChunks as they arrive from the provider.
   * The stream ends when a chunk with `done: true` is received.
   *
   * @param providerId - The provider to route the request to
   * @param request    - The generic chat completion request
   * @returns An async iterable of stream chunks
   * @throws {GatewayError} If the provider is not found or the stream fails
   */
  async *stream(
    providerId: ProviderId,
    request: ChatRequest,
  ): AsyncIterable<StreamChunk> {
    const provider = this.getProvider(providerId);

    try {
      for await (const chunk of provider.stream(request)) {
        yield chunk;
      }
    } catch (error) {
      throw new GatewayError(
        `Stream request to provider "${providerId}" failed`,
        providerId,
        error,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Embed
  // --------------------------------------------------------------------------

  /**
   * Generate embeddings using the specified provider.
   *
   * @param providerId - The provider to route the request to
   * @param request    - The generic embedding request
   * @returns The generic embedding response
   * @throws {GatewayError} If the provider is not found or the request fails
   */
  async embed(
    providerId: ProviderId,
    request: EmbeddingRequest,
  ): Promise<EmbeddingResponse> {
    const provider = this.getProvider(providerId);

    try {
      return await provider.embed(request);
    } catch (error) {
      throw new GatewayError(
        `Embed request to provider "${providerId}" failed`,
        providerId,
        error,
      );
    }
  }

  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------

  /**
   * Check the health of one or all providers.
   *
   * If a `providerId` is specified, checks only that provider.
   * If omitted, checks every registered provider.
   *
   * @param providerId - Optional specific provider to check
   * @returns A single HealthStatus (if providerId given) or an array (if omitted)
   * @throws {GatewayError} If a specific provider is not found
   */
  async health(providerId: ProviderId): Promise<HealthStatus>;
  async health(): Promise<HealthStatus[]>;
  async health(
    providerId?: ProviderId,
  ): Promise<HealthStatus | HealthStatus[]> {
    if (providerId) {
      const provider = this.getProvider(providerId);

      try {
        return await provider.health();
      } catch (error) {
        throw new GatewayError(
          `Health check for provider "${providerId}" failed`,
          providerId,
          error,
        );
      }
    }

    // Check all registered providers
    const providers = this.registry.list();
    const results: HealthStatus[] = [];

    for (const provider of providers) {
      try {
        results.push(await provider.health());
      } catch {
        results.push({
          healthy: false,
          provider: provider.id,
          lastChecked: Date.now(),
          error: "Health check threw an unexpected error",
          latencyMs: 0,
        });
      }
    }

    return results;
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  /**
   * Look up a provider from the registry.
   *
   * Throws a descriptive GatewayError if the provider is not registered,
   * wrapping the original ProviderNotFoundError as the cause.
   */
  private getProvider(providerId: ProviderId): AIProvider {
    try {
      return this.registry.get(providerId);
    } catch (error) {
      if (error instanceof ProviderNotFoundError) {
        throw new GatewayError(
          `Provider "${providerId}" is not registered. ` +
            "Ensure the provider adapter is created and registered before making requests.",
          providerId,
          error,
        );
      }
      throw error;
    }
  }
}