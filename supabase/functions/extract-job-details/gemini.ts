import type { AIConfig } from "./index.ts";

export async function callGemini(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string,
  tools?: any[],
  toolChoice?: any,
): Promise<any> {
  const body: any = {
    contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
  };
  if (tools) {
    body.tools = [
      {
        functionDeclarations: tools.map((t: any) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
    ];
    if (toolChoice)
      body.toolConfig = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [toolChoice.function.name] } };
  }

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!resp.ok) {
    const t = await resp.text();
    console.error("Gemini error:", resp.status, t);
    throw new Error("AI generation failed");
  }

  const result = await resp.json();
  const part = result.candidates?.[0]?.content?.parts?.[0];
  if (part?.functionCall) {
    return {
      choices: [
        {
          message: {
            tool_calls: [
              { function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args) } },
            ],
          },
        },
      ],
    };
  }
  return { choices: [{ message: { content: part?.text || "" } }] };
}
