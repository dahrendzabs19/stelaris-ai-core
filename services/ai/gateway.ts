const OLLAMA_URL = "http://localhost:11434/api/chat";

export async function askAI(prompt: string) {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen3:8b",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      stream: false,
    }),
  });

  const data = await response.json();

  return data.message.content;
}