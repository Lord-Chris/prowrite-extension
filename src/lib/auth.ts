import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://idehaaowusoylwtgnndh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkZWhhYW93dXNveWx3dGdubmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMTk5NDcsImV4cCI6MjA5Mjc5NTk0N30.LiCLkPRF8XTdbHIBEik-i_-9ldfRJruKmZPMeR05blY";

const STORAGE_KEY = "sb-idehaaowusoylwtgnndh-auth-token";

let client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

export async function getAccessToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY];
  if (!raw) return null;

  try {
    const session = typeof raw === "string" ? JSON.parse(raw) : raw;

    const supabase = getClient();

    const { error } = await supabase.auth.setSession(session);
    if (error) return null;

    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch (e) {
    console.error("getAccessToken error:", e);
    return null;
  }
}

export async function getValidSession() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY];
  if (!raw) return null;

  try {
    const session = typeof raw === "string" ? JSON.parse(raw) : raw;
    const supabase = getClient();
    const { error } = await supabase.auth.setSession(session);
    if (error) return null;
    const { data } = await supabase.auth.getSession();
    return data.session ?? null;
  } catch {
    return null;
  }
}

export async function setSession(session: any) {
  await chrome.storage.local.set({ [STORAGE_KEY]: session });
}

export async function clearSession() {
  await chrome.storage.local.remove(STORAGE_KEY);
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null;
}

export { getClient as getSupabaseClient };
