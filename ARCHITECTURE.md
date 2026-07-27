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
│  (Next.js, HTTP, fetch, process.env)  │
│  ┌─────────────────────────────────┐  │
│  │     Interface Adapters          │  │
│  │  (Routes, serialization, I/O)   │  │
│  │  ┌───────────────────────────┐  │  │
│  │  │    Application Core       │  │  │
│  │  │  (Gateway, Registry)      │  │  │
│  │  │  ┌─────────────────────┐  │  │  │
│  │  │  │   Domain Layer      │  │  │  │
│  │  │  │  (Contracts, Types) │  │  │  │
│  │  │  └─────────────────────┘  │  │  │
│  │  └───────────────────────────┘  │  │
│  └─────────────────────────────────┘  │
└───────────────────────────────────────┘
```

### Hexagonal Architecture (Ports & Adapters)

- **Ports** — The `AIProvider` interface in `src/core/ai/types.ts`. This is the contract that all providers must implement.
- **Adapters** — Each provider adapter (e.g., `OllamaProvider`) implements the port. Adapters translate between the generic core types and provider-specific HTTP payloads.
- The core never depends on adapters. Adapters depend on the core.

### Dependency Inversion

High-level modules (Gateway, application logic) do not depend on low-level modules (HTTP calls, provider SDKs). Both depend on abstractions (`AIProvider` interface).

The `AIGateway` receives an `AIRegistry` that contains `AIProvider` instances. It never imports `OllamaProvider`, `OpenAIProvider`, or any concrete class.

### Composition Root

All dependencies are created and wired in exactly one file: `src/core/bootstrap.ts`.

- No singleton class
- No dependency injection framework
- No service locator
- No global mutable state

### Provider Abstraction

Every provider adapter implements the same `AIProvider` interface:

```typescript
interface AIProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<StreamChunk>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  health(): Promise<HealthStatus>;
}
```

The Gateway never references a concrete provider class. It looks up providers by ID from the registry and delegates to the interface.

---

## Folder Structure

```
stelaris-ai-core/
├── src/
│   ├── core/                           ← Application Core (zero framework dependencies)
│   │   ├── ai/
│   │   │   ├── types.ts                ← AIProvider interface, ChatMessage, ChatRequest,
│   │   │   │                              ChatResponse, StreamChunk, EmbeddingRequest,
│   │   │   │                              EmbeddingResponse, HealthStatus, TokenUsage, etc.
│   │   │   │                              Zero dependencies. Provider-agnostic. No defaults.
│   │   │   ├── registry.ts             ← AIRegistry — lightweight provider catalog
│   │   │   └── gateway.ts              ← AIGateway — orchestration layer, provider-agnostic
│   │   ├── config/
│   │   │   └── config.ts               ← AppConfig, createConfig(). Only file that reads process.env.
│   │   └── bootstrap.ts                ← Composition Root. Creates and wires all dependencies.
│   │
│   ├── infrastructure/                 ← Adapters (provider implementations)
│   │   └── ai/
│   │       └── ollama/
│   │           └── provider.ts         ← Ollama HTTP API adapter. Implements AIProvider.
│   │
│   ├── app/                            ← Next.js App Router (framework layer)
│   │   ├── api/chat/route.ts           ← HTTP route. Only handles HTTP, validation, serialization.
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   │
│   ├── config/                         ← Reserved for future configuration files
│   ├── agents/                         ← Reserved for future AI agent implementations
│   ├── components/                     ← React components (UI layer)
│   ├── lib/                            ← Shared utility functions
│   ├── prompts/                        ← Prompt templates
│   ├── types/                          ← Shared TypeScript types (non-AI)
│   └── utils/                          ← Utility helpers
│
├── public/                             ← Static assets
├── ARCHITECTURE.md                     ← This file
├── tsconfig.json
└── package.json
```

---

## Dependency Rules

### Core (`src/core/`) must never import:

- **Next.js** — no `next/` imports, no `@/app/`, no framework types
- **React** — no `react` imports, no JSX, no hooks
- **`fetch`** — the core orchestrates but does not perform HTTP calls
- **`process.env`** — only `src/core/config/config.ts` reads environment variables
- **Concrete provider classes** — the core depends on the `AIProvider` interface, not `OllamaProvider`
- **External HTTP libraries**

### Configuration (`src/core/config/config.ts`):

- Is the **only** file that reads `process.env`
- Returns a deeply frozen `AppConfig` object
- Validates required values at creation time, throws `ConfigValidationError` if missing
- Never invents defaults — configuration is explicit

### Composition Root (`src/core/bootstrap.ts`):

- Is the **only** file where providers are instantiated
- Is the **only** file where providers are registered in the registry
- Creates dependencies in a strict order: Config → Registry → Providers → Gateway
- Exports the wired dependencies as plain module-scoped variables

### Gateway:

- Must remain **provider-agnostic**
- Must never import or reference `OllamaProvider`, `OpenAIProvider`, etc.
- Must never read `process.env`
- Must never perform `fetch` calls
- Receives all dependencies through its constructor (`AppConfig`, `AIRegistry`)

### Providers:

- Must implement the `AIProvider` interface from `src/core/ai/types.ts`
- Must keep provider-specific logic (HTTP calls, payload formats) entirely inside the adapter
- Must not be instantiated anywhere except `src/core/bootstrap.ts`
- Must not be registered anywhere except `src/core/bootstrap.ts`

### API Routes:

- Must only handle **HTTP, validation, and serialization**
- Must not instantiate providers, registry, or gateway
- Must not read `process.env`
- Must not make direct `fetch` calls to AI servers
- Must not contain provider-specific logic
- Must import pre-wired dependencies from `@/core/bootstrap`

---

## Request Flow

```
HTTP POST /api/chat { prompt: "Hello", model: "qwen3:8b" }
│
▼
src/app/api/chat/route.ts                    ← Route
│  - Validates HTTP payload
│  - Converts to ChatRequest
│  - Calls gateway.chat("ollama", request)
│
▼
src/core/ai/gateway.ts                       ← Gateway
│  - Looks up "ollama" in the registry
│  - Delegates to provider.chat(request)
│  - Wraps errors in GatewayError
│
▼
src/core/ai/registry.ts                      ← Registry
│  - Returns the registered OllamaProvider instance
│
▼
src/infrastructure/ai/ollama/provider.ts     ← Provider Adapter
│  - Transforms ChatRequest → Ollama HTTP payload
│  - Calls POST /api/chat via native fetch
│  - Validates response shape
│  - Transforms Ollama response → ChatResponse
│
▼
Ollama Server (or any AI server)             ← External System
│  - Processes the request
│  - Returns completion / embeddings / health
│
▼
(Response flows back up the chain)
HTTP 200 { reply: "Hello! How can I help?" }
```

---

## Adding a New Provider

Adding a provider (e.g., OpenAI, Claude, Gemini) requires changes to **exactly** the files listed below. No core files are modified.

### Step 1: Add configuration type

In `src/core/config/config.ts`:

```typescript
export interface OpenAIConfig {
  readonly apiKey?: string;
}
```

Add the new config section to `AIConfig`:

```typescript
export interface AIConfig {
  readonly ollama: OllamaConfig;
  readonly openai: OpenAIConfig;     // ← Add this
  readonly claude: ClaudeConfig;
  readonly gemini: GeminiConfig;
}
```

Add the env var reader in `createConfig()`:

```typescript
openai: {
  apiKey: process.env[ENV.OPENAI_API_KEY] || undefined,
},
```

### Step 2: Create the provider adapter

Create `src/infrastructure/ai/openai/provider.ts`:

- Implement the `AIProvider` interface
- Accept `OpenAIConfig` in the constructor
- Use native `fetch` to call OpenAI's API
- Translate between `ChatRequest`/`ChatResponse` and OpenAI's payload format
- Keep all OpenAI-specific logic inside this file

### Step 3: Wire in the Composition Root

In `src/core/bootstrap.ts`, add three lines:

```typescript
import { OpenAIProvider } from "@/infrastructure/ai/openai/provider";

const openai = new OpenAIProvider(config.ai.openai);
registry.register(openai);
```

### Step 4: Use the provider

```typescript
const response = await gateway.chat("openai", {
  model: "gpt-4o",
  messages: [...],
});
```

### Files that do NOT change:

- `src/core/ai/types.ts` — contracts are already provider-agnostic
- `src/core/ai/gateway.ts` — Gateway works with any registered provider automatically
- `src/core/ai/registry.ts` — Registry is generic, no provider-specific changes
- `src/app/api/chat/route.ts` — Route uses `gateway.chat(providerId, request)`, just change the provider ID

---

## Coding Guidelines

### General

- **No hardcoded defaults** for configuration values. Throw meaningful errors instead.
- **No fabricated values** in translation layers. If the source doesn't provide a value, preserve the absence.
- **No silent fallbacks** in business logic. Fail explicitly.
- **Module-scoped exports** over singletons. `bootstrap.ts` exports plain variables, not classes with static instances.
- **Branded string types** (`ProviderId`, `ModelId`) over enums for extensibility.

### File Organization

- One major concept per file.
- Provider adapters go in `src/infrastructure/ai/{provider-name}/`.
- Group provider files by provider, not by type (e.g., not `src/infrastructure/ai/providers/ollama.ts`).

### Imports

- Core modules use `@/` path alias (`@/core/ai/types`, `@/core/config/config`).
- Infrastructure modules use `@/` path alias (`@/infrastructure/ai/ollama/provider`).
- Never import from `@services/` — that alias is deprecated.

### Error Handling

- Provider adapters throw `OllamaAPIError` (or equivalent) for API errors.
- The Gateway wraps all provider errors in `GatewayError` with the `providerId` and original `cause`.
- Configuration errors throw `ConfigValidationError` with descriptive messages.

### Immutability

- `AppConfig` is deeply frozen after creation.
- Registry state is encapsulated in a `Map` — only exposed through controlled accessors (`get`, `list`, `has`).
- `ChatRequest`, `ChatResponse`, and all contracts are plain objects — treat them as immutable.

### Testing

- Gateway accepts `AIRegistry` via constructor — inject a mock registry with fake providers.
- Provider adapters accept config via constructor — inject test config pointing to a mock server.
- Route accepts `Request` — test with standard `Request` objects, no mocking framework needed.