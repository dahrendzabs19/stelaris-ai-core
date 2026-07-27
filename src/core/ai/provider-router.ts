// ============================================================================
// Stelaris AI Core — Provider Router
// ============================================================================
//
// The Provider Router resolves a model ID to an AIProvider instance.
//
// It combines two registries:
//   1. ModelRegistry  →  modelId → providerId
//   2. AIRegistry     →  providerId → AIProvider instance
//
// This allows application code to specify only a model ID without knowing
// which provider hosts it. The router handles the resolution.
//
// Responsibilities:
//   - Look up the provider for a given model ID
//
// Non-responsibilities (handled by other components):
//   - Retries
//   - Fallback
//   - Load balancing
//   - Model selection
//   - Routing heuristics
//
// Rules:
//   - No static methods
//   - No singleton
//   - No process.env
//   - No provider-specific logic
//   - Pure lookup only
// ============================================================================

import type { AIProvider, ModelId, ProviderId } from "./types";
import { ModelRegistry, ModelNotFoundError } from "./model-registry";
import { AIRegistry, ProviderNotFoundError } from "./registry";

// ----------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------

/**
 * Error thrown when a model ID is not registered in the ModelRegistry.
 */
export class UnknownModelError extends Error {
  constructor(modelId: ModelId) {
    super(
      `Unknown model "${modelId}". No provider is registered for this model.`,
    );
    this.name = "UnknownModelError";
  }
}

/**
 * Error thrown when the provider for a model is not available in the AIRegistry.
 */
export class ProviderUnavailableError extends Error {
  constructor(
    modelId: ModelId,
    providerId: string,
  ) {
    super(
      `Provider "${providerId}" for model "${modelId}" is not registered or unavailable.`,
    );
    this.name = "ProviderUnavailableError";
  }
}

// ----------------------------------------------------------------------------
// Provider Router
// ----------------------------------------------------------------------------

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
export class ProviderRouter {
  private readonly modelRegistry: ModelRegistry;
  private readonly aiRegistry: AIRegistry;

  constructor(modelRegistry: ModelRegistry, aiRegistry: AIRegistry) {
    this.modelRegistry = modelRegistry;
    this.aiRegistry = aiRegistry;
  }

  /**
   * Resolve a model ID to its AIProvider instance.
   *
   * @param modelId - The model to look up
   * @returns The AIProvider that hosts this model
   * @throws {UnknownModelError} If the model is not registered in the ModelRegistry
   * @throws {ProviderUnavailableError} If the provider is not registered in the AIRegistry
   */
  resolve(modelId: ModelId): AIProvider {
    // Step 1: modelId → providerId
    let providerId: string;
    try {
      providerId = this.modelRegistry.getProvider(modelId);
    } catch (error) {
      if (error instanceof ModelNotFoundError) {
        throw new UnknownModelError(modelId);
      }
      throw error;
    }

    // Step 2: providerId → AIProvider
    try {
      return this.aiRegistry.get(providerId as ProviderId);
    } catch (error) {
      if (error instanceof ProviderNotFoundError) {
        throw new ProviderUnavailableError(modelId, providerId);
      }
      throw error;
    }
  }
}