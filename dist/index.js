// src/core/ai/registry.ts
var ProviderAlreadyRegisteredError = class extends Error {
  constructor(providerId) {
    super(`Provider "${providerId}" is already registered`);
    this.name = "ProviderAlreadyRegisteredError";
  }
};
var ProviderNotFoundError = class extends Error {
  constructor(providerId) {
    super(`Provider "${providerId}" is not registered`);
    this.name = "ProviderNotFoundError";
  }
};
var AIRegistry = class {
  constructor() {
    /** Internal storage: provider ID → provider instance */
    this.providers = /* @__PURE__ */ new Map();
  }
  /**
   * Register a new provider.
   *
   * Throws `ProviderAlreadyRegisteredError` if a provider with the same ID
   * is already registered. This prevents silent overwrites and makes
   * duplicate registration bugs visible immediately.
   */
  register(provider) {
    if (this.providers.has(provider.id)) {
      throw new ProviderAlreadyRegisteredError(provider.id);
    }
    this.providers.set(provider.id, provider);
  }
  /**
   * Unregister a provider by its ID.
   *
   * Throws `ProviderNotFoundError` if no provider with the given ID exists.
   * This ensures callers are aware when they try to remove something
   * that doesn't exist.
   */
  unregister(providerId) {
    if (!this.providers.has(providerId)) {
      throw new ProviderNotFoundError(providerId);
    }
    this.providers.delete(providerId);
  }
  /**
   * Retrieve a provider by its ID.
   *
   * Throws `ProviderNotFoundError` if the provider is not registered.
   * Fail-fast behavior ensures that missing providers are caught early
   * rather than causing cryptic errors downstream.
   */
  get(providerId) {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new ProviderNotFoundError(providerId);
    }
    return provider;
  }
  /**
   * List all registered providers.
   *
   * Returns a new array each time to prevent callers from mutating
   * the internal registry state.
   */
  list() {
    return Array.from(this.providers.values());
  }
  /**
   * Check whether a provider is registered.
   *
   * Useful for conditional logic without exception handling:
   * ```ts
   * if (registry.has("ollama")) {
   *   const provider = registry.get("ollama");
   * }
   * ```
   */
  has(providerId) {
    return this.providers.has(providerId);
  }
  /**
   * Get the number of registered providers.
   */
  get size() {
    return this.providers.size;
  }
};

// src/core/ai/model-registry.ts
var ModelAlreadyRegisteredError = class extends Error {
  constructor(modelId) {
    super(`Model "${modelId}" is already registered`);
    this.name = "ModelAlreadyRegisteredError";
  }
};
var ModelNotFoundError = class extends Error {
  constructor(modelId) {
    super(`Model "${modelId}" is not registered`);
    this.name = "ModelNotFoundError";
  }
};
var ModelRegistry = class {
  constructor() {
    /** Internal storage: model ID → provider ID */
    this.mappings = /* @__PURE__ */ new Map();
  }
  /**
   * Register a model-to-provider mapping.
   *
   * Throws `ModelAlreadyRegisteredError` if the model is already mapped.
   * This prevents silent overwrites and makes duplicate registration bugs
   * visible immediately.
   */
  register(modelId, providerId) {
    if (this.mappings.has(modelId)) {
      throw new ModelAlreadyRegisteredError(modelId);
    }
    this.mappings.set(modelId, providerId);
  }
  /**
   * Look up the provider that hosts a given model.
   *
   * Throws `ModelNotFoundError` if the model is not registered.
   * Fail-fast behavior ensures that missing models are caught early
   * rather than causing cryptic errors downstream.
   */
  getProvider(modelId) {
    const providerId = this.mappings.get(modelId);
    if (!providerId) {
      throw new ModelNotFoundError(modelId);
    }
    return providerId;
  }
  /**
   * Check whether a model is registered.
   *
   * Useful for conditional logic without exception handling:
   * ```ts
   * if (models.has("gpt-4o")) {
   *   const provider = models.getProvider("gpt-4o");
   * }
   * ```
   */
  has(modelId) {
    return this.mappings.has(modelId);
  }
  /**
   * List all registered model-to-provider mappings.
   *
   * Returns a new array each time to prevent callers from mutating
   * the internal registry state.
   */
  list() {
    return Array.from(this.mappings.entries()).map(([modelId, providerId]) => ({
      modelId,
      providerId
    }));
  }
  /**
   * Remove a model mapping by its model ID.
   *
   * Throws `ModelNotFoundError` if no mapping with the given model ID exists.
   * This ensures callers are aware when they try to remove something
   * that doesn't exist.
   */
  remove(modelId) {
    if (!this.mappings.has(modelId)) {
      throw new ModelNotFoundError(modelId);
    }
    this.mappings.delete(modelId);
  }
  /**
   * Remove all model mappings.
   */
  clear() {
    this.mappings.clear();
  }
  /**
   * Get the number of registered model mappings.
   */
  get size() {
    return this.mappings.size;
  }
};

// src/core/ai/provider-router.ts
var UnknownModelError = class extends Error {
  constructor(modelId) {
    super(
      `Unknown model "${modelId}". No provider is registered for this model.`
    );
    this.name = "UnknownModelError";
  }
};
var ProviderUnavailableError = class extends Error {
  constructor(modelId, providerId) {
    super(
      `Provider "${providerId}" for model "${modelId}" is not registered or unavailable.`
    );
    this.name = "ProviderUnavailableError";
  }
};
var ProviderRouter = class {
  constructor(modelRegistry, aiRegistry) {
    this.modelRegistry = modelRegistry;
    this.aiRegistry = aiRegistry;
  }
  /**
   * Resolve a model ID to its AIProvider instance.
   *
   * @param modelId - The model to look up
   * @returns The AIProvider that hosts this model
   * @throws {UnknownModelError} If the model is not registered in the ModelRegistry
   * @throws {ProviderUnavailableError} If the provider is not registered in the AIRegistry
   */
  resolve(modelId) {
    let providerId;
    try {
      providerId = this.modelRegistry.getProvider(modelId);
    } catch (error) {
      if (error instanceof ModelNotFoundError) {
        throw new UnknownModelError(modelId);
      }
      throw error;
    }
    try {
      return this.aiRegistry.get(providerId);
    } catch (error) {
      if (error instanceof ProviderNotFoundError) {
        throw new ProviderUnavailableError(modelId, providerId);
      }
      throw error;
    }
  }
};

// src/core/ai/gateway.ts
var GatewayError = class extends Error {
  constructor(message, providerId, cause) {
    super(message);
    this.providerId = providerId;
    this.cause = cause;
    this.name = "GatewayError";
  }
};
var AIGateway = class {
  /**
   * @param config - Application configuration (provider settings, etc.)
   * @param router - Provider router that resolves model IDs to AIProvider instances
   * @param log    - Logger for structured, safe logging
   */
  constructor(config, router, log) {
    this.config = config;
    this.router = router;
    this.log = log;
  }
  // --------------------------------------------------------------------------
  // Chat
  // --------------------------------------------------------------------------
  /**
   * Send a chat completion request to the appropriate provider.
   *
   * The provider is determined automatically from the model ID in the request.
   *
   * @param request - The generic chat completion request
   * @returns The generic chat completion response
   * @throws {GatewayError} If the provider is not found or the request fails
   */
  async chat(request) {
    this.log.info("Gateway: chat request received", {
      model: request.model
    });
    const provider = this.router.resolve(request.model);
    this.log.info("Gateway: provider resolved", {
      provider: provider.id,
      model: request.model
    });
    try {
      return await provider.chat(request);
    } catch (error) {
      this.log.error("Gateway: chat request failed", {
        provider: provider.id,
        model: request.model,
        error: error instanceof Error ? error.name : "UnknownError"
      });
      throw new GatewayError(
        `Chat request for model "${request.model}" failed`,
        request.model,
        error
      );
    }
  }
  // --------------------------------------------------------------------------
  // Stream
  // --------------------------------------------------------------------------
  /**
   * Send a streaming chat completion request to the appropriate provider.
   *
   * The provider is determined automatically from the model ID in the request.
   * Yields discriminated StreamEvents as they arrive from the provider.
   * A successful stream ends with a FinishEvent; a protocol-level failure is
   * represented by an ErrorEvent.
   *
   * @param request - The generic chat completion request
   * @returns An async iterable of stream events
   * @throws {GatewayError} If the provider is not found or the stream fails
   */
  async *stream(request) {
    this.log.info("Gateway: stream request received", {
      model: request.model
    });
    const provider = this.router.resolve(request.model);
    this.log.info("Gateway: provider resolved for stream", {
      provider: provider.id,
      model: request.model
    });
    try {
      for await (const event of provider.stream(request)) {
        yield event;
      }
    } catch (error) {
      this.log.error("Gateway: stream request failed", {
        provider: provider.id,
        model: request.model,
        error: error instanceof Error ? error.name : "UnknownError"
      });
      throw new GatewayError(
        `Stream request for model "${request.model}" failed`,
        request.model,
        error
      );
    }
  }
  // --------------------------------------------------------------------------
  // Embed
  // --------------------------------------------------------------------------
  /**
   * Generate embeddings using the appropriate provider.
   *
   * The provider is determined automatically from the model ID in the request.
   *
   * @param request - The generic embedding request
   * @returns The generic embedding response
   * @throws {GatewayError} If the provider is not found or the request fails
   */
  async embed(request) {
    this.log.info("Gateway: embed request received", {
      model: request.model
    });
    const provider = this.router.resolve(request.model);
    this.log.info("Gateway: provider resolved for embed", {
      provider: provider.id,
      model: request.model
    });
    try {
      return await provider.embed(request);
    } catch (error) {
      this.log.error("Gateway: embed request failed", {
        provider: provider.id,
        model: request.model,
        error: error instanceof Error ? error.name : "UnknownError"
      });
      throw new GatewayError(
        `Embed request for model "${request.model}" failed`,
        request.model,
        error
      );
    }
  }
  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------
  /**
   * Check the health of the provider for a given model.
   *
   * @param modelId - The model ID to resolve the provider
   * @returns The health status of the provider
   * @throws {GatewayError} If the provider for the given model is not found
   */
  async health(modelId) {
    this.log.info("Gateway: health check requested", { model: modelId });
    const provider = this.router.resolve(modelId);
    try {
      return await provider.health();
    } catch (error) {
      this.log.error("Gateway: health check failed", {
        provider: provider.id,
        model: modelId,
        error: error instanceof Error ? error.name : "UnknownError"
      });
      throw new GatewayError(
        `Health check for model "${modelId}" failed`,
        modelId,
        error
      );
    }
  }
};

// src/core/config/config.ts
var ENV = {
  OLLAMA_BASE_URL: "OLLAMA_BASE_URL",
  OPENAI_API_KEY: "OPENAI_API_KEY",
  CLAUDE_API_KEY: "CLAUDE_API_KEY",
  GEMINI_API_KEY: "GEMINI_API_KEY",
  AI_TIMEOUT_MS: "AI_TIMEOUT_MS",
  AI_RETRY_COUNT: "AI_RETRY_COUNT"
};
function createConfig() {
  const ollamaBaseUrl = readOptional(
    ENV.OLLAMA_BASE_URL,
    "http://localhost:11434"
  );
  const timeoutMs = readOptionalNumber(
    ENV.AI_TIMEOUT_MS,
    3e4
  );
  const retryCount = readOptionalNumber(
    ENV.AI_RETRY_COUNT,
    2
  );
  const config = {
    ai: {
      timeoutMs,
      retryCount,
      ollama: {
        baseUrl: ollamaBaseUrl
      },
      openai: {
        apiKey: process.env[ENV.OPENAI_API_KEY] || void 0
      },
      claude: {
        apiKey: process.env[ENV.CLAUDE_API_KEY] || void 0
      },
      gemini: {
        apiKey: process.env[ENV.GEMINI_API_KEY] || void 0
      }
    }
  };
  return deepFreeze(config);
}
var ConfigValidationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigValidationError";
  }
};
function readOptional(name, fallback) {
  const value = process.env[name];
  if (value === void 0 || value === null || value.trim() === "") {
    return fallback;
  }
  return value.trim();
}
function readOptionalNumber(name, fallback) {
  const value = process.env[name];
  if (value === void 0 || value === null || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
function deepFreeze(obj) {
  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const value = obj[name];
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return Object.freeze(obj);
}

// src/core/logging/console-logger.ts
function timestamp() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
var ConsoleLogger = class {
  debug(message, metadata) {
    console.debug(this.format("DEBUG", message, metadata));
  }
  info(message, metadata) {
    console.info(this.format("INFO", message, metadata));
  }
  warn(message, metadata) {
    console.warn(this.format("WARN", message, metadata));
  }
  error(message, metadata) {
    console.error(this.format("ERROR", message, metadata));
  }
  /**
   * Format a log entry into a consistent string.
   */
  format(level, message, metadata) {
    const time = timestamp();
    const base = `[${level}] ${time} ${message}`;
    if (metadata === void 0 || Object.keys(metadata).length === 0) {
      return base;
    }
    return `${base} ${JSON.stringify(metadata)}`;
  }
};

// src/infrastructure/http/fetch-with-timeout.ts
var TimeoutError = class extends Error {
  constructor(timeoutMs) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
};
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
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

// src/infrastructure/http/fetch-with-retry.ts
var RETRYABLE_STATUS_CODES = /* @__PURE__ */ new Set([502, 503, 504]);
function isRetryable(error, status) {
  if (status !== void 0 && RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }
  if (error instanceof TimeoutError) {
    return true;
  }
  if (error instanceof TypeError) {
    return true;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  return false;
}
async function fetchWithRetry(url, options, timeoutMs, retryCount, log, metadata) {
  const maxAttempts = 1 + retryCount;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      if (response.ok) {
        return response;
      }
      if (isRetryable(void 0, response.status)) {
        lastError = response;
        if (attempt < maxAttempts) {
          log.warn("Retry attempt triggered", {
            provider: metadata.provider,
            model: metadata.model,
            attempt: `${attempt + 1}/${maxAttempts}`,
            reason: `HTTP ${response.status}`
          });
        }
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (isRetryable(error)) {
        if (attempt < maxAttempts) {
          log.warn("Retry attempt triggered", {
            provider: metadata.provider,
            model: metadata.model,
            attempt: `${attempt + 1}/${maxAttempts}`,
            reason: error instanceof Error ? error.name : "UnknownError"
          });
        }
        continue;
      }
      throw error;
    }
  }
  if (lastError instanceof Response) {
    return lastError;
  }
  throw lastError;
}

// src/infrastructure/ai/ollama/provider.ts
var OllamaAPIError = class extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = "OllamaAPIError";
  }
};
var OllamaConfigurationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "OllamaConfigurationError";
  }
};
function mapFinishReason(reason) {
  if (reason === "stop") return "stop";
  if (reason === "length") return "length";
  return void 0;
}
function toOllamaMessage(msg) {
  const text = [];
  const images = [];
  for (const part of msg.content) {
    switch (part.type) {
      case "text":
        text.push(part.text);
        break;
      case "image":
        if (part.source.type !== "base64") {
          throw new OllamaConfigurationError(
            "Ollama requires base64 image content; image URLs are not supported by this adapter"
          );
        }
        images.push(part.source.data);
        break;
      case "tool-call":
      case "tool-result":
        throw new OllamaConfigurationError(
          "Ollama tool-call content is not supported by this adapter yet"
        );
    }
  }
  return {
    role: msg.role,
    content: text.join(""),
    ...images.length > 0 ? { images } : {}
  };
}
function toTokenUsage(promptEvalCount, evalCount) {
  return {
    inputTokens: promptEvalCount,
    outputTokens: evalCount,
    totalTokens: (promptEvalCount ?? 0) + (evalCount ?? 0)
  };
}
var OllamaProvider = class {
  constructor(config, log) {
    this.id = "ollama";
    this.name = "Ollama";
    if (!config.baseUrl) {
      throw new OllamaConfigurationError(
        "OllamaProvider requires a baseUrl in its configuration"
      );
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs;
    this.retryCount = config.retryCount;
    this.log = log;
    this.models = this.buildModels();
  }
  buildModels() {
    return [
      {
        id: "qwen3:8b",
        name: "Qwen 3 8B",
        provider: this.id,
        capabilities: {
          streaming: true,
          functionCalling: false,
          vision: false,
          embeddings: true,
          maxOutputTokens: 8192,
          maxContextLength: 32768
        },
        costPer1KTokens: { input: 0, output: 0 },
        qualityScore: 0.6
      },
      {
        id: "qwen2.5-coder:7b",
        name: "Qwen 2.5 Coder 7B",
        provider: this.id,
        capabilities: {
          streaming: true,
          functionCalling: false,
          vision: false,
          embeddings: true,
          maxOutputTokens: 8192,
          maxContextLength: 32768
        },
        costPer1KTokens: { input: 0, output: 0 },
        qualityScore: 0.55
      }
    ];
  }
  // --------------------------------------------------------------------------
  // Chat (Non-Streaming)
  // --------------------------------------------------------------------------
  async chat(request) {
    if (!request.model) {
      throw new OllamaConfigurationError(
        "OllamaProvider.chat() requires a model in the request"
      );
    }
    this.log.info("Ollama: chat request started", {
      provider: this.id,
      model: request.model
    });
    const startTime = performance.now();
    const ollamaRequest = {
      model: request.model,
      messages: request.messages.map(toOllamaMessage),
      stream: false,
      options: {
        temperature: request.temperature,
        top_p: request.topP,
        stop: request.stop,
        num_predict: request.maxTokens
      }
    };
    this.cleanUndefinedOptions(ollamaRequest);
    try {
      const response = await fetchWithRetry(
        `${this.baseUrl}/api/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ollamaRequest)
        },
        this.timeoutMs,
        this.retryCount,
        this.log,
        { provider: this.id, model: request.model }
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new OllamaAPIError(
          `Ollama chat API returned status ${response.status}: ${body}`,
          response.status,
          body
        );
      }
      const data = await response.json();
      if (!this.isOllamaChatResponse(data)) {
        throw new OllamaAPIError(
          "Ollama chat API returned an invalid response format"
        );
      }
      const latencyMs = Math.round(performance.now() - startTime);
      this.log.info("Ollama: chat request finished", {
        provider: this.id,
        model: request.model,
        latencyMs
      });
      return {
        message: {
          role: "assistant",
          content: [{ type: "text", text: data.message.content }]
        },
        model: data.model,
        usage: toTokenUsage(data.prompt_eval_count, data.eval_count),
        finishReason: mapFinishReason(data.done_reason),
        provider: this.id,
        latencyMs
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);
      if (error instanceof OllamaAPIError) {
        this.log.error("Ollama: API error", {
          provider: this.id,
          model: request.model,
          status: error.status,
          latencyMs
        });
      } else {
        this.log.error("Ollama: network error or timeout", {
          provider: this.id,
          model: request.model,
          error: error instanceof Error ? error.name : "UnknownError",
          latencyMs
        });
      }
      throw error;
    }
  }
  // --------------------------------------------------------------------------
  // Stream
  // --------------------------------------------------------------------------
  async *stream(request) {
    if (!request.model) {
      throw new OllamaConfigurationError(
        "OllamaProvider.stream() requires a model in the request"
      );
    }
    this.log.info("Ollama: stream request started", {
      provider: this.id,
      model: request.model
    });
    const ollamaRequest = {
      model: request.model,
      messages: request.messages.map(toOllamaMessage),
      stream: true,
      options: {
        temperature: request.temperature,
        top_p: request.topP,
        stop: request.stop,
        num_predict: request.maxTokens
      }
    };
    this.cleanUndefinedOptions(ollamaRequest);
    try {
      const response = await fetchWithRetry(
        `${this.baseUrl}/api/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ollamaRequest)
        },
        this.timeoutMs,
        this.retryCount,
        this.log,
        { provider: this.id, model: request.model }
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new OllamaAPIError(
          `Ollama stream API returned status ${response.status}: ${body}`,
          response.status,
          body
        );
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new OllamaAPIError(
          "Ollama stream response body is not readable"
        );
      }
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const events = this.parseStreamEvents(trimmed);
            for (const event of events) {
              yield event;
              if (event.type === "finish") return;
            }
          }
        }
        if (buffer.trim()) {
          const events = this.parseStreamEvents(buffer.trim());
          for (const event of events) {
            yield event;
          }
        }
      } finally {
        reader.releaseLock();
      }
      this.log.info("Ollama: stream request finished", {
        provider: this.id,
        model: request.model
      });
    } catch (error) {
      this.log.error("Ollama: stream request failed", {
        provider: this.id,
        model: request.model,
        error: error instanceof Error ? error.name : "UnknownError"
      });
      yield {
        type: "error",
        model: request.model,
        provider: this.id,
        error: {
          message: error instanceof Error ? error.message : "Unknown Ollama stream error",
          code: error instanceof OllamaAPIError ? String(error.status ?? "api-error") : void 0
        }
      };
    }
  }
  parseStreamEvents(line) {
    try {
      const data = JSON.parse(line);
      if (!this.isOllamaStreamPayload(data)) return [];
      const events = [];
      const content = data.message?.content;
      if (content) {
        events.push({
          type: "text-delta",
          delta: content,
          model: data.model,
          provider: this.id
        });
      }
      if (data.done) {
        events.push({
          type: "usage",
          usage: toTokenUsage(data.prompt_eval_count, data.eval_count),
          model: data.model,
          provider: this.id
        });
        events.push({
          type: "finish",
          finishReason: mapFinishReason(data.done_reason) ?? "stop",
          model: data.model,
          provider: this.id
        });
      }
      return events;
    } catch {
      return [];
    }
  }
  // --------------------------------------------------------------------------
  // Embed
  // --------------------------------------------------------------------------
  async embed(request) {
    if (!request.model) {
      throw new OllamaConfigurationError(
        "OllamaProvider.embed() requires a model in the request"
      );
    }
    this.log.info("Ollama: embed request started", {
      provider: this.id,
      model: request.model
    });
    const startTime = performance.now();
    const ollamaRequest = {
      model: request.model,
      input: request.input
    };
    try {
      const response = await fetchWithRetry(
        `${this.baseUrl}/api/embed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ollamaRequest)
        },
        this.timeoutMs,
        this.retryCount,
        this.log,
        { provider: this.id, model: request.model }
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new OllamaAPIError(
          `Ollama embed API returned status ${response.status}: ${body}`,
          response.status,
          body
        );
      }
      const data = await response.json();
      if (!this.isOllamaEmbedResponse(data)) {
        throw new OllamaAPIError(
          "Ollama embed API returned an invalid response format"
        );
      }
      const latencyMs = Math.round(performance.now() - startTime);
      this.log.info("Ollama: embed request finished", {
        provider: this.id,
        model: request.model,
        latencyMs
      });
      return {
        embeddings: data.embeddings,
        model: data.model,
        usage: toTokenUsage(data.prompt_eval_count),
        provider: this.id,
        latencyMs
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);
      this.log.error("Ollama: embed request failed", {
        provider: this.id,
        model: request.model,
        error: error instanceof Error ? error.name : "UnknownError",
        latencyMs
      });
      throw error;
    }
  }
  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------
  async health() {
    this.log.info("Ollama: health check started", { provider: this.id });
    const startTime = performance.now();
    try {
      const response = await fetchWithRetry(
        `${this.baseUrl}/api/tags`,
        { method: "GET" },
        this.timeoutMs,
        this.retryCount,
        this.log,
        { provider: this.id }
      );
      const latencyMs = Math.round(performance.now() - startTime);
      if (!response.ok) {
        this.log.warn("Ollama: health check unhealthy", {
          provider: this.id,
          status: response.status,
          latencyMs
        });
        return {
          healthy: false,
          provider: this.id,
          lastChecked: Date.now(),
          error: `Ollama health check failed with status ${response.status}`,
          latencyMs
        };
      }
      this.log.info("Ollama: health check healthy", {
        provider: this.id,
        latencyMs
      });
      return {
        healthy: true,
        provider: this.id,
        lastChecked: Date.now(),
        latencyMs
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);
      this.log.warn("Ollama: health check error", {
        provider: this.id,
        error: error instanceof Error ? error.name : "UnknownError",
        latencyMs
      });
      return {
        healthy: false,
        provider: this.id,
        lastChecked: Date.now(),
        error: error instanceof Error ? error.message : "Unknown error during health check",
        latencyMs
      };
    }
  }
  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------
  cleanUndefinedOptions(request) {
    if (request.options) {
      const opts = request.options;
      for (const key of Object.keys(opts)) {
        if (opts[key] === void 0) delete opts[key];
      }
      if (Object.keys(opts).length === 0) delete request.options;
    }
  }
  isOllamaChatResponse(data) {
    if (typeof data !== "object" || data === null) return false;
    const d = data;
    return typeof d.model === "string" && typeof d.message === "object" && d.message !== null && typeof d.message.content === "string";
  }
  isOllamaStreamPayload(data) {
    if (typeof data !== "object" || data === null) return false;
    const d = data;
    return typeof d.model === "string" && typeof d.done === "boolean";
  }
  isOllamaEmbedResponse(data) {
    if (typeof data !== "object" || data === null) return false;
    const d = data;
    return typeof d.model === "string" && Array.isArray(d.embeddings) && d.embeddings.every(
      (e) => Array.isArray(e) && e.every((n) => typeof n === "number")
    );
  }
};

// src/infrastructure/ai/openai/provider.ts
var OpenAIAPIError = class extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = "OpenAIAPIError";
  }
};
var OpenAIConfigurationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "OpenAIConfigurationError";
  }
};
function mapFinishReason2(reason) {
  if (reason === "stop") return "stop";
  if (reason === "length") return "length";
  if (reason === "tool_calls") return "tool-calls";
  if (reason === "content_filter") return "content-filter";
  return "stop";
}
function toOpenAIContentPart(part) {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "image":
      return {
        type: "image_url",
        image_url: {
          url: part.source.type === "url" ? part.source.url : `data:${part.source.mediaType};base64,${part.source.data}`
        }
      };
    case "tool-call":
    case "tool-result":
      throw new OpenAIConfigurationError(
        "OpenAI tool-call content is not supported by this adapter yet"
      );
  }
}
function toOpenAIMessage(msg) {
  return {
    role: msg.role,
    content: msg.content.map(toOpenAIContentPart),
    name: msg.name
  };
}
function toTokenUsage2(usage) {
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens
  };
}
var OpenAIProvider = class {
  constructor(config, log) {
    this.id = "openai";
    this.name = "OpenAI";
    if (!config.apiKey) {
      throw new OpenAIConfigurationError(
        "OpenAIProvider requires an apiKey in its configuration"
      );
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(
      /\/+$/,
      ""
    );
    this.timeoutMs = config.timeoutMs;
    this.retryCount = config.retryCount;
    this.log = log;
    this.models = this.buildModels();
  }
  buildModels() {
    return [
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        provider: this.id,
        capabilities: {
          streaming: true,
          functionCalling: true,
          vision: true,
          embeddings: false,
          maxOutputTokens: 32768,
          maxContextLength: 2e5
        },
        costPer1KTokens: { input: 2, output: 8 },
        qualityScore: 0.97
      },
      {
        id: "gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        provider: this.id,
        capabilities: {
          streaming: true,
          functionCalling: true,
          vision: true,
          embeddings: false,
          maxOutputTokens: 16384,
          maxContextLength: 2e5
        },
        costPer1KTokens: { input: 0.4, output: 1.6 },
        qualityScore: 0.92
      },
      {
        id: "gpt-4o",
        name: "GPT-4o",
        provider: this.id,
        capabilities: {
          streaming: true,
          functionCalling: true,
          vision: true,
          embeddings: false,
          maxOutputTokens: 16384,
          maxContextLength: 128e3
        },
        costPer1KTokens: { input: 2.5, output: 10 },
        qualityScore: 0.95
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        provider: this.id,
        capabilities: {
          streaming: true,
          functionCalling: true,
          vision: true,
          embeddings: false,
          maxOutputTokens: 16384,
          maxContextLength: 128e3
        },
        costPer1KTokens: { input: 0.15, output: 0.6 },
        qualityScore: 0.85
      },
      {
        id: "text-embedding-3-small",
        name: "Text Embedding 3 Small",
        provider: this.id,
        capabilities: {
          streaming: false,
          functionCalling: false,
          vision: false,
          embeddings: true,
          maxOutputTokens: 1,
          maxContextLength: 8191
        },
        costPer1KTokens: { input: 0.02, output: 0 },
        qualityScore: 0.8
      },
      {
        id: "text-embedding-3-large",
        name: "Text Embedding 3 Large",
        provider: this.id,
        capabilities: {
          streaming: false,
          functionCalling: false,
          vision: false,
          embeddings: true,
          maxOutputTokens: 1,
          maxContextLength: 8191
        },
        costPer1KTokens: { input: 0.13, output: 0 },
        qualityScore: 0.9
      }
    ];
  }
  // --------------------------------------------------------------------------
  // Chat (Non-Streaming)
  // --------------------------------------------------------------------------
  async chat(request) {
    if (!request.model) {
      throw new OpenAIConfigurationError(
        "OpenAIProvider.chat() requires a model in the request"
      );
    }
    this.log.info("OpenAI: chat request started", {
      provider: this.id,
      model: request.model
    });
    const startTime = performance.now();
    const openaiRequest = {
      model: request.model,
      messages: request.messages.map(toOpenAIMessage),
      stream: false,
      temperature: request.temperature,
      top_p: request.topP,
      stop: request.stop,
      max_tokens: request.maxTokens
    };
    try {
      const data = await this.fetchOpenAI(
        "/chat/completions",
        openaiRequest,
        request.model
      );
      const latencyMs = Math.round(performance.now() - startTime);
      const choice = data.choices[0];
      this.log.info("OpenAI: chat request finished", {
        provider: this.id,
        model: request.model,
        latencyMs
      });
      return {
        message: {
          role: "assistant",
          content: [{ type: "text", text: choice.message.content }]
        },
        model: data.model,
        usage: toTokenUsage2(data.usage),
        finishReason: mapFinishReason2(choice.finish_reason),
        provider: this.id,
        latencyMs
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);
      this.log.error("OpenAI: chat request failed", {
        provider: this.id,
        model: request.model,
        error: error instanceof Error ? error.name : "UnknownError",
        latencyMs
      });
      throw error;
    }
  }
  // --------------------------------------------------------------------------
  // Stream
  // --------------------------------------------------------------------------
  async *stream(request) {
    if (!request.model) {
      throw new OpenAIConfigurationError(
        "OpenAIProvider.stream() requires a model in the request"
      );
    }
    this.log.info("OpenAI: stream request started", {
      provider: this.id,
      model: request.model
    });
    const openaiRequest = {
      model: request.model,
      messages: request.messages.map(toOpenAIMessage),
      stream: true,
      temperature: request.temperature,
      top_p: request.topP,
      stop: request.stop,
      max_tokens: request.maxTokens
    };
    try {
      const response = await fetchWithRetry(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify(openaiRequest)
        },
        this.timeoutMs,
        this.retryCount,
        this.log,
        { provider: this.id, model: request.model }
      );
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new OpenAIAPIError(
          `OpenAI stream API returned status ${response.status}: ${text}`,
          response.status,
          text
        );
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new OpenAIAPIError(
          "OpenAI stream response body is not readable"
        );
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.trim();
            if (!line || !line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") {
              if (!finished) {
                yield {
                  type: "finish",
                  model: request.model,
                  provider: this.id,
                  finishReason: "stop"
                };
              }
              return;
            }
            const events = this.parseStreamEvents(payload);
            for (const event of events) {
              yield event;
              if (event.type === "finish") {
                finished = true;
                return;
              }
            }
          }
        }
        if (buffer.trim()) {
          const line = buffer.trim();
          if (line.startsWith("data: ")) {
            const payload = line.slice(6);
            if (payload !== "[DONE]") {
              const events = this.parseStreamEvents(payload);
              for (const event of events) {
                yield event;
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      this.log.info("OpenAI: stream request finished", {
        provider: this.id,
        model: request.model
      });
    } catch (error) {
      this.log.error("OpenAI: stream request failed", {
        provider: this.id,
        model: request.model,
        error: error instanceof Error ? error.name : "UnknownError"
      });
      yield {
        type: "error",
        model: request.model,
        provider: this.id,
        error: {
          message: error instanceof Error ? error.message : "Unknown OpenAI stream error",
          code: error instanceof OpenAIAPIError ? String(error.status ?? "api-error") : void 0
        }
      };
    }
  }
  parseStreamEvents(payload) {
    try {
      const data = JSON.parse(payload);
      if (!this.isOpenAIStreamPayload(data)) return [];
      const choice = data.choices[0];
      const events = [];
      if (choice?.delta?.content) {
        events.push({
          type: "text-delta",
          delta: choice.delta.content,
          model: data.model,
          provider: this.id
        });
      }
      if (data.usage) {
        events.push({
          type: "usage",
          usage: toTokenUsage2(data.usage),
          model: data.model,
          provider: this.id
        });
      }
      if (choice?.finish_reason) {
        events.push({
          type: "finish",
          finishReason: mapFinishReason2(choice.finish_reason),
          model: data.model,
          provider: this.id
        });
      }
      return events;
    } catch {
      return [];
    }
  }
  // --------------------------------------------------------------------------
  // Embed
  // --------------------------------------------------------------------------
  async embed(request) {
    if (!request.model) {
      throw new OpenAIConfigurationError(
        "OpenAIProvider.embed() requires a model in the request"
      );
    }
    this.log.info("OpenAI: embed request started", {
      provider: this.id,
      model: request.model
    });
    const startTime = performance.now();
    const openaiRequest = {
      input: request.input,
      model: request.model
    };
    try {
      const data = await this.fetchOpenAI(
        "/embeddings",
        openaiRequest,
        request.model
      );
      const latencyMs = Math.round(performance.now() - startTime);
      const sorted = [...data.data].sort((a, b) => a.index - b.index);
      this.log.info("OpenAI: embed request finished", {
        provider: this.id,
        model: request.model,
        latencyMs
      });
      return {
        embeddings: sorted.map((e) => e.embedding),
        model: data.model,
        usage: {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: 0,
          totalTokens: data.usage.total_tokens
        },
        provider: this.id,
        latencyMs
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);
      this.log.error("OpenAI: embed request failed", {
        provider: this.id,
        model: request.model,
        error: error instanceof Error ? error.name : "UnknownError",
        latencyMs
      });
      throw error;
    }
  }
  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------
  async health() {
    this.log.info("OpenAI: health check started", { provider: this.id });
    const startTime = performance.now();
    try {
      const response = await fetchWithRetry(
        `${this.baseUrl}/models`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`
          }
        },
        this.timeoutMs,
        this.retryCount,
        this.log,
        { provider: this.id }
      );
      const latencyMs = Math.round(performance.now() - startTime);
      if (!response.ok) {
        this.log.warn("OpenAI: health check unhealthy", {
          provider: this.id,
          status: response.status,
          latencyMs
        });
        return {
          healthy: false,
          provider: this.id,
          lastChecked: Date.now(),
          error: `OpenAI health check failed with status ${response.status}`,
          latencyMs
        };
      }
      this.log.info("OpenAI: health check healthy", {
        provider: this.id,
        latencyMs
      });
      return {
        healthy: true,
        provider: this.id,
        lastChecked: Date.now(),
        latencyMs
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startTime);
      this.log.warn("OpenAI: health check error", {
        provider: this.id,
        error: error instanceof Error ? error.name : "UnknownError",
        latencyMs
      });
      return {
        healthy: false,
        provider: this.id,
        lastChecked: Date.now(),
        error: error instanceof Error ? error.message : "Unknown error during health check",
        latencyMs
      };
    }
  }
  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------
  async fetchOpenAI(path, body, model) {
    const response = await fetchWithRetry(
      `${this.baseUrl}${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body)
      },
      this.timeoutMs,
      this.retryCount,
      this.log,
      { provider: this.id, model }
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new OpenAIAPIError(
        `OpenAI API returned status ${response.status}: ${text}`,
        response.status,
        text
      );
    }
    return response.json();
  }
  // --------------------------------------------------------------------------
  // Type Guards
  // --------------------------------------------------------------------------
  isOpenAIStreamPayload(data) {
    if (typeof data !== "object" || data === null) return false;
    const d = data;
    return typeof d.model === "string" && Array.isArray(d.choices);
  }
};

// src/core/bootstrap.ts
function createGateway(config) {
  const log = new ConsoleLogger();
  const registry = new AIRegistry();
  const models = new ModelRegistry();
  if (config.ai.ollama.baseUrl) {
    const ollama = new OllamaProvider(
      {
        ...config.ai.ollama,
        timeoutMs: config.ai.timeoutMs,
        retryCount: config.ai.retryCount
      },
      log
    );
    registry.register(ollama);
  }
  if (config.ai.openai.apiKey) {
    const openai = new OpenAIProvider(
      {
        ...config.ai.openai,
        timeoutMs: config.ai.timeoutMs,
        retryCount: config.ai.retryCount
      },
      log
    );
    registry.register(openai);
  }
  models.register("qwen3:8b", "ollama");
  models.register("qwen2.5-coder:7b", "ollama");
  models.register("gpt-4.1", "openai");
  models.register("gpt-4.1-mini", "openai");
  models.register("gpt-4o", "openai");
  models.register("gpt-4o-mini", "openai");
  const router = new ProviderRouter(models, registry);
  return new AIGateway(config, router, log);
}
export {
  AIGateway,
  AIRegistry,
  ConfigValidationError,
  ConsoleLogger,
  GatewayError,
  ModelAlreadyRegisteredError,
  ModelNotFoundError,
  ModelRegistry,
  OllamaProvider,
  OpenAIProvider,
  ProviderAlreadyRegisteredError,
  ProviderNotFoundError,
  ProviderRouter,
  ProviderUnavailableError,
  TimeoutError,
  UnknownModelError,
  createConfig,
  createGateway,
  fetchWithRetry,
  fetchWithTimeout
};
//# sourceMappingURL=index.js.map