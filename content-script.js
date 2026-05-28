const BUTTON_ID = "github-html-preview-extension-button";
const FALLBACK_ID = "github-html-preview-extension-fallback";
const HTML_FILE_RE = /\.(html|htm)$/i;
const LOG_PREFIX = "[GitHub HTML Preview][content]";

let lastUrl = location.href;
let renderTimer = null;

function isGitHubHtmlBlobUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);

    return (
      parsed.hostname === "github.com" &&
      parts.length >= 5 &&
      parts[2] === "blob" &&
      HTML_FILE_RE.test(decodeURIComponent(parts[parts.length - 1]))
    );
  } catch {
    return false;
  }
}

function toRawUrl(url) {
  const rawLink = findRawLink();

  if (rawLink) {
    const rawUrl = new URL(rawLink.getAttribute("href"), location.origin).href;
    console.info(LOG_PREFIX, "Using GitHub raw link", { rawUrl });
    return rawUrl;
  }

  console.warn(LOG_PREFIX, "Raw link not found; using current URL", { url });
  return url;
}

function findRawLink() {
  return Array.from(document.querySelectorAll("a[href]")).find((link) =>
    /\/raw\//.test(link.getAttribute("href") || "")
  );
}

function createButton() {
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.textContent = "Preview HTML";
  button.style.cssText = [
    "align-items:center",
    "background:#238636",
    "border:1px solid rgba(240,246,252,0.1)",
    "border-radius:6px",
    "box-shadow:none",
    "color:#fff",
    "cursor:pointer",
    "display:inline-flex",
    "font:600 12px/20px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    "gap:6px",
    "height:32px",
    "padding:5px 12px",
    "white-space:nowrap"
  ].join(";");

  button.addEventListener("click", async () => {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Loading...";

    try {
      const rawUrl = toRawUrl(location.href);
      console.info(LOG_PREFIX, "Preview button clicked", {
        pageUrl: location.href,
        rawUrl
      });
      const html = await getPreviewHtml(rawUrl);
      console.info(LOG_PREFIX, "Prepared preview HTML", {
        rawUrl,
        htmlLength: html.length,
        htmlStart: html.slice(0, 120)
      });

      chrome.runtime.sendMessage(
        {
          type: "OPEN_PREVIEW",
          rawUrl,
          html
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error(LOG_PREFIX, "Runtime message failed", chrome.runtime.lastError);
          } else {
            console.info(LOG_PREFIX, "Background response", response);
          }

          button.disabled = false;
          button.textContent = originalText;
        }
      );
    } catch (error) {
      console.error(LOG_PREFIX, "Could not prepare preview", error);
      button.disabled = false;
      button.textContent = originalText;
      window.alert(`Could not prepare HTML preview. ${error.message}`);
    }
  });

  return button;
}

async function getPreviewHtml(rawUrl) {
  console.info(LOG_PREFIX, "Extracting HTML from GitHub DOM");
  const html = extractHtmlFromPage();

  if (html) {
    console.info(LOG_PREFIX, "Using HTML extracted from GitHub DOM", {
      htmlLength: html.length
    });
    return html;
  }

  console.info(LOG_PREFIX, "DOM extraction did not find usable HTML; fetching raw HTML", {
    rawUrl
  });

  try {
    const response = await fetch(rawUrl, { credentials: "omit" });
    console.info(LOG_PREFIX, "Raw fetch finished", {
      ok: response.ok,
      status: response.status,
      url: response.url
    });

    if (response.ok) {
      return response.text();
    }
  } catch (error) {
    console.warn(LOG_PREFIX, "Raw fetch failed after DOM extraction fallback", error);
  }

  console.error(LOG_PREFIX, "Could not get usable HTML from DOM or raw fetch");
  throw new Error("Could not fetch raw HTML or read the displayed source.");
}

function extractHtmlFromPage() {
  const selectorGroups = [
    "td.blob-code-inner",
    "td[id^='LC']",
    "[data-testid='code-cell']",
    "[data-testid='code-line-text']",
    ".react-code-text"
  ];

  for (const selector of selectorGroups) {
    const nodes = document.querySelectorAll(selector);
    const html = extractFromNodes(nodes);
    console.info(LOG_PREFIX, "Tried DOM selector", {
      selector,
      nodeCount: nodes.length,
      htmlLength: html.length
    });

    if (html) {
      return html;
    }
  }

  const pre = document.querySelector("pre");
  console.info(LOG_PREFIX, "Trying pre fallback", { found: Boolean(pre) });

  return cleanExtractedLines([pre?.innerText || pre?.textContent || ""]);
}

function extractFromNodes(nodes) {
  if (nodes.length === 0) {
    return "";
  }

  return cleanExtractedLines(
    Array.from(nodes, (node) => node.innerText || node.textContent || "")
  );
}

function cleanExtractedLines(lines) {
  const cleanedLines = lines
    .map((line) => line.replace(/\u00a0/g, " ").trimEnd())
    .filter((line) => line.trim() && !/^\d+$/.test(line.trim()));

  const html = cleanedLines.join("\n").trim();

  if (!/[<][a-z!/]/i.test(html)) {
    return "";
  }

  return html;
}

function findToolbarTarget() {
  const rawLink = findRawLink();

  if (rawLink?.parentElement) {
    return rawLink.parentElement;
  }

  return (
    document.querySelector("[data-testid='blob-viewer-file-actions']") ||
    document.querySelector(".file-actions") ||
    document.querySelector(".BlobToolbar") ||
    document.querySelector("[data-target='react-app.reactRoot']")
  );
}

function ensureFallbackStyles() {
  if (document.getElementById(FALLBACK_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = FALLBACK_ID;
  style.textContent = `
    #${BUTTON_ID}.github-html-preview-extension-floating {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 9999;
      box-shadow: 0 8px 24px rgba(31, 35, 40, 0.18);
    }
  `;
  document.documentElement.appendChild(style);
}

function removeButton() {
  document.getElementById(BUTTON_ID)?.remove();
}

function renderButton() {
  removeButton();

  if (!isGitHubHtmlBlobUrl(location.href)) {
    console.info(LOG_PREFIX, "Current page is not an HTML blob page", { url: location.href });
    return;
  }

  const button = createButton();
  const target = findToolbarTarget();

  if (target) {
    console.info(LOG_PREFIX, "Adding preview button to toolbar", { url: location.href });
    target.appendChild(button);
    return;
  }

  console.warn(LOG_PREFIX, "Toolbar target not found; adding floating button", {
    url: location.href
  });
  ensureFallbackStyles();
  button.classList.add("github-html-preview-extension-floating");
  document.body.appendChild(button);
}

function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(renderButton, 120);
}

function observeUrlChanges() {
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];

    history[method] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event(method.toLowerCase()));
      return result;
    };
  }

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleRender();
      return;
    }

    if (isGitHubHtmlBlobUrl(location.href) && !document.getElementById(BUTTON_ID)) {
      scheduleRender();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("popstate", scheduleRender);
  window.addEventListener("pushstate", scheduleRender);
  window.addEventListener("replacestate", scheduleRender);
  document.addEventListener("turbo:load", scheduleRender);
  document.addEventListener("turbo:render", scheduleRender);
  document.addEventListener("pjax:end", scheduleRender);
}

renderButton();
observeUrlChanges();
