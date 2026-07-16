import { defineContentScript } from "wxt/sandbox";

const STORAGE_KEY = import.meta.env.VITE_SUPABASE_STORAGE_KEY as string;
const AI_PROVIDERS = ["anthropic", "gemini", "groq", "ollama"] as const;

function readSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readAIKeys(userId: string): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const provider of AI_PROVIDERS) {
    try {
      const val = localStorage.getItem(`pw_ai_key_${userId}_${provider}`);
      if (val) keys[provider] = val;
    } catch {
      // ignore
    }
  }
  return keys;
}

function sendAuth() {
  const session = readSession();
  if (session?.access_token) {
    chrome.runtime.sendMessage({ type: "auth-update", session }).catch(() => {});
    // Also bridge AI API keys to extension storage
    const userId = session.user?.id;
    if (userId) {
      const aiKeys = readAIKeys(userId);
      chrome.runtime.sendMessage({ type: "ai-keys-update", aiKeys }).catch(() => {});
    }
  } else {
    chrome.runtime.sendMessage({ type: "clear-auth" }).catch(() => {});
  }
}

export default defineContentScript({
  matches: ["*://*.prowrite.app/*", ...(import.meta.env.DEV ? ["http://localhost/*"] : [])],
  main() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "check-auth") {
        sendAuth();
        sendResponse({ ok: true });
        return true;
      }
      if (message.type === "get-page-content") {
        sendResponse({
          url: document.location.href,
          text: document.body.innerText.slice(0, 50000),
        });
        return true;
      }
    });

    sendAuth();

    let prevToken = readSession()?.access_token;
    setInterval(() => {
      const session = readSession();
      const token = session?.access_token;
      if (token !== prevToken) {
        prevToken = token;
        if (token) {
          chrome.runtime.sendMessage({ type: "auth-update", session }).catch(() => {});
          // Also bridge AI API keys on token change
          const userId = session.user?.id;
          if (userId) {
            const aiKeys = readAIKeys(userId);
            chrome.runtime.sendMessage({ type: "ai-keys-update", aiKeys }).catch(() => {});
          }
        } else {
          chrome.runtime.sendMessage({ type: "clear-auth" }).catch(() => {});
        }
      }
    }, 15000);
  },
});
