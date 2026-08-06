"use client";

import { useState } from "react";

interface ChatResponseBody {
  message?: {
    content?: Array<{ type: string; text?: string }>;
  };
  error?: string;
}

function extractText(message: ChatResponseBody["message"]): string {
  if (!message?.content) return "";
  return message.content
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("");
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");

  async function handleAsk() {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
      }),
    });

    const data: ChatResponseBody = await response.json();

    if (!response.ok || data.error) {
      setAnswer(data.error ?? "An unexpected error occurred");
      return;
    }

    setAnswer(extractText(data.message));
  }

  return (
    <main className="max-w-2xl mx-auto mt-20 space-y-4">

      <h1 className="text-3xl font-bold">
        Stelaris AI Core
      </h1>

      <textarea
        className="border w-full p-3 rounded"
        rows={6}
        value={prompt}
        onChange={(e)=>setPrompt(e.target.value)}
      />

      <button
        onClick={handleAsk}
        className="bg-black text-white px-5 py-2 rounded"
      >
        Ask AI
      </button>

      <div className="border rounded p-4 whitespace-pre-wrap">
        {answer}
      </div>

    </main>
  );
}