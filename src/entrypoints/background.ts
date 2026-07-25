import { defineBackground } from "wxt/sandbox";
import { setSession, clearSession } from "../lib/auth";

export default defineBackground(() => {
  let popupWindowId: number | null = null;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "auth-update" && message.session) {
      setSession(message.session).then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "clear-auth") {
      clearSession().then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "ai-keys-update" && message.aiKeys) {
      chrome.storage.local.set({ aiApiKeys: message.aiKeys }).then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "sync-auth-from-tab") {
      (async () => {
        try {
          const tabs = await chrome.tabs.query({ url: "*://*.prowrite.app/*" });
          if (tabs.length > 0) {
            // Send check-auth to the first matching tab's content script
            await chrome.tabs.sendMessage(tabs[0].id!, { type: "check-auth" });
            sendResponse({ found: true });
          } else {
            sendResponse({ found: false });
          }
        } catch (err) {
          sendResponse({ found: false });
        }
      })();
      return true;
    }

    if (message.type === "open-prowrite-background-tab") {
      (async () => {
        try {
          const baseUrl = message.url || "https://my.prowrite.app";
          const extensionId = message.extensionId || "";
          // Open the /bridge route with the extension ID as a query param
          const bridgeUrl = `${baseUrl}/bridge?ext=${extensionId}`;
          const tab = await chrome.tabs.create({ url: bridgeUrl, active: false });
          sendResponse({ tabId: tab.id });
        } catch (err) {
          sendResponse({ tabId: null });
        }
      })();
      return true;
    }

    if (message.type === "close-tab") {
      (async () => {
        try {
          if (message.tabId) {
            await chrome.tabs.remove(message.tabId);
          }
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false });
        }
      })();
      return true;
    }
  });

  // Clean up popupWindowId when the popup window is closed
  chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId === popupWindowId) {
      popupWindowId = null;
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

    // Close existing popup if one is open
    if (popupWindowId !== null) {
      try {
        await chrome.windows.remove(popupWindowId);
      } catch {
        // Window may have already been closed; ignore error
        popupWindowId = null;
      }
    }

    // Open fresh popup window
    const newWindow = await chrome.windows.create({
      url: chrome.runtime.getURL("popup.html"),
      type: "popup",
      width: 360,
      height: 500,
    });

    // Store the new window ID
    if (newWindow?.id !== undefined) {
      popupWindowId = newWindow.id;
    }
  });
});
