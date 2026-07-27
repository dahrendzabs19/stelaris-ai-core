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

import { createConfig } from "@/core/config/config";
import { AIRegistry } from "@/core/ai/registry";
import { ModelRegistry } from "@/core/ai/model-registry";
import { ProviderRouter } from "@/core/ai/provider-router";
import { ConsoleLogger } from "@/core/logging/console-logger";
import { OllamaProvider } from "@/infrastructure/ai/ollama/provider";
import { AIGateway } from "@/core/ai/gateway";
import type { ModelId, ProviderId } from "@/core/ai/types";

// ----------------------------------------------------------------------------
// 1. Configuration
// ----------------------------------------------------------------------------
//
// Configuration reads from process.env and validates required values.
// This is the ONLY place where process.env is read indirectly (through
// createConfig()). No other module should access process.env.

const config = createConfig();

// ----------------------------------------------------------------------------
// 2. Logger
// ----------------------------------------------------------------------------
//
// A single logger instance is shared across the application.
// It implements the Logger interface — no module references ConsoleLogger
// directly except this composition root.

const log = new ConsoleLogger();

// ----------------------------------------------------------------------------
// 3. Registry
// ----------------------------------------------------------------------------
//
// The registry is a simple catalog. Providers are registered after creation.

const registry = new AIRegistry();
const models = new ModelRegistry();

// ----------------------------------------------------------------------------
// 4. Providers
// ----------------------------------------------------------------------------
//
// Providers receive their configuration section and a logger, then are
// registered immediately. This is the ONLY place where providers are
// instantiated and registered. Model-to-provider mappings are also here.

const ollama = new OllamaProvider(
  {
    ...config.ai.ollama,
    timeoutMs: config.ai.timeoutMs,
  },
  log,
);
registry.register(ollama);

models.register("qwen3:8b" as ModelId, "ollama" as ProviderId);
models.register("qwen2.5-coder:7b" as ModelId, "ollama" as ProviderId);

// ----------------------------------------------------------------------------
// 5. Router
// ----------------------------------------------------------------------------
//
// The Provider Router combines both registries to resolve model IDs
// to AIProvider instances.

const router = new ProviderRouter(models, registry);

// ----------------------------------------------------------------------------
// 6. Gateway
// ----------------------------------------------------------------------------
//
// The Gateway receives the full config, the router, and the logger.
// It resolves providers automatically from the model ID in each request.

const gateway = new AIGateway(config, router, log);

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------
//
// Export the wired dependencies so application code (API routes, etc.)
// can consume them without knowing how they were constructed.

export { config, registry, models, router, gateway };