const LOG_PREFIX = "[GitHub HTML Preview][background]";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const previewTargetUrl = message?.rawUrl || message?.url;
  console.info(LOG_PREFIX, "Received message", {
    type: message?.type,
    hasHtml: Boolean(message?.html),
    htmlLength: message?.html?.length || 0,
    previewTargetUrl,
    senderUrl: sender.tab?.url
  });

  if (message?.type !== "OPEN_PREVIEW") {
    console.warn(LOG_PREFIX, "Ignoring unsupported message", { type: message?.type });
    return false;
  }

  if (message.html) {
    const previewId = crypto.randomUUID();
    const storageKey = `preview:${previewId}`;
    console.info(LOG_PREFIX, "Storing prepared HTML", {
      previewId,
      storageKey,
      htmlLength: message.html.length
    });

    chrome.storage.session.set(
      {
        [storageKey]: {
          html: message.html,
          sourceUrl: previewTargetUrl || sender.tab?.url || ""
        }
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error(LOG_PREFIX, "Failed to store preview HTML", chrome.runtime.lastError);
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }

        const previewUrl = chrome.runtime.getURL(`preview.html?previewId=${previewId}`);
        console.info(LOG_PREFIX, "Opening stored preview tab", { previewUrl });

        chrome.tabs.create({ url: previewUrl }, (tab) => {
          if (chrome.runtime.lastError) {
            console.error(LOG_PREFIX, "Failed to open preview tab", chrome.runtime.lastError);
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }

          console.info(LOG_PREFIX, "Opened preview tab", { tabId: tab?.id });
          sendResponse({ ok: Boolean(tab?.id) });
        });
      }
    );

    return true;
  }

  if (previewTargetUrl) {
    const previewUrl = chrome.runtime.getURL(
      `preview.html?rawUrl=${encodeURIComponent(previewTargetUrl)}`
    );
    console.info(LOG_PREFIX, "Opening URL-based preview tab", { previewUrl });

    chrome.tabs.create({ url: previewUrl }, (tab) => {
      if (chrome.runtime.lastError) {
        console.error(LOG_PREFIX, "Failed to open URL-based preview tab", chrome.runtime.lastError);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      console.info(LOG_PREFIX, "Opened URL-based preview tab", { tabId: tab?.id });
      sendResponse({ ok: Boolean(tab?.id) });
    });

    return true;
  }

  console.error(LOG_PREFIX, "Missing preview target URL or HTML");
  sendResponse({ ok: false, error: "Missing preview target URL or HTML." });

  return false;
});
