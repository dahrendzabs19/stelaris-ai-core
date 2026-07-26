// ============================================================================
// Stelaris AI Core — AI Registry
// ============================================================================
//
// The AI Registry is the central catalog of all available AI providers.
//
// Responsibilities:
//   - Register providers
//   - Unregister providers
//   - Retrieve a provider by ID
//   - List all registered providers
//   - Check whether a provider exists
//
// Non-responsibilities (handled by other components):
//   - Provider routing
//   - Health monitoring
//   - Caching
//   - Configuration
//   - Error recovery
//
// Rules:
//   - Zero dependencies on Next.js, React, fetch, or file system
//   - No singleton or global state
//   - No business logic beyond provider registration
//   - Thread-safe for single-threaded Node.js usage
// ============================================================================

import type { AIProvider, ProviderId } from "./types";

/**
 * Error thrown when attempting to register a provider that already exists.
 */
export class ProviderAlreadyRegisteredError extends Error {
  constructor(providerId: ProviderId) {
    super(`Provider "${providerId}" is already registered`);
    this.name = "ProviderAlreadyRegisteredError";
  }
}

/**
 * Error thrown when attempting to retrieve a provider that is not registered.
 */
export class ProviderNotFoundError extends Error {
  constructor(providerId: ProviderId) {
    super(`Provider "${providerId}" is not registered`);
    this.name = "ProviderNotFoundError";
  }
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
export class AIRegistry {
  /** Internal storage: provider ID → provider instance */
  private readonly providers: Map<ProviderId, AIProvider> = new Map();

  /**
   * Register a new provider.
   *
   * Throws `ProviderAlreadyRegisteredError` if a provider with the same ID
   * is already registered. This prevents silent overwrites and makes
   * duplicate registration bugs visible immediately.
   */
  register(provider: AIProvider): void {
    if (this.providers.has(provider.id)) {
      throw new ProviderAlreadyRegisteredError(provider.id);
    }
    this.providers.set(provider.id, provider);
  }

  /**
   * Unregister a provider by its ID.
   *
   * Throws `ProviderNotFoundError` if no provider with the given ID exists.
   * This ensures callers are aware when they try to remove something
   * that doesn't exist.
   */
  unregister(providerId: ProviderId): void {
    if (!this.providers.has(providerId)) {
      throw new ProviderNotFoundError(providerId);
    }
    this.providers.delete(providerId);
  }

  /**
   * Retrieve a provider by its ID.
   *
   * Throws `ProviderNotFoundError` if the provider is not registered.
   * Fail-fast behavior ensures that missing providers are caught early
   * rather than causing cryptic errors downstream.
   */
  get(providerId: ProviderId): AIProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new ProviderNotFoundError(providerId);
    }
    return provider;
  }

  /**
   * List all registered providers.
   *
   * Returns a new array each time to prevent callers from mutating
   * the internal registry state.
   */
  list(): AIProvider[] {
    return Array.from(this.providers.values());
  }

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
  has(providerId: ProviderId): boolean {
    return this.providers.has(providerId);
  }

  /**
   * Get the number of registered providers.
   */
  get size(): number {
    return this.providers.size;
  }
}