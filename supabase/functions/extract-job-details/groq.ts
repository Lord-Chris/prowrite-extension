import type { AIConfig } from "./index.ts";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function callGroq(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string,
  tools?: any[],
  toolChoice?: any,
): Promise<any> {
  const body: any = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };
  if (tools) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }

  const resp = await fetch(GROQ_BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text();
    console.error("Groq error:", resp.status, t);
    if (resp.status === 429)
      throw Object.assign(new Error("Rate limit exceeded. Please try again later."), { status: 429 });
    throw new Error(`Groq API error (${resp.status}): ${t.slice(0, 200)}`);
  }

  return resp.json();
}
