import type { AIConfig } from "./index.ts";

export async function callClaude(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string,
  tools?: any[],
  toolChoice?: any,
): Promise<any> {
  const body: any = {
    model: config.model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };
  if (tools) {
    body.tools = tools.map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
    if (toolChoice) body.tool_choice = { type: "tool", name: toolChoice.function.name };
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text();
    console.error("Anthropic error:", resp.status, t);
    throw new Error("AI generation failed");
  }

  const result = await resp.json();
  const toolUse = result.content?.find((c: any) => c.type === "tool_use");
  if (toolUse) {
    return {
      choices: [
        { message: { tool_calls: [{ function: { name: toolUse.name, arguments: JSON.stringify(toolUse.input) } }] } },
      ],
    };
  }
  return { choices: [{ message: { content: result.content?.map((c: any) => c.text).join("") || "" } }] };
}
