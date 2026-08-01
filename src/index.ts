// ============================================================================
// Stelaris AI Core — Public API
// ============================================================================
//
// This file is the single entry point for the library.
// It exports only the public surface — everything consumers need.
// ============================================================================

// ----------------------------------------------------------------------------
// Core AI Contracts
// ----------------------------------------------------------------------------

export {
  // Types
  type AIProvider,
  type ChatRequest,
  type ChatResponse,
  type StreamEvent,
  type StreamEventBase,
  type TextDeltaEvent,
  type ToolCallDeltaEvent,
  type UsageEvent,
  type FinishEvent,
  type ErrorEvent,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type HealthStatus,
  type ProviderId,
  type ModelId,
  type ModelDescriptor,
  type ModelCapabilities,
  type TokenUsage,
  type FinishReason,
  type Message,
  type MessageRole,
  type ContentPart,
  type TextPart,
  type ImagePart,
  type ImageUrlSource,
  type ImageBase64Source,
  type ToolCallPart,
  type ToolResultPart,
} from "./core/ai/types";

// ----------------------------------------------------------------------------
// Core AI Components
// ----------------------------------------------------------------------------

export {
  AIRegistry,
  ProviderAlreadyRegisteredError,
  ProviderNotFoundError,
} from "./core/ai/registry";

export { ModelRegistry, ModelAlreadyRegisteredError, ModelNotFoundError } from "./core/ai/model-registry";
export type { ModelMapping } from "./core/ai/model-registry";

export {
  ProviderRouter,
  UnknownModelError,
  ProviderUnavailableError,
} from "./core/ai/provider-router";

export { AIGateway, GatewayError } from "./core/ai/gateway";

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

export { createConfig, ConfigValidationError } from "./core/config/config";
export type { AppConfig, AIConfig, OllamaConfig, OpenAIConfig, ClaudeConfig, GeminiConfig } from "./core/config/config";

// ----------------------------------------------------------------------------
// Logging
// ----------------------------------------------------------------------------

export type { Logger, LogMetadata } from "./core/logging/logger";
export { ConsoleLogger } from "./core/logging/console-logger";

// ----------------------------------------------------------------------------
// Infrastructure — HTTP Helpers
// ----------------------------------------------------------------------------

export { fetchWithTimeout, TimeoutError } from "./infrastructure/http/fetch-with-timeout";
export { fetchWithRetry } from "./infrastructure/http/fetch-with-retry";

// ----------------------------------------------------------------------------
// Infrastructure — Providers
// ----------------------------------------------------------------------------

export { OllamaProvider } from "./infrastructure/ai/ollama/provider";
export type { OllamaProviderConfig } from "./infrastructure/ai/ollama/provider";
export { OpenAIProvider } from "./infrastructure/ai/openai/provider";
export type { OpenAIProviderConfig } from "./infrastructure/ai/openai/provider";

// ----------------------------------------------------------------------------
// Bootstrap (Composition Root)
// ----------------------------------------------------------------------------

export { createGateway } from "./core/bootstrap";
