import { askAI } from "@/services/ai/gateway";

export async function POST(request: Request) {
  const body = await request.json();

  const reply = await askAI(body.prompt);

  return Response.json({
    reply,
  });
}