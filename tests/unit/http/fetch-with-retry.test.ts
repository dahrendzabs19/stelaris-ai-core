import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithRetry } from "@/infrastructure/http/fetch-with-retry";
import { TimeoutError } from "@/infrastructure/http/fetch-with-timeout";
import type { Logger } from "@/core/logging/logger";

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("fetchWithRetry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns response on first successful attempt", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);
    const log = createMockLogger();

    const response = await fetchWithRetry(
      "http://example.com", { method: "GET" }, 5000, 2, log, { provider: "test" },
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries on TimeoutError and succeeds", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TimeoutError(5000))
      .mockResolvedValueOnce(mockResponse);
    const log = createMockLogger();

    const response = await fetchWithRetry(
      "http://example.com", { method: "GET" }, 5000, 2, log, { provider: "test" },
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledWith(
      "Retry attempt triggered",
      expect.objectContaining({ attempt: "2/3", reason: "TimeoutError" }),
    );
  });

  it("retries on HTTP 503 and succeeds", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }))
      .mockResolvedValueOnce(mockResponse);
    const log = createMockLogger();

    const response = await fetchWithRetry(
      "http://example.com", { method: "GET" }, 5000, 2, log, { provider: "test" },
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledWith(
      "Retry attempt triggered",
      expect.objectContaining({ attempt: "2/3", reason: "HTTP 503" }),
    );
  });

  it("retries on HTTP 502 and 504", async () => {
    const log = createMockLogger();

    for (const status of [502, 504]) {
      vi.restoreAllMocks();
      const mockResponse = new Response("ok", { status: 200 });
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("Error", { status }))
        .mockResolvedValueOnce(mockResponse);

      const response = await fetchWithRetry(
        "http://example.com", { method: "GET" }, 5000, 2, log, { provider: "test" },
      );

      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    }
  });

  it("does not retry on HTTP 400", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("Bad Request", { status: 400 }));
    const log = createMockLogger();

    const response = await fetchWithRetry(
      "http://example.com", { method: "GET" }, 5000, 2, log, { provider: "test" },
    );

    expect(response.status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not retry on HTTP 401", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    const log = createMockLogger();

    const response = await fetchWithRetry(
      "http://example.com", { method: "GET" }, 5000, 2, log, { provider: "test" },
    );

    expect(response.status).toBe(401);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not retry on HTTP 403", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const log = createMockLogger();

    const response = await fetchWithRetry(
      "http://example.com", { method: "GET" }, 5000, 2, log, { provider: "test" },
    );

    expect(response.status).toBe(403);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not retry on HTTP 404", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("Not Found", { status: 404 }));
    const log = createMockLogger();

    const response = await fetchWithRetry(
      "http://example.com", { method: "GET" }, 5000, 2, log, { provider: "test" },
    );

    expect(response.status).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not retry on HTTP 422", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("Unprocessable", { status: 422 }));
    const log = createMockLogger();

    const response = await fetchWithRetry(
      "http://example.com", { method: "GET" }, 5000, 2, log, { provider: "test" },
    );

    expect(response.status).toBe(422);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries on network error (TypeError)", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(mockResponse);
    const log = createMockLogger();

    const response = await fetchWithRetry(
      "http://example.com", { method: "GET" }, 5000, 2, log, { provider: "test" },
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws last error when all retries exhausted", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const log = createMockLogger();

    await expect(
      fetchWithRetry("http://example.com", { method: "GET" }, 5000, 2, log, { provider: "test" }),
    ).rejects.toThrow(TypeError);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("does not retry when retryCount is 0", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const log = createMockLogger();

    await expect(
      fetchWithRetry("http://example.com", { method: "GET" }, 5000, 0, log, { provider: "test" }),
    ).rejects.toThrow(TypeError);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("includes provider and model in log metadata", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }))
      .mockResolvedValueOnce(mockResponse);
    const log = createMockLogger();

    await fetchWithRetry(
      "http://example.com", { method: "GET" }, 5000, 2, log, { provider: "ollama", model: "qwen3:8b" },
    );

    expect(log.warn).toHaveBeenCalledWith(
      "Retry attempt triggered",
      expect.objectContaining({ provider: "ollama", model: "qwen3:8b" }),
    );
  });
});