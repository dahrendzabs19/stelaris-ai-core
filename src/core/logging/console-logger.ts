// ============================================================================
// Stelaris AI Core — Console Logger
// ============================================================================
//
// A Logger implementation that writes structured logs to the console.
//
// Format:
//   [LEVEL] message { "key": "value", ... }
//
// Rules:
//   - Uses native console methods (no external libraries)
//   - Never logs sensitive data (API keys, tokens, prompts, responses)
//   - Metadata is serialized as JSON for machine readability
// ============================================================================

import type { Logger, LogMetadata } from "./logger";

// ----------------------------------------------------------------------------
// Timestamp
// ----------------------------------------------------------------------------

/**
 * Format the current time as an ISO 8601 string.
 */
function timestamp(): string {
  return new Date().toISOString();
}

// ----------------------------------------------------------------------------
// Console Logger
// ----------------------------------------------------------------------------

/**
 * Logger implementation that writes to the console.
 *
 * Each log entry is formatted as:
 *   [LEVEL] YYYY-MM-DDTHH:mm:ss.sssZ message { metadata }
 *
 * The metadata is serialized as compact JSON. If no metadata is provided,
 * the JSON portion is omitted.
 *
 * Usage:
 * ```ts
 * const log = new ConsoleLogger();
 * log.info("Request started", { provider: "ollama", model: "qwen3:8b" });
 * // Output: [INFO] 2026-07-27T22:00:00.000Z Request started { "provider": "ollama", "model": "qwen3:8b" }
 * ```
 */
export class ConsoleLogger implements Logger {
  debug(message: string, metadata?: LogMetadata): void {
    console.debug(this.format("DEBUG", message, metadata));
  }

  info(message: string, metadata?: LogMetadata): void {
    console.info(this.format("INFO", message, metadata));
  }

  warn(message: string, metadata?: LogMetadata): void {
    console.warn(this.format("WARN", message, metadata));
  }

  error(message: string, metadata?: LogMetadata): void {
    console.error(this.format("ERROR", message, metadata));
  }

  /**
   * Format a log entry into a consistent string.
   */
  private format(
    level: string,
    message: string,
    metadata?: LogMetadata,
  ): string {
    const time = timestamp();
    const base = `[${level}] ${time} ${message}`;

    if (metadata === undefined || Object.keys(metadata).length === 0) {
      return base;
    }

    return `${base} ${JSON.stringify(metadata)}`;
  }
}