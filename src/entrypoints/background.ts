import { defineBackground } from "wxt/sandbox";
import { setSession, clearSession } from "../lib/auth";

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "auth-update" && message.session) {
      setSession(message.session).then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "clear-auth") {
      clearSession().then(() => sendResponse({ ok: true }));
      return true;
    }
  });

  chrome.action.onClicked.addListener(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab?.id) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            url: document.location.href,
            text: document.body.innerText.slice(0, 50000),
          }),
        });

        const content = results[0]?.result;
        if (content) {
          await chrome.storage.local.set({ pendingPageContent: content });
        } else {
          await chrome.storage.local.set({ pendingPageError: "Could not read page content" });
        }
      } catch {
        await chrome.storage.local.set({
          pendingPageError: "Cannot access contents of the page. Try a job posting page.",
        });
      }
    } else {
      await chrome.storage.local.set({ pendingPageError: "No active tab found" });
    }

    chrome.windows.create({
      url: chrome.runtime.getURL("popup.html"),
      type: "popup",
      width: 360,
      height: 500,
    });
  });
});
