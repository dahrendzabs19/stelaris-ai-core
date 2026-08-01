# Stelaris AI Core

Stelaris AI Core is a provider-agnostic TypeScript SDK for AI applications. It
defines a canonical protocol for messages, multimodal content, model routing,
and streaming events.

## Installation

```bash
npm install @stelaris/ai-core
```

Requires Node.js 20 or later.

## Protocol

Messages use ordered content parts rather than a single string:

```ts
import type { Message } from "@stelaris/ai-core";

const message: Message = {
  role: "user",
  content: [{ type: "text", text: "Hello" }],
};
```

Streaming uses discriminated `StreamEvent` values, including text deltas,
usage, completion, and error events.

## License

[MIT](./LICENSE)
