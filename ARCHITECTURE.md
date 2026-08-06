# Stelaris AI Core — Architecture

## Vision

Stelaris AI Core is a provider-agnostic AI orchestration platform. It enables applications to interact with any AI provider (Ollama, OpenAI, Claude, Gemini, and others) through a single, consistent interface without coupling business logic to provider-specific implementations.

The platform is built incrementally — each phase adds production capabilities (routing, retries, caching, observability) without breaking the foundational contracts.

---

## Architecture Principles

### Clean Architecture

The codebase is organized into concentric layers. Dependencies flow **inward** — inner layers have no knowledge of outer layers.

```
┌───────────────────────────────────────┐
│         Frameworks & Drivers          │
│  (Next.js playground, HTTP, fetch)    │
│  ┌─────────────────────────────────┐  │
│  │     Interface Adapters          │  │
│  │  (Providers, HTTP helpers)      │  │
│  │  ┌───────────────────────────┐  │  │
│  │  │    Application Core       │  │  │
│  │  │  (Gateway, Router,        │  │  │
│  │  │   Registry, Bootstrap)    │  │  │
│  │  │  ┌─────────────────────┐  │  │  │
│  │  │  │   Domain Layer      │  │  │  │
│  │  │  │  (Contracts, Types) │  │  │  │
│  │  │  └─────────────────────┘  │  │  │
│  │  └───────────────────────────┘  │  │
│  └─────────────────────────────────┘  │
└───────────────────────────────────────┘
```

### Hexagonal Architecture (Ports & Adapters)

- **Ports** — The `AIProvider` interface in `src/core/ai/types.ts`. This is the contract that all providers (Ollama, OpenAI, future Claude/Gemini) must implement.
- **Adapters** — Each provider adapter (e.g., `OllamaProvider`, `OpenAIProvider`) implements the port. Adapters translate between the generic core types and provider-specific HTTP payloads.
- The core never depends on adapters. Adapters depend on the core.

### Dependency Inversion

High-level modules (Gateway, application logic) do not depend on low-level modules (HTTP calls, provider SDKs). Both depend on abstractions (`AIProvider` interface).

The `AIGateway` receives a `ProviderRouter` that resolves models to `AIProvider` instances. It never imports `OllamaProvider`, `OpenAIProvider`, or any concrete class.

### Composition Root

All dependencies are created and wired by the `createGateway()` factory in exactly one file: `src/core/bootstrap.ts`.

- No singleton class
- No dependency injection framework
- No service locator
- No global mutable state

### Provider Abstraction

Every provider adapter implements the same `AIProvider` interface:

```typescript
interface AIProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly models: ModelDescriptor[];
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<StreamEvent>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  health(): Promise<HealthStatus>;
}
```

The Gateway never references a concrete provider class. Providers are registered in an `AIRegistry` and mapped to models in a `ModelRegistry`; the `ProviderRouter` resolves a model ID to the responsible provider instance.

---

## Folder Structure

```
stelaris-ai-core/
├── src/
│   ├── index.ts                        ← Public API surface (single entry point)
│   ├── core/                           ← Application Core (zero framework dependencies)
│   │   ├── ai/
│   │   │   ├── types.ts                ← AIProvider interface, Message, ContentPart,
│   │   │   │                              ChatRequest, ChatResponse, StreamEvent,
│   │   │   │                              EmbeddingRequest, EmbeddingResponse, HealthStatus,
│   │   │   │                              TokenUsage, ModelDescriptor, ModelCapabilities, etc.
│   │   │   │                              Zero dependencies. Provider-agnostic. No defaults.
│   │   │   ├── registry.ts             ← AIRegistry — lightweight provider catalog
│   │   │   ├── model-registry.ts       ← ModelRegistry — model → provider mappings
│   │   │   ├── provider-router.ts      ← ProviderRouter — resolves model IDs to providers
│   │   │   └── gateway.ts              ← AIGateway — orchestration layer, provider-agnostic
│   │   ├── config/
│   │   │   └── config.ts               ← AppConfig, createConfig(). Only file that reads process.env.
│   │   ├── logging/
│   │   │   ├── logger.ts               ← Logger interface, LogMetadata
│   │   │   └── console-logger.ts       ← ConsoleLogger implementation
│   │   └── bootstrap.ts                ← Composition Root. createGateway() wires all dependencies.
│   │
│   ├── infrastructure/                 ← Adapters (provider implementations, HTTP helpers)
│   │   ├── ai/
│   │   │   ├── ollama/
│   │   │   │   └── provider.ts         ← Ollama HTTP API adapter. Implements AIProvider.
│   │   │   └── openai/
│   │   │       └── provider.ts         ← OpenAI HTTP API adapter. Implements AIProvider.
│   │   └── http/
│   │       ├── fetch-with-timeout.ts   ← fetch wrapper with timeout
│   │       └── fetch-with-retry.ts     ← fetch wrapper with retry
│   │
│   └── ...
│
├── playground/                         ← Standalone Next.js demo app (separate package)
│   ├── app/
│   │   ├── api/chat/route.ts           ← HTTP route. Consumes @stelaris/ai-core.
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── package.json
│   └── tsconfig.json
│
├── tests/
│   ├── unit/                           ← Unit tests (registry, model-registry, provider-router, gateway, http)
│   └── integration/                    ← Integration tests (ollama, openai providers)
│
├── ARCHITECTURE.md                     ← This file
├── tsconfig.json
├── tsup.config.ts                      ← Library build config
├── vitest.config.ts                    ← Test runner config
└── package.json
```

---

## Dependency Rules

### Core (`src/core/`) must never import:

- **Next.js / React** — no `next/` imports, no JSX, no hooks
- **`fetch`** — the core orchestrates but does not perform HTTP calls
- **`process.env`** — only `src/core/config/config.ts` reads environment variables
- **Concrete provider classes** — the core depends on the `AIProvider` interface, not `OllamaProvider`/`OpenAIProvider`
- **External HTTP libraries**

### Configuration (`src/core/config/config.ts`):

- Is the **only** file that reads `process.env`
- Returns a deeply frozen `AppConfig` object
- Validates required values at creation time, throws `ConfigValidationError` if missing
- Never invents defaults — configuration is explicit

### Composition Root (`src/core/bootstrap.ts`):

- `createGateway()` is the **only** place where providers are instantiated and registered
- Is the **only** place where model→provider mappings are registered
- Creates dependencies in a strict order: Config → Logger → Registries → Providers → Model mappings → Router → Gateway
- Only registers providers that are actually configured (e.g., Ollama needs a `baseUrl`, OpenAI needs an `apiKey`)

### Gateway:

- Must remain **provider-agnostic**
- Must never import or reference `OllamaProvider`, `OpenAIProvider`, etc.
- Must never read `process.env`
- Must never perform `fetch` calls
- Receives all dependencies through its constructor (`AppConfig`, `ProviderRouter`, `Logger`)
- Determines the provider automatically from the `model` field of each request via `ProviderRouter`

### Providers:

- Must implement the `AIProvider` interface from `src/core/ai/types.ts`
- Must keep provider-specific logic (HTTP calls, payload formats) entirely inside the adapter
- Must not be instantiated anywhere except `src/core/bootstrap.ts`
- Must not be registered anywhere except `src/core/bootstrap.ts`

### API Routes (in `playground/app/`):

- The playground consumes the published library (`@stelaris/ai-core`) — it does not import internal source paths
- Must only handle **HTTP, validation, and serialization**
- Must not instantiate providers, registry, or gateway
- Must not read `process.env`
- Must not make direct `fetch` calls to AI servers
- Must not contain provider-specific logic

---

## Request Flow

```
HTTP POST /api/chat { prompt: "Hello", model: "qwen3:8b" }
│
▼
playground/app/api/chat/route.ts               ← Route (Next.js)
│  - Validates HTTP payload
│  - Converts to ChatRequest { model, messages }
│  - Calls gateway.chat(request)  — no provider ID is passed
│
▼
src/core/ai/gateway.ts                         ← Gateway
│  - Resolves the provider from request.model via ProviderRouter
│  - Delegates to provider.chat(request)
│  - Wraps errors in GatewayError
│
▼
src/core/ai/provider-router.ts                 ← Router
│  - Looks up model → provider mapping in ModelRegistry
│  - Returns the registered provider instance from AIRegistry
│
▼
src/infrastructure/ai/ollama/provider.ts       ← Provider Adapter
│  - Transforms ChatRequest → provider-specific HTTP payload
│  - Calls the provider API via fetch (with timeout/retry helpers)
│  - Validates response shape
│  - Transforms provider response → ChatResponse
│
▼
Provider Server (Ollama, OpenAI, etc.)         ← External System
│  - Processes the request
│  - Returns completion / embeddings / health
│
▼
(Response flows back up the chain)
HTTP 200 { message, model, usage, finishReason, provider, latencyMs }
```

Streaming follows the same path via `gateway.stream(request)`, yielding discriminated `StreamEvent` values (`text-delta`, `tool-call-delta`, `usage`, `finish`, `error`).

---

## Adding a New Provider

Adding a provider (e.g., Claude, Gemini) requires changes to **exactly** the files listed below. No existing core files are modified.

### Step 1: Add configuration type

In `src/core/config/config.ts`:

```typescript
export interface ClaudeConfig {
  readonly apiKey?: string;
}
```

Add the new config section to `AIConfig` and read the env var in `createConfig()`:

```typescript
claude: {
  apiKey: process.env[ENV.CLAUDE_API_KEY] || undefined,
},
```

### Step 2: Create the provider adapter

Create `src/infrastructure/ai/claude/provider.ts`:

- Implement the `AIProvider` interface
- Accept the config and a `Logger` in the constructor
- Use the HTTP helpers (`fetchWithTimeout`, `fetchWithRetry`) to call the provider API
- Translate between `ChatRequest`/`ChatResponse`/`StreamEvent` and the provider's payload format
- Keep all provider-specific logic inside this file

### Step 3: Wire in the Composition Root

In `src/core/bootstrap.ts`, add:

```typescript
import { ClaudeProvider } from "@/infrastructure/ai/claude/provider";

if (config.ai.claude.apiKey) {
  const claude = new ClaudeProvider(
    {
      ...config.ai.claude,
      timeoutMs: config.ai.timeoutMs,
      retryCount: config.ai.retryCount,
    },
    log,
  );
  registry.register(claude);
}
```

Then register the model mappings:

```typescript
models.register("claude-sonnet-4" as ModelId, "claude" as ProviderId);
```

### Step 4: Use the provider

The Gateway routes automatically — consumers just specify a model:

```typescript
const response = await gateway.chat({
  model: "claude-sonnet-4",
  messages: [
    { role: "user", content: [{ type: "text", text: "Hello" }] },
  ],
});
```

### Files that do NOT change:

- `src/core/ai/types.ts` — contracts are already provider-agnostic
- `src/core/ai/gateway.ts` — Gateway works with any registered provider automatically
- `src/core/ai/registry.ts` — Registry is generic, no provider-specific changes
- `src/core/ai/model-registry.ts` — mappings are registered in bootstrap only
- `src/core/ai/provider-router.ts` — Router is generic, no provider-specific changes

---

## Coding Guidelines

### General

- **No hardcoded defaults** for configuration values. Throw meaningful errors instead.
- **No fabricated values** in translation layers. If the source doesn't provide a value, preserve the absence.
- **No silent fallbacks** in business logic. Fail explicitly.
- **Factory/function exports** over singletons. `bootstrap.ts` exports `createGateway()`, not a class with static instances.
- **Branded string types** (`ProviderId`, `ModelId`) over enums for extensibility.

### File Organization

- One major concept per file.
- Provider adapters go in `src/infrastructure/ai/{provider-name}/`.
- Group provider files by provider, not by type (e.g., not `src/infrastructure/ai/providers/ollama.ts`).

### Imports

- Core modules use the `@/` path alias (`@/core/ai/types`, `@/core/config/config`).
- Infrastructure modules use the `@/` path alias (`@/infrastructure/ai/ollama/provider`).
- The playground imports only from the published package (`@stelaris/ai-core`).
- The `@services/` alias has been removed — do not reintroduce it.

### Error Handling

- Provider adapters throw provider-specific errors (e.g., `OllamaAPIError`, `OpenAIAPIError`).
- The Gateway wraps all provider errors in `GatewayError` with the model and original `cause`.
- The ProviderRouter throws `UnknownModelError` / `ProviderUnavailableError` for resolution failures.
- Configuration errors throw `ConfigValidationError` with descriptive messages.

### Immutability

- `AppConfig` is deeply frozen after creation.
- Registry state is encapsulated in a `Map` — only exposed through controlled accessors (`get`, `list`, `has`).
- `ChatRequest`, `ChatResponse`, and all contracts are plain objects — treat them as immutable.

### Testing

- Gateway accepts `ProviderRouter` via constructor — inject a router with fake providers.
- Provider adapters accept config via constructor — inject test config pointing to a mock server.
- Tests live in `tests/unit/` and `tests/integration/`. Integration tests require a live provider or mock server.

---

## Build, Test, and Packaging

- **Build**: `npm run build` runs `tsup`, emitting an ESM bundle + type declarations to `dist/`.
- **Test**: `npm test` runs `vitest run` over `tests/**/*.test.ts`.
- **Package**: `npm pack` runs `prepack` (build) and produces a `.tgz`. `dist/` and `*.tgz` are gitignored; build artifacts are never committed.
- **Playground**: the Next.js app in `playground/` is a separate package that consumes the built/published `@stelaris/ai-core`.