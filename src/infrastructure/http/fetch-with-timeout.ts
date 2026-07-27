// ============================================================================
// Stelaris AI — HTTP Fetch with Timeout
// ============================================================================
//
// A small reusable helper that wraps fetch with AbortController-based timeout.
//
// Usage:
// ```ts
// import { fetchWithTimeout } from "@/infrastructure/http/fetch-with-timeout";
//
// const response = await fetchWithTimeout(
//   "https://api.openai.com/v1/chat/completions",
//   { method: "POST", headers: {...}, body: "..." },
//   30000,  // 30 second timeout
// );
// ```
// ============================================================================

// ----------------------------------------------------------------------------
// Error
// ----------------------------------------------------------------------------

/**
 * Error thrown when an HTTP request exceeds the configured timeout.
 */
export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

// ----------------------------------------------------------------------------
// fetchWithTimeout
// ----------------------------------------------------------------------------

/**
 * Wraps the native fetch API with an AbortController-based timeout.
 *
 * If the request does not complete within `timeoutMs` milliseconds,
 * the signal is aborted and a `TimeoutError` is thrown.
 *
 * @param url     - The URL to fetch
 * @param options - Standard fetch options (method, headers, body, etc.)
 * @param timeoutMs - Timeout in milliseconds
 * @returns The fetch Response
 * @throws {TimeoutError} If the request exceeds the timeout
 * @throws {Error} Any error from the underlying fetch
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new TimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}