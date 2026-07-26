"use client";

import { useState } from "react";

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

    const data = await response.json();

    setAnswer(data.reply);
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