import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const STORAGE_KEY = import.meta.env.VITE_SUPABASE_STORAGE_KEY as string;

// Guard against misconfiguration at build time
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !STORAGE_KEY) {
  throw new Error(
    "Missing required env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_STORAGE_KEY"
  );
}

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

export function getInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export async function getUserDisplayName(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const raw = result[STORAGE_KEY];
    if (!raw) return null;

    const session = typeof raw === "string" ? JSON.parse(raw) : raw;
    const supabase = getClient();
    await supabase.auth.setSession(session);

    const { data: authData } = await supabase.auth.getUser();
    const metaName = authData?.user?.user_metadata?.full_name;
    if (metaName && typeof metaName === "string" && metaName.trim()) {
      return metaName.trim();
    }

    const uid = authData?.user?.id;
    if (uid) {
      const { data: contact } = (await supabase
        .from("contact_info")
        .select("full_name")
        .eq("user_id", uid)
        .maybeSingle()) as any;

      if (contact?.full_name?.trim()) {
        return contact.full_name.trim();
      }
    }

    return null;
  } catch (e) {
    console.error("getUserDisplayName error:", e);
    return null;
  }
}

export { getClient as getSupabaseClient };
