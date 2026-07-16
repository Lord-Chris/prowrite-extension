import { getAccessToken, getSupabaseClient } from "./auth";

const SUPABASE_FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

const EXTRACT_FUNCTION = `${SUPABASE_FUNCTIONS_BASE}/extract-job-details`;
const GENERATE_FUNCTION = `${SUPABASE_FUNCTIONS_BASE}/generate-documents`;

export interface ExtractedJob {
  job_title: string;
  company: string;
  key_responsibilities: string[];
  required_skills: string[];
  years_of_experience_required: number;
  seniority?: "entry" | "mid" | "senior" | "lead" | "director";
  company_description?: string;
  nice_to_have_skills?: string[];
}

export class AuthFetchError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AuthFetchError";
    this.statusCode = statusCode;
  }
}

async function getAIKey(): Promise<string | null> {
  try {
    const stored = await chrome.storage.local.get<{ aiApiKeys?: Record<string, string> }>(["aiApiKeys"]);
    if (!stored.aiApiKeys) return null;

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: activeProvider } = await supabase
      .from("ai_provider_settings")
      .select("provider")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (activeProvider?.provider && stored.aiApiKeys[activeProvider.provider]) {
      return stored.aiApiKeys[activeProvider.provider];
    }

    // Fallback: try groq key (most common fallback)
    return stored.aiApiKeys.groq || null;
  } catch {
    return null;
  }
}

async function authFetch(url: string, body: any, includeAIKey = false) {
  const token = await getAccessToken();
  if (!token) throw new AuthFetchError("Not authenticated", 401);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  if (includeAIKey) {
    const aiKey = await getAIKey();
    if (aiKey) {
      headers["x-ai-api-key"] = aiKey;
    }
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    let msg: string;
    try {
      msg = JSON.parse(text).error || text;
    } catch {
      msg = text || `Request failed (${resp.status})`;
    }
    throw new AuthFetchError(msg, resp.status);
  }

  return resp.json();
}

export async function extractJobDetails(
  pageUrl: string,
  pageText: string,
): Promise<ExtractedJob> {
  const { data } = await authFetch(EXTRACT_FUNCTION, { pageUrl, pageText });
  return data;
}

export async function saveJob(job: {
  title: string;
  company: string;
  job_link: string;
  job_description: string;
  status: string;
}): Promise<string> {
  const supabase = getSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("job_applications")
    .insert({
      user_id: user.id,
      title: job.title,
      company: job.company,
      job_link: job.job_link || null,
      job_description: job.job_description || null,
      status: job.status,
    } as any)
    .select("id")
    .single();

  if (error) throw error;
  return (data as any).id as string;
}

export async function generateDocuments(jobId: string) {
  const { data } = await authFetch(GENERATE_FUNCTION, {
    jobApplicationId: jobId,
    generateCv: true,
    generateCoverLetter: true,
  }, true);

  if (data?.error === "subscription_required") {
    const err = new AuthFetchError("subscription_required", 402);
    throw err;
  }

  return data;
}
