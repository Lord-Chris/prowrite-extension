import { getAccessToken, getSupabaseClient } from "./auth";

const EXTRACT_FUNCTION = "https://idehaaowusoylwtgnndh.supabase.co/functions/v1/extract-job-details";
const GENERATE_FUNCTION = "https://idehaaowusoylwtgnndh.supabase.co/functions/v1/generate-documents";

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

async function authFetch(url: string, body: any) {
  const token = await getAccessToken();
  if (!token) throw new Error("Not authenticated");

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
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
    throw new Error(msg);
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
  });

  if (data?.error === "subscription_required") {
    throw new Error("subscription_required");
  }

  return data;
}
