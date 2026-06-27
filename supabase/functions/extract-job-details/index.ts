import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callOllama } from "./ollama.ts";
import { callClaude } from "./claude.ts";
import { callGemini } from "./gemini.ts";
import { callGroq } from "./groq.ts";
import {
  FALLBACK_AI_PROVIDER,
  FALLBACK_AI_MODEL,
  PROVIDER_DEFAULT_MODELS,
} from "../_shared/ai-constants.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export interface AIConfig {
  provider: "anthropic" | "gemini" | "groq" | "ollama";
  apiKey: string;
  model: string;
  baseUrl?: string;
}

async function resolveAIProvider(supabase: any, userId: string): Promise<AIConfig> {
  const { data: activeProvider } = await supabase
    .from("ai_provider_settings")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (activeProvider) {
    return {
      provider: activeProvider.provider,
      apiKey: activeProvider.api_key || "",
      model: activeProvider.model_name || PROVIDER_DEFAULT_MODELS[activeProvider.provider] || "",
      baseUrl: activeProvider.base_url || undefined,
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("fallback_ai_enabled")
    .eq("user_id", userId)
    .maybeSingle();

  const fallbackAiEnabled = profile?.fallback_ai_enabled !== false;
  const FALLBACK_AI_API_KEY = Deno.env.get("FALLBACK_AI_API_KEY");

  if (fallbackAiEnabled && FALLBACK_AI_API_KEY) {
    return { provider: FALLBACK_AI_PROVIDER, apiKey: FALLBACK_AI_API_KEY, model: FALLBACK_AI_MODEL };
  }

  throw new Error("No AI provider configured. Please add an AI provider in Settings > Integrations.");
}

async function callAI(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string,
  tools?: any[],
  toolChoice?: any,
): Promise<any> {
  switch (config.provider) {
    case "groq":
      return callGroq(config, systemPrompt, userPrompt, tools, toolChoice);
    case "anthropic":
      return callClaude(config, systemPrompt, userPrompt, tools, toolChoice);
    case "gemini":
      return callGemini(config, systemPrompt, userPrompt, tools, toolChoice);
    case "ollama":
      return callOllama(config, systemPrompt, userPrompt, tools);
    default:
      throw new Error(`Unsupported AI provider: ${config.provider}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiConfig = await resolveAIProvider(supabase, user.id);

    const { pageUrl, pageText } = await req.json();

    if (!pageText || pageText.trim().length < 20) {
      return new Response(
        JSON.stringify({ error: "Not enough text on the page. Make sure you're on a job posting page." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const systemPrompt = `You are a job posting parser. Extract structured data from the provided job posting text. Be thorough and accurate. Return ONLY valid JSON matching the schema described in the tool call.`;

    const userPrompt = `Parse this job posting and extract all information. URL: ${pageUrl || "unknown"}\n\n---\n\n${pageText}`;

    const tools = [
      {
        type: "function",
        function: {
          name: "extracted_job_details",
          description: "Return the structured job details extracted from the text.",
          parameters: {
            type: "object",
            properties: {
              job_title: { type: "string", description: "Job title / role name" },
              company: { type: "string", description: "Company or organization name" },
              key_responsibilities: {
                type: "array", items: { type: "string" },
                description: "List of key job responsibilities and day-to-day tasks",
              },
              required_skills: {
                type: "array", items: { type: "string" },
                description: "Skills and qualifications the candidate must have",
              },
              years_of_experience_required: {
                type: "number",
                description: "Minimum years of experience required (0 if not specified)",
              },
              location: { type: "string", description: "Job location (city, remote, hybrid)" },
              job_description: { type: "string", description: "Full job description text" },
              salary_range: { type: "string", description: "Salary range if mentioned" },
              employment_type: {
                type: "string", enum: ["Full-time", "Part-time", "Contract", "Internship", "Temporary", "Other"],
                description: "Employment type",
              },
              seniority: {
                type: "string", enum: ["entry", "mid", "senior", "lead", "director"],
                description: "Seniority level inferred from job title and experience requirements",
              },
              company_description: { type: "string", description: "Brief description of the company relevant to the role" },
              nice_to_have_skills: {
                type: "array", items: { type: "string" },
                description: "Skills listed as preferred or nice-to-have but not required",
              },
            },
            required: ["job_title", "company", "key_responsibilities", "required_skills", "years_of_experience_required"],
            additionalProperties: false,
          },
        },
      },
    ];
    const toolChoice = { type: "function", function: { name: "extracted_job_details" } };

    const aiResult = await callAI(aiConfig, systemPrompt, userPrompt, tools, toolChoice);
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No structured data returned from AI");

    const extracted = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ data: extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-job-details error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
