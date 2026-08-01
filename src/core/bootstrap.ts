// ============================================================================
// Stelaris AI Core — Composition Root
// ============================================================================
//
// This is the application's Composition Root — the single place where all
// dependencies are created and wired together.
//
// Rules:
//   - Dependencies are created in exactly this file, in exactly one order
//   - No singleton class — exported values are plain module-scoped variables
//   - No service locator — consumers import what they need directly
//   - No dependency injection framework
//   - No process.env access (that belongs in createConfig() only)
// ============================================================================

import { createConfig, type AppConfig } from "@/core/config/config";
import { AIRegistry } from "@/core/ai/registry";
import { ModelRegistry } from "@/core/ai/model-registry";
import { ProviderRouter } from "@/core/ai/provider-router";
import { ConsoleLogger } from "@/core/logging/console-logger";
import { OllamaProvider } from "@/infrastructure/ai/ollama/provider";
import { OpenAIProvider } from "@/infrastructure/ai/openai/provider";
import { AIGateway } from "@/core/ai/gateway";
import type { ModelId, ProviderId } from "@/core/ai/types";

// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------
//
// createGateway() is the public factory for constructing a fully-wired
// AIGateway instance. It accepts an AppConfig (typically produced by
// createConfig()) and returns a ready-to-use gateway.
//
// The factory:
//   1. Creates a ConsoleLogger
//   2. Creates an AIRegistry and ModelRegistry
//   3. Instantiates providers with config + logger
//   4. Registers providers in the registry
//   5. Registers model-to-provider mappings
//   6. Creates a ProviderRouter from both registries
//   7. Creates and returns the AIGateway
//
// Consumers call this once at startup and reuse the returned gateway.
// No global state, no process.env access inside the factory.

export function createGateway(config: AppConfig): AIGateway {
  // 1. Logger
  const log = new ConsoleLogger();

  // 2. Registries
  const registry = new AIRegistry();
  const models = new ModelRegistry();

  // 3. Providers — only register providers that are actually configured.
  //    A provider must not be instantiated when its required configuration
  //    (e.g. API key) is missing, otherwise its constructor throws and the
  //    entire gateway fails to start — even when the provider is unused.
  if (config.ai.ollama.baseUrl) {
    const ollama = new OllamaProvider(
      {
        ...config.ai.ollama,
        timeoutMs: config.ai.timeoutMs,
        retryCount: config.ai.retryCount,
      },
      log,
    );
    registry.register(ollama);
  }

  if (config.ai.openai.apiKey) {
    const openai = new OpenAIProvider(
      {
        ...config.ai.openai,
        timeoutMs: config.ai.timeoutMs,
        retryCount: config.ai.retryCount,
      },
      log,
    );
    registry.register(openai);
  }

  // 4. Model mappings
  models.register("qwen3:8b" as ModelId, "ollama" as ProviderId);
  models.register("qwen2.5-coder:7b" as ModelId, "ollama" as ProviderId);
  models.register("gpt-4.1" as ModelId, "openai" as ProviderId);
  models.register("gpt-4.1-mini" as ModelId, "openai" as ProviderId);
  models.register("gpt-4o" as ModelId, "openai" as ProviderId);
  models.register("gpt-4o-mini" as ModelId, "openai" as ProviderId);

  // 5. Router
  const router = new ProviderRouter(models, registry);

  // 6. Gateway
  return new AIGateway(config, router, log);
}
