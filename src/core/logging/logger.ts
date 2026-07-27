// ============================================================================
// Stelaris AI Core — Logger Interface
// ============================================================================
//
// This is the logging abstraction for the entire application.
//
// Rules:
//   - Pure TypeScript — no React, no Next.js, no external libraries
//   - Provider-agnostic — independent of log transport or formatting
//   - No implementation logic — this is the contract only
// ============================================================================

/**
 * Structured metadata for log entries.
 *
 * Contains safe, non-sensitive information about the operation being logged.
 * Never include:
 *   - API keys or tokens
 *   - Authorization headers
 *   - User prompt contents
 *   - AI response contents
 *   - Embedding vectors
 *   - Personally identifiable information (PII)
 */
export interface LogMetadata {
  /** The provider handling the request (e.g., "ollama", "openai") */
  provider?: string;

  /** The model being used (e.g., "gpt-4o", "qwen3:8b") */
  model?: string;

  /** Duration of the operation in milliseconds */
  latencyMs?: number;

  /** HTTP status code (for API responses) */
  status?: number;

  /** Error name (for error entries) */
  error?: string;

  /** Any other safe, non-sensitive metadata */
  [key: string]: unknown;
}

/**
 * Logger interface for structured, safe logging.
 *
 * Every module that needs logging should depend on this interface,
 * never on a concrete logger implementation.
 *
 * Usage:
 * ```ts
 * class MyModule {
 *   constructor(private readonly log: Logger) {}
 *
 *   doSomething(): void {
 *     this.log.info("Operation started", { model: "gpt-4o" });
 *   }
 * }
 * ```
 */
export interface Logger {
  /**
   * Log a debug message.
   *
   * Use for detailed diagnostic information during development.
   */
  debug(message: string, metadata?: LogMetadata): void;

  /**
   * Log an informational message.
   *
   * Use for normal operation events (request started, request finished).
   */
  info(message: string, metadata?: LogMetadata): void;

  /**
   * Log a warning message.
   *
   * Use for unexpected but non-fatal situations (timeouts, retries).
   */
  warn(message: string, metadata?: LogMetadata): void;

  /**
   * Log an error message.
   *
   * Use for failures that may require attention.
   */
  error(message: string, metadata?: LogMetadata): void;
}