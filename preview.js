const params = new URLSearchParams(location.search);
const initialUrl = params.get("rawUrl") || params.get("url");
const previewId = params.get("previewId");
const LOG_PREFIX = "[GitHub HTML Preview][preview]";
const statusEl = document.getElementById("status");
const sourceUrlEl = document.getElementById("sourceUrl");
const frameEl = document.getElementById("previewFrame");
const openRawButton = document.getElementById("openRawButton");
const runScriptsButton = document.getElementById("runScriptsButton");
const urlFormPanel = document.getElementById("urlFormPanel");
const urlForm = document.getElementById("urlForm");
const urlInput = document.getElementById("urlInput");

let objectUrl = null;
let currentPreviewUrl = null;
let currentHtml = "";
let scriptsEnabled = false;

function setStatus(message, isError = false) {
  console[isError ? "warn" : "info"](LOG_PREFIX, "Status changed", { message, isError });
  statusEl.textContent = message;
  statusEl.hidden = false;
  statusEl.classList.toggle("status-error", isError);
}

function showUrlForm(message = "Paste a GitHub .html or .htm file URL.") {
  setStatus(message, true);
  urlFormPanel.hidden = false;
  openRawButton.disabled = true;
  urlInput.focus();
}

function normalizePreviewUrl(url) {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "https:") {
      return null;
    }

    if (parsed.hostname === "raw.githubusercontent.com") {
      console.info(LOG_PREFIX, "Using raw.githubusercontent.com URL", { url: parsed.href });
      return parsed.href;
    }

    if (parsed.hostname === "github.com" && parsed.pathname.includes("/raw/")) {
      console.info(LOG_PREFIX, "Using github.com raw URL", { url: parsed.href });
      return parsed.href;
    }

    if (parsed.hostname === "github.com" && parsed.pathname.includes("/blob/")) {
      parsed.pathname = parsed.pathname.replace("/blob/", "/raw/");
      console.info(LOG_PREFIX, "Converted blob URL to raw URL", { url: parsed.href });
      return parsed.href;
    }

    console.warn(LOG_PREFIX, "Unsupported preview URL", { url });
    return null;
  } catch {
    console.warn(LOG_PREFIX, "Could not parse preview URL", { url });
    return null;
  }
}

async function loadPreview() {
  console.info(LOG_PREFIX, "Loading preview", {
    location: location.href,
    initialUrl,
    previewId
  });

  if (previewId) {
    await loadStoredPreview(previewId);
    return;
  }

  const previewUrl = normalizePreviewUrl(initialUrl);

  if (!previewUrl) {
    showUrlForm(
      initialUrl
        ? `Invalid preview URL: ${initialUrl}`
        : "Missing preview URL. Paste a GitHub .html or .htm file URL."
    );
    return;
  }

  currentPreviewUrl = previewUrl;
  sourceUrlEl.textContent = previewUrl;
  openRawButton.disabled = false;
  urlFormPanel.hidden = true;

  await loadPreviewUrl(previewUrl);
}

async function loadStoredPreview(id) {
  const storageKey = `preview:${id}`;
  console.info(LOG_PREFIX, "Loading stored preview", { previewId: id, storageKey });
  const item = await chrome.storage.session.get(storageKey);
  const preview = item[storageKey];
  console.info(LOG_PREFIX, "Loaded stored preview", {
    found: Boolean(preview),
    hasHtml: Boolean(preview?.html),
    htmlLength: preview?.html?.length || 0,
    sourceUrl: preview?.sourceUrl
  });

  if (!preview?.html) {
    showUrlForm("Preview data was not found. Paste a GitHub .html or .htm file URL.");
    return;
  }

  currentPreviewUrl = preview.sourceUrl || null;
  sourceUrlEl.textContent = preview.sourceUrl || "Stored preview";
  openRawButton.disabled = !preview.sourceUrl;
  urlFormPanel.hidden = true;
  await renderHtml(preview.html, { allowInlineScripts: false });
  chrome.storage.session.remove(storageKey);
}

async function renderHtml(html, options = {}) {
  const allowInlineScripts = Boolean(options.allowInlineScripts);
  currentHtml = html;
  scriptsEnabled = allowInlineScripts;
  runScriptsButton.hidden = allowInlineScripts;
  console.info(LOG_PREFIX, "Rendering HTML", {
    htmlLength: html.length,
    htmlStart: html.slice(0, 120),
    currentPreviewUrl,
    allowInlineScripts
  });

  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }

  const blob = new Blob([html], { type: "text/html" });
  objectUrl = URL.createObjectURL(blob);
  const htmlWithBase = await prepareHtmlForRenderer(html, currentPreviewUrl, {
    allowInlineScripts
  });
  const rendererUrl = chrome.runtime.getURL("renderer.html");
  console.info(LOG_PREFIX, "Writing iframe sandbox renderer", {
    objectUrl,
    htmlWithBaseLength: htmlWithBase.length,
    rendererUrl
  });
  frameEl.removeAttribute("srcdoc");
  frameEl.addEventListener(
    "load",
    () => {
      console.info(LOG_PREFIX, "Posting HTML to sandbox renderer", {
        htmlWithBaseLength: htmlWithBase.length
      });
      frameEl.contentWindow.postMessage(
        {
          type: "RENDER_HTML",
          html: htmlWithBase
        },
        "*"
      );
    },
    { once: true }
  );
  frameEl.src = rendererUrl;
  statusEl.hidden = true;
}

async function loadPreviewUrl(previewUrl) {
  currentPreviewUrl = previewUrl;
  sourceUrlEl.textContent = previewUrl;
  openRawButton.disabled = false;

  try {
    setStatus("Loading preview...");
    console.info(LOG_PREFIX, "Fetching preview URL", { previewUrl });
    await renderHtml(await fetchPreviewText(previewUrl), { allowInlineScripts: false });
  } catch (error) {
    console.error(LOG_PREFIX, "Could not load URL-based preview", error);
    setStatus(`Could not load preview. ${error.message}`, true);
  }
}

async function fetchPreviewText(previewUrl) {
  const candidates = getPreviewFetchCandidates(previewUrl);
  let lastError = null;

  for (const url of candidates) {
    try {
      const response = await fetch(url, { credentials: "include" });
      console.info(LOG_PREFIX, "Preview fetch finished", {
        ok: response.ok,
        status: response.status,
        url: response.url,
        requestedUrl: url
      });

      if (response.ok) {
        currentPreviewUrl = url;
        sourceUrlEl.textContent = url;
        return response.text();
      }

      lastError = new Error(`Fetch failed with status ${response.status}`);
    } catch (error) {
      console.warn(LOG_PREFIX, "Preview fetch candidate failed", { url, error });
      lastError = error;
    }
  }

  throw lastError || new Error("Fetch failed");
}

function getPreviewFetchCandidates(previewUrl) {
  const candidates = [previewUrl];
  const githubRawUrl = rawGitHubusercontentToGithubRawUrl(previewUrl);

  if (githubRawUrl && githubRawUrl !== previewUrl) {
    candidates.push(githubRawUrl);
  }

  return candidates;
}

async function prepareHtmlForRenderer(html, sourceUrl, options = {}) {
  const htmlWithBase = withBaseHref(html, sourceUrl);
  return inlineExternalAssets(htmlWithBase, sourceUrl, options);
}

async function inlineExternalAssets(html, sourceUrl, options = {}) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const stylesheetLinks = Array.from(doc.querySelectorAll("link[rel~='stylesheet'][href]"));
  const scripts = Array.from(doc.querySelectorAll("script[src]"));
  const inlineScripts = Array.from(doc.querySelectorAll("script:not([src])"));
  const frames = Array.from(doc.querySelectorAll("iframe"));

  console.info(LOG_PREFIX, "Inlining external assets", {
    stylesheetCount: stylesheetLinks.length,
    disabledExternalScriptCount: scripts.length,
    inlineScriptCount: inlineScripts.length,
    allowInlineScripts: Boolean(options.allowInlineScripts),
    disabledFrameCount: frames.length
  });

  await Promise.all(stylesheetLinks.map((link) => inlineStylesheet(link, sourceUrl)));
  scripts.forEach(disableExternalScript);
  if (!options.allowInlineScripts) {
    inlineScripts.forEach(disableInlineScript);
  }
  frames.forEach(disableFrame);

  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

async function inlineStylesheet(link, sourceUrl) {
  const href = link.getAttribute("href");
  const assetUrl = resolveAssetUrl(href, sourceUrl);

  if (!assetUrl) {
    return;
  }

  try {
    const css = await fetchTextAsset(assetUrl);
    const style = document.createElement("style");
    style.textContent = css;
    link.replaceWith(style);
    console.info(LOG_PREFIX, "Inlined stylesheet", { href, assetUrl, length: css.length });
  } catch (error) {
    console.warn(LOG_PREFIX, "Could not inline stylesheet", { href, assetUrl, error });
  }
}

function disableExternalScript(script) {
  const src = script.getAttribute("src");
  const placeholder = document.createComment(`External script disabled by GitHub HTML Preview: ${src}`);
  script.replaceWith(placeholder);
  console.info(LOG_PREFIX, "Disabled external script", { src });
}

function disableInlineScript(script) {
  const placeholder = document.createComment("Inline script disabled by GitHub HTML Preview");
  script.replaceWith(placeholder);
  console.info(LOG_PREFIX, "Disabled inline script");
}

function disableFrame(frame) {
  const src = frame.getAttribute("src") || frame.getAttribute("srcdoc") || "";
  const placeholder = document.createElement("div");
  placeholder.setAttribute("data-github-html-preview-disabled-frame", "");
  placeholder.setAttribute("data-github-html-preview-disabled-src", src.slice(0, 200));
  placeholder.style.cssText = [
    "align-items:center",
    "background:#f6f8fa",
    "border:1px dashed #8c959f",
    "color:#57606a",
    "display:flex",
    "font:13px/20px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    "height:100%",
    "justify-content:center",
    "min-height:120px",
    "width:100%"
  ].join(";");
  placeholder.textContent = "Nested iframe disabled by GitHub HTML Preview";
  frame.replaceWith(placeholder);
  console.info(LOG_PREFIX, "Replaced iframe with placeholder", { src });
}

async function fetchTextAsset(url) {
  const response = await fetch(url, { credentials: "include" });

  if (!response.ok) {
    throw new Error(`Fetch failed with status ${response.status}`);
  }

  return response.text();
}

function resolveAssetUrl(value, sourceUrl) {
  if (!value) {
    return "";
  }

  try {
    return toFetchableGitHubAssetUrl(new URL(value, getAssetFetchBaseUrl(sourceUrl)));
  } catch {
    console.warn(LOG_PREFIX, "Could not resolve asset URL", { value, sourceUrl });
    return "";
  }
}

function getAssetFetchBaseUrl(sourceUrl) {
  if (!sourceUrl) {
    return "";
  }

  try {
    const parsed = new URL(sourceUrl);

    if (parsed.hostname === "github.com" && parsed.pathname.includes("/raw/")) {
      return `${parsed.origin}${parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1)}`;
    }

    if (parsed.hostname === "raw.githubusercontent.com") {
      return `${parsed.origin}${parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1)}`;
    }
  } catch {
    return "";
  }

  return "";
}

function toFetchableGitHubAssetUrl(url) {
  if (url.hostname === "raw.githubusercontent.com") {
    return url.href;
  }

  if (url.hostname === "github.com" && url.pathname.includes("/raw/")) {
    return url.href;
  }

  return url.href;
}

function rawGitHubusercontentToGithubRawUrl(value) {
  try {
    const url = new URL(value);

    if (url.hostname !== "raw.githubusercontent.com") {
      return "";
    }

    const parts = url.pathname.split("/").filter(Boolean);

    if (parts.length < 4) {
      return "";
    }

    const owner = parts[0];
    const repo = parts[1];
    const ref = parts[2];
    const path = parts.slice(3).join("/");

    return `https://github.com/${owner}/${repo}/raw/${ref}/${path}`;
  } catch {
    return "";
  }
}

function isHtmlUrl(url) {
  try {
    const parsed = new URL(url);
    return /\.(html|htm)$/i.test(decodeURIComponent(parsed.pathname));
  } catch {
    return false;
  }
}

function resolvePreviewNavigationUrl(href) {
  try {
    return toFetchableGitHubAssetUrl(new URL(href, getAssetFetchBaseUrl(currentPreviewUrl)));
  } catch {
    console.warn(LOG_PREFIX, "Could not resolve preview navigation URL", {
      href,
      currentPreviewUrl
    });
    return "";
  }
}

function withBaseHref(html, sourceUrl) {
  const baseUrl = getBaseUrl(sourceUrl);

  if (!baseUrl || /<base\s/i.test(html)) {
    console.info(LOG_PREFIX, "Skipping base tag insertion", {
      hasBaseUrl: Boolean(baseUrl),
      alreadyHasBase: /<base\s/i.test(html)
    });
    return html;
  }

  const baseTag = `<base href="${escapeAttribute(baseUrl)}">`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }

  return `${baseTag}${html}`;
}

function getBaseUrl(sourceUrl) {
  if (!sourceUrl) {
    console.warn(LOG_PREFIX, "No source URL available for base tag");
    return "";
  }

  try {
    const parsed = new URL(sourceUrl);

    if (parsed.hostname === "github.com" && parsed.pathname.includes("/raw/")) {
      const baseUrl = toRawGitHubusercontentBaseUrl(parsed);
      console.info(LOG_PREFIX, "Using raw.githubusercontent.com base URL from github.com raw URL", {
        baseUrl
      });
      return baseUrl;
    }

    if (parsed.hostname === "raw.githubusercontent.com") {
      const baseUrl = `${parsed.origin}${parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1)}`;
      console.info(LOG_PREFIX, "Using raw.githubusercontent.com base URL", { baseUrl });
      return baseUrl;
    }
  } catch {
    console.warn(LOG_PREFIX, "Could not parse source URL for base tag", { sourceUrl });
    return "";
  }

  console.warn(LOG_PREFIX, "Unsupported source URL for base tag", { sourceUrl });
  return "";
}

function toRawGitHubusercontentBaseUrl(githubRawUrl) {
  const rawFileUrl = toRawGitHubusercontentFileUrl(githubRawUrl);

  if (!rawFileUrl) {
    return "";
  }

  return rawFileUrl.slice(0, rawFileUrl.lastIndexOf("/") + 1);
}

function toRawGitHubusercontentFileUrl(githubRawUrl) {
  const parts = githubRawUrl.pathname.split("/").filter(Boolean);
  const rawIndex = parts.indexOf("raw");

  if (rawIndex < 2 || rawIndex === parts.length - 1) {
    return "";
  }

  const owner = parts[0];
  const repo = parts[1];
  const refAndPath = normalizeGitHubRawRefAndPath(parts.slice(rawIndex + 1));

  return `https://raw.githubusercontent.com/${owner}/${repo}/${refAndPath.join("/")}`;
}

function normalizeGitHubRawRefAndPath(refAndPath) {
  if (refAndPath[0] === "refs" && refAndPath[1] === "heads" && refAndPath[2]) {
    return [refAndPath[2], ...refAndPath.slice(3)];
  }

  if (refAndPath[0] === "refs" && refAndPath[1] === "tags" && refAndPath[2]) {
    return [refAndPath[2], ...refAndPath.slice(3)];
  }

  return refAndPath;
}

function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

openRawButton.addEventListener("click", () => {
  if (currentPreviewUrl) {
    console.info(LOG_PREFIX, "Opening source URL", { currentPreviewUrl });
    chrome.tabs.create({ url: currentPreviewUrl });
  }
});

runScriptsButton.addEventListener("click", () => {
  if (!currentHtml || scriptsEnabled) {
    return;
  }

  console.warn(LOG_PREFIX, "User enabled inline scripts for preview", {
    currentPreviewUrl
  });
  renderHtml(currentHtml, { allowInlineScripts: true });
});

window.addEventListener("message", (event) => {
  if (event.data?.type !== "PREVIEW_LINK_CLICK") {
    return;
  }

  const targetUrl = resolvePreviewNavigationUrl(event.data.href);
  console.info(LOG_PREFIX, "Preview link click received", {
    href: event.data.href,
    targetUrl
  });

  if (!targetUrl) {
    return;
  }

  if (isHtmlUrl(targetUrl)) {
    loadPreviewUrl(targetUrl);
    return;
  }

  chrome.tabs.create({ url: targetUrl });
});

urlForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const previewUrl = normalizePreviewUrl(urlInput.value.trim());
  console.info(LOG_PREFIX, "Manual preview submitted", {
    input: urlInput.value.trim(),
    previewUrl
  });

  if (!previewUrl) {
    showUrlForm("Enter a GitHub blob, raw, or raw.githubusercontent.com HTML URL.");
    return;
  }

  location.search = `rawUrl=${encodeURIComponent(previewUrl)}`;
});

window.addEventListener("unload", () => {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }
});

loadPreview();
