// Shared AI configuration constants for all edge functions
// Change fallback model in one place — all functions import from here

export const FALLBACK_AI_PROVIDER = "groq" as const;
export const FALLBACK_AI_MODEL = "llama-3.3-70b-versatile";

// Vision-capable model for parse-cv multimodal fallback (when PDF text extraction fails)
export const FALLBACK_VISION_MODEL = "qwen/qwen3-32b";

export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-20250514",
  gemini: "gemini-2.5-flash",
  groq: FALLBACK_AI_MODEL,
  ollama: "llama3",
};
