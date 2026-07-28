// ============================================================================
// Stelaris AI — HTTP Fetch with Retry
// ============================================================================
//
// A simple retry wrapper around fetchWithTimeout.
//
// Retry policy:
//   - Only retries on: TimeoutError, network errors, HTTP 502, 503, 504
//   - Never retries on: 4xx client errors (400, 401, 403, 404, 422, etc.)
//   - No exponential backoff, no jitter, no circuit breaker
//
// Retry behavior is transparent — callers receive the result of the last
// attempt regardless of how many retries were made.
// ============================================================================

import { fetchWithTimeout, TimeoutError } from "./fetch-with-timeout";
import type { Logger } from "@/core/logging/logger";

// ----------------------------------------------------------------------------
// Retryable Status Codes
// ----------------------------------------------------------------------------

/**
 * HTTP status codes that are eligible for retry.
 *
 * These indicate server-side issues that may be transient:
 *   502 — Bad Gateway
 *   503 — Service Unavailable
 *   504 — Gateway Timeout
 */
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);

/**
 * Returns true if the error or status code should trigger a retry.
 */
function isRetryable(error: unknown, status?: number): boolean {
  // HTTP status-based retry
  if (status !== undefined && RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }

  // Timeout errors are retryable
  if (error instanceof TimeoutError) {
    return true;
  }

  // Network errors (fetch throws TypeError for DNS failures, connection refused, etc.)
  if (error instanceof TypeError) {
    return true;
  }

  // Fetch throws other errors on network failures
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }

  return false;
}

// ----------------------------------------------------------------------------
// fetchWithRetry
// ----------------------------------------------------------------------------

/**
 * Wraps fetchWithTimeout with a simple retry mechanism.
 *
 * The initial request plus up to `retryCount` retries are attempted.
 * With retryCount=0, exactly 1 request is made (no retries).
 * With retryCount=2, up to 3 total attempts are made.
 *
 * Retries only occur for:
 *   - TimeoutError (request exceeded timeout)
 *   - Network errors (DNS failures, connection refused)
 *   - HTTP 502, 503, 504 (server-side transient errors)
 *
 * All other errors are thrown immediately without retry.
 *
 * @param url       - The URL to fetch
 * @param options   - Standard fetch options
 * @param timeoutMs - Timeout in milliseconds per attempt
 * @param retryCount - Maximum number of retries (0 = no retries)
 * @param log       - Logger for structured logging
 * @param metadata  - Safe metadata (provider, model) for log context
 * @returns The fetch Response
 * @throws {Error} The last error encountered if all retries are exhausted
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  retryCount: number,
  log: Logger,
  metadata: { provider: string; model?: string },
): Promise<Response> {
  const maxAttempts = 1 + retryCount;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);

      // Successful response — return immediately
      if (response.ok) {
        return response;
      }

      // Check if the status code is retryable
      if (isRetryable(undefined, response.status)) {
        lastError = response;
        if (attempt < maxAttempts) {
          log.warn("Retry attempt triggered", {
            provider: metadata.provider,
            model: metadata.model,
            attempt: `${attempt + 1}/${maxAttempts}`,
            reason: `HTTP ${response.status}`,
          });
        }
        continue;
      }

      // Non-retryable status — throw immediately
      return response;
    } catch (error) {
      lastError = error;

      if (isRetryable(error)) {
        if (attempt < maxAttempts) {
          log.warn("Retry attempt triggered", {
            provider: metadata.provider,
            model: metadata.model,
            attempt: `${attempt + 1}/${maxAttempts}`,
            reason: error instanceof Error ? error.name : "UnknownError",
          });
        }
        continue;
      }

      // Non-retryable error — throw immediately
      throw error;
    }
  }

  // All attempts exhausted
  throw lastError;
}