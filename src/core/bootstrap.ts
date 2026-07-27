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
import { OllamaProvider } from "@/infrastructure/ai/ollama/provider";
import { AIGateway } from "@/core/ai/gateway";

// ----------------------------------------------------------------------------
// 1. Configuration
// ----------------------------------------------------------------------------
//
// Configuration reads from process.env and validates required values.
// This is the ONLY place where process.env is read indirectly (through
// createConfig()). No other module should access process.env.

const config = createConfig();

// ----------------------------------------------------------------------------
// 2. Registry
// ----------------------------------------------------------------------------
//
// The registry is a simple catalog. Providers are registered after creation.

const registry = new AIRegistry();

// ----------------------------------------------------------------------------
// 3. Providers
// ----------------------------------------------------------------------------
//
// Providers receive their configuration section and are registered immediately.
// This is the ONLY place where providers are instantiated and registered.

const ollama = new OllamaProvider(config.ai.ollama);
registry.register(ollama);

// ----------------------------------------------------------------------------
// 4. Gateway
// ----------------------------------------------------------------------------
//
// The Gateway receives the full config and the populated registry.
// It orchestrates operations by looking up providers from the registry.

const gateway = new AIGateway(config, registry);

// ----------------------------------------------------------------------------
// Exports
// ----------------------------------------------------------------------------
//
// Export the wired dependencies so application code (API routes, etc.)
// can consume them without knowing how they were constructed.

export { config, registry, gateway };