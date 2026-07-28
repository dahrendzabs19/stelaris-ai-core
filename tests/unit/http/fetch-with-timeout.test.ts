import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithTimeout, TimeoutError } from "@/infrastructure/http/fetch-with-timeout";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns response on successful fetch", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const response = await fetchWithTimeout("http://example.com", { method: "GET" }, 5000);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("throws TimeoutError when request exceeds timeout", async () => {
    // Mock fetch to listen for the AbortSignal and reject when aborted,
    // matching native fetch behavior.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input: string | URL | Request, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = options?.signal;
          if (signal instanceof AbortSignal) {
            signal.addEventListener(
              "abort",
              () => {
                reject(new DOMException("The operation was aborted", "AbortError"));
              },
              { once: true },
            );
          }
        }),
    );

    await expect(
      fetchWithTimeout("http://example.com", { method: "GET" }, 10),
    ).rejects.toThrow(TimeoutError);
  });

  it("throws non-timeout errors as-is", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      fetchWithTimeout("http://example.com", { method: "GET" }, 5000),
    ).rejects.toThrow(TypeError);
  });

  it("passes options to fetch", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    await fetchWithTimeout(
      "http://example.com",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      5000,
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://example.com",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );
  });

  it("adds AbortSignal to fetch options", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    await fetchWithTimeout("http://example.com", { method: "GET" }, 5000);

    const callOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(callOptions.signal).toBeInstanceOf(AbortSignal);
  });
});