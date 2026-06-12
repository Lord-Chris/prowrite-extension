import { defineContentScript } from "wxt/sandbox";

const STORAGE_KEY = "sb-idehaaowusoylwtgnndh-auth-token";

function readSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function sendAuth() {
  const session = readSession();
  if (session?.access_token) {
    chrome.runtime.sendMessage({ type: "auth-update", session }).catch(() => {});
  } else {
    chrome.runtime.sendMessage({ type: "clear-auth" }).catch(() => {});
  }
}

export default defineContentScript({
  matches: ["*://*.prowrite.app/*", ...(import.meta.env.DEV ? ["*://localhost:*/*"] : [])],
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
        } else {
          chrome.runtime.sendMessage({ type: "clear-auth" }).catch(() => {});
        }
      }
    }, 15000);
  },
});
