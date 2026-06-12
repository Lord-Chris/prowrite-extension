import type { AIConfig } from "./index.ts";

export function extractJsonFromResponse(response: string): unknown | null {
  try {
    return JSON.parse(response);
  } catch { /* fallback below */ }

  let cleaned = response
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const jsonStart = cleaned.search(/[\{\[]/);
  const jsonEnd = cleaned.lastIndexOf(jsonStart !== -1 && cleaned[jsonStart] === '[' ? ']' : '}');
  if (jsonStart === -1 || jsonEnd === -1) return null;

  cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  try {
    return JSON.parse(cleaned);
  } catch {
    cleaned = cleaned
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .replace(/[\x00-\x1F\x7F]/g, "");
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

export async function callOllama(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string,
  tools?: any[],
): Promise<any> {
  const body: any = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    stream: false,
  };

  const baseUrl = config.baseUrl || "http://localhost:11434";
  const resp = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text();
    console.error("Ollama error:", resp.status, t);
    throw new Error("AI generation failed");
  }

  return resp.json();
}
