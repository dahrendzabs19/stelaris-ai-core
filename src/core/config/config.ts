// ============================================================================
// Stelaris AI Core — Application Configuration
// ============================================================================
//
// This is the single source of truth for all application configuration.
//
// Rules:
//   - Pure TypeScript (no React, no Next.js, no fetch)
//   - No singleton, no global mutable state
//   - No business logic, no provider creation
//   - No module except this one reads process.env directly
//   - Configuration is immutable after creation
// ============================================================================

// ----------------------------------------------------------------------------
// Environment Variable Names
// ----------------------------------------------------------------------------
//
// All environment variable names are defined here to avoid magic strings
// scattered throughout the file. This also makes it easy to audit which
// variables the application depends on.

const ENV = {
  OLLAMA_BASE_URL: "OLLAMA_BASE_URL",
  OPENAI_API_KEY: "OPENAI_API_KEY",
  CLAUDE_API_KEY: "CLAUDE_API_KEY",
  GEMINI_API_KEY: "GEMINI_API_KEY",
  AI_TIMEOUT_MS: "AI_TIMEOUT_MS",
  AI_RETRY_COUNT: "AI_RETRY_COUNT",
} as const;

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/**
 * Ollama-specific configuration.
 *
 * Ollama is the first provider integrated into the platform.
 * It requires a base URL pointing to the running Ollama server.
 */
export interface OllamaConfig {
  /** Base URL of the Ollama server (e.g., "http://localhost:11434") */
  readonly baseUrl: string;
}

/**
 * OpenAI-specific configuration.
 *
 * Optional until OpenAI provider integration is implemented.
 */
export interface OpenAIConfig {
  /** OpenAI API key */
  readonly apiKey?: string;
}

/**
 * Claude (Anthropic)-specific configuration.
 *
 * Optional until Claude provider integration is implemented.
 */
export interface ClaudeConfig {
  /** Anthropic API key */
  readonly apiKey?: string;
}

/**
 * Gemini-specific configuration.
 *
 * Optional until Gemini provider integration is implemented.
 */
export interface GeminiConfig {
  /** Google AI API key */
  readonly apiKey?: string;
}

/**
 * AI platform configuration section.
 *
 * Contains configuration for every supported AI provider.
 * Providers without an active integration simply have empty config objects.
 */
export interface AIConfig {
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
export interface AppConfig {
  readonly ai: AIConfig;
}

// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------

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
export function createConfig(): AppConfig {
  const ollamaBaseUrl = readOptional(
    ENV.OLLAMA_BASE_URL,
    "http://localhost:11434",
  );

  const timeoutMs = readOptionalNumber(
    ENV.AI_TIMEOUT_MS,
    30000,
  );

  const retryCount = readOptionalNumber(
    ENV.AI_RETRY_COUNT,
    2,
  );

  const config: AppConfig = {
    ai: {
      timeoutMs,
      retryCount,
      ollama: {
        baseUrl: ollamaBaseUrl,
      },
      openai: {
        apiKey: process.env[ENV.OPENAI_API_KEY] || undefined,
      },
      claude: {
        apiKey: process.env[ENV.CLAUDE_API_KEY] || undefined,
      },
      gemini: {
        apiKey: process.env[ENV.GEMINI_API_KEY] || undefined,
      },
    },
  };

  return deepFreeze(config);
}

// ----------------------------------------------------------------------------
// Error
// ----------------------------------------------------------------------------

/**
 * Error thrown when required configuration is missing or invalid.
 */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Read a required environment variable.
 *
 * Throws a descriptive `ConfigValidationError` if the variable is not set
 * or is empty. The error message includes the variable name so developers
 * know exactly what to configure.
 *
 * @param name - The environment variable name (e.g., "OLLAMA_BASE_URL")
 * @param hint  - A human-readable hint explaining what value is expected
 * @returns The trimmed value of the environment variable
 * @throws {ConfigValidationError} If the variable is missing or empty
 */
function readRequired(name: string, hint: string): string {
  const value = process.env[name];

  if (value === undefined || value === null || value.trim() === "") {
    throw new ConfigValidationError(`Missing required environment variable: ${name}\n  ${hint}`);
  }

  return value.trim();
}

/**
 * Read an optional environment variable with a fallback.
 *
 * If the variable is not set or empty, the default value is returned.
 */
function readOptional(name: string, fallback: string): string {
  const value = process.env[name];

  if (value === undefined || value === null || value.trim() === "") {
    return fallback;
  }

  return value.trim();
}

/**
 * Read an optional numeric environment variable with a fallback.
 *
 * If the variable is not set, empty, or not a valid positive integer,
 * the default value is returned. This allows configuration to have
 * sensible defaults that can be overridden via environment.
 */
function readOptionalNumber(name: string, fallback: number): number {
  const value = process.env[name];

  if (value === undefined || value === null || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value.trim());

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

/**
 * Deeply freeze an object and all nested objects.
 *
 * This ensures configuration cannot be mutated after creation.
 * Attempting to modify a frozen property will throw in strict mode
 * or silently fail in non-strict mode.
 *
 * Arrays are also frozen to prevent push/pop mutations.
 */
function deepFreeze<T extends object>(obj: T): T {
  const propNames = Object.getOwnPropertyNames(obj);

  for (const name of propNames) {
    const value = (obj as Record<string, unknown>)[name];

    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  }

  return Object.freeze(obj);
}