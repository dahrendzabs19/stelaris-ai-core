// ============================================================================
// Stelaris AI Core — Model Registry
// ============================================================================
//
// The Model Registry maps model IDs to provider IDs.
//
// This allows application code to specify a model (e.g., "gpt-4o") without
// knowing which provider hosts it. The registry resolves the model to its
// provider, and the Gateway can then route the request accordingly.
//
// Responsibilities:
//   - Register model → provider mappings
//   - Look up a provider by model ID
//   - List all registered models
//   - Remove model mappings
//
// Non-responsibilities (handled by other components):
//   - Provider routing
//   - Model selection
//   - Capability matching
//   - Health monitoring
//
// Rules:
//   - Zero dependencies on Next.js, React, fetch, or file system
//   - No singleton or global state
//   - No business logic beyond model registration
//   - Thread-safe for single-threaded Node.js usage
// ============================================================================

import type { ModelId, ProviderId } from "./types";

// ----------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------

/**
 * Error thrown when attempting to register a model that already exists.
 */
export class ModelAlreadyRegisteredError extends Error {
  constructor(modelId: ModelId) {
    super(`Model "${modelId}" is already registered`);
    this.name = "ModelAlreadyRegisteredError";
  }
}

/**
 * Error thrown when attempting to look up a model that is not registered.
 */
export class ModelNotFoundError extends Error {
  constructor(modelId: ModelId) {
    super(`Model "${modelId}" is not registered`);
    this.name = "ModelNotFoundError";
  }
}

// ----------------------------------------------------------------------------
// Model Registry
// ----------------------------------------------------------------------------

/**
 * A mapping entry returned by `list()`.
 */
export interface ModelMapping {
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
export class ModelRegistry {
  /** Internal storage: model ID → provider ID */
  private readonly mappings: Map<ModelId, ProviderId> = new Map();

  /**
   * Register a model-to-provider mapping.
   *
   * Throws `ModelAlreadyRegisteredError` if the model is already mapped.
   * This prevents silent overwrites and makes duplicate registration bugs
   * visible immediately.
   */
  register(modelId: ModelId, providerId: ProviderId): void {
    if (this.mappings.has(modelId)) {
      throw new ModelAlreadyRegisteredError(modelId);
    }
    this.mappings.set(modelId, providerId);
  }

  /**
   * Look up the provider that hosts a given model.
   *
   * Throws `ModelNotFoundError` if the model is not registered.
   * Fail-fast behavior ensures that missing models are caught early
   * rather than causing cryptic errors downstream.
   */
  getProvider(modelId: ModelId): ProviderId {
    const providerId = this.mappings.get(modelId);
    if (!providerId) {
      throw new ModelNotFoundError(modelId);
    }
    return providerId;
  }

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
  has(modelId: ModelId): boolean {
    return this.mappings.has(modelId);
  }

  /**
   * List all registered model-to-provider mappings.
   *
   * Returns a new array each time to prevent callers from mutating
   * the internal registry state.
   */
  list(): ModelMapping[] {
    return Array.from(this.mappings.entries()).map(([modelId, providerId]) => ({
      modelId,
      providerId,
    }));
  }

  /**
   * Remove a model mapping by its model ID.
   *
   * Throws `ModelNotFoundError` if no mapping with the given model ID exists.
   * This ensures callers are aware when they try to remove something
   * that doesn't exist.
   */
  remove(modelId: ModelId): void {
    if (!this.mappings.has(modelId)) {
      throw new ModelNotFoundError(modelId);
    }
    this.mappings.delete(modelId);
  }

  /**
   * Remove all model mappings.
   */
  clear(): void {
    this.mappings.clear();
  }

  /**
   * Get the number of registered model mappings.
   */
  get size(): number {
    return this.mappings.size;
  }
}