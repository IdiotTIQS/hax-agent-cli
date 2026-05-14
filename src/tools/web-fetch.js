"use strict";

const { URL } = require("node:url");
const { ToolExecutionError } = require("./error");
const { readPositiveInteger, requireString } = require("./utils");
const { isPrivateOrLocalHost } = require("../permissions");

// Browser-like User-Agent to avoid 403 blocks from sites like Sina Finance
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_HEADERS = {
  "User-Agent": BROWSER_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

function createWebFetchTool() {
  const DEFAULT_TIMEOUT_MS = 30_000;
  const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

  return {
    name: "web.fetch",
    description:
      "Fetch the content of a specific URL and convert HTML to plain text. Only supports HTTP and HTTPS URLs. Uses browser-like headers to avoid being blocked.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "The URL to fetch" },
        method: { type: "string", description: "HTTP method", default: "GET" },
        maxBodyBytes: { type: "number", description: "Max body bytes", default: DEFAULT_MAX_BODY_BYTES },
        timeoutMs: { type: "number", description: "Timeout ms", default: DEFAULT_TIMEOUT_MS },
        maxRetries: { type: "number", description: "Max retries", default: 2 },
      },
    },
    async execute(args) {
      const url = requireString(args.url, "url");
      const method = args.method === undefined ? "GET" : requireString(args.method, "method");
      const maxBodyBytes = readPositiveInteger(args.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, "maxBodyBytes");
      const timeoutMs = readPositiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
      const maxRetries = readPositiveInteger(args.maxRetries, 2, "maxRetries");
      const parsedUrl = parseAndValidateUrl(url);

      let lastError;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const { body, truncated: bodyTruncated, status } = await fetchUrl({ parsedUrl, method, maxBodyBytes, timeoutMs });
          const plainText = htmlToPlainText(body);
          return {
            url: parsedUrl.href, status, contentType: "text/html",
            content: plainText, truncated: bodyTruncated,
            note: "FETCH COMPLETE. STOP calling tools. Write your response now.",
          };
        } catch (error) {
          lastError = error;
          if (error.code === "INVALID_URL" || error.code === "PRIVATE_REDIRECT_BLOCKED") throw error;
          if (error.code === "HTTP_ERROR" && error.status && error.status >= 400 && error.status < 500 && error.status !== 429) throw error;
          if (attempt < maxRetries) await new Promise(r => setTimeout(r, Math.min(1000 * 2**attempt, 5000)));
        }
      }
      throw new ToolExecutionError("FETCH_FAILED", `Failed to fetch ${url}: ${lastError?.message || "Unknown error"}`);
    },
  };
}

function parseAndValidateUrl(urlString) {
  const trimmed = urlString.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://"))
    throw new ToolExecutionError("INVALID_URL", "URL must start with http:// or https://");
  try { return new URL(trimmed); }
  catch (e) { throw new ToolExecutionError("INVALID_URL", `Invalid URL: ${e.message}`); }
}

async function fetchUrl({ parsedUrl, method, maxBodyBytes, timeoutMs }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await globalThis.fetch(parsedUrl.href, {
      method: method.toUpperCase(), headers: DEFAULT_HEADERS,
      redirect: "manual", signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get("location");
      if (!loc) throw new ToolExecutionError("HTTP_ERROR", `HTTP ${response.status}: redirect without location`);
      return handleRedirect(loc, method, maxBodyBytes, timeoutMs, parsedUrl, timeoutId);
    }
    if (!response.ok) {
      const err = new ToolExecutionError("HTTP_ERROR", `HTTP ${response.status}: ${response.statusText || "Error"}`);
      err.status = response.status; throw err;
    }

    // Stream response with size limit to avoid buffering huge bodies in memory
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    let done = false;

    while (!done) {
      const { value, done: streamDone } = await reader.read();
      done = streamDone;
      if (value) {
        totalBytes += value.length;
        if (totalBytes > maxBodyBytes) {
          reader.cancel();
          const buf = Buffer.concat(chunks);
          const truncated = buf.slice(0, maxBodyBytes);
          return { body: truncated.toString("utf8"), truncated: true, status: response.status };
        }
        chunks.push(value);
      }
    }

    const buf = Buffer.concat(chunks);
    const truncated = buf.length >= maxBodyBytes;
    return { body: (truncated ? buf.slice(0, maxBodyBytes) : buf).toString("utf8"), truncated, status: response.status };
  } finally { clearTimeout(timeoutId); }
}

async function handleRedirect(location, method, maxBodyBytes, timeoutMs, originalUrl, originalTimeoutId) {
  clearTimeout(originalTimeoutId);
  let redirectUrl;
  try { redirectUrl = new URL(location, originalUrl); }
  catch { throw new ToolExecutionError("INVALID_REDIRECT", `Invalid redirect URL: ${location}`); }
  if (!isPrivateOrLocalHost(originalUrl.hostname) && isPrivateOrLocalHost(redirectUrl.hostname))
    throw new ToolExecutionError("PRIVATE_REDIRECT_BLOCKED", `Redirect to private/local blocked: ${redirectUrl.href}`);
  return fetchUrl({ parsedUrl: redirectUrl, method, maxBodyBytes, timeoutMs });
}

function htmlToPlainText(html) {
  if (!html) return "";
  let text = html;
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)/gi, "\n\n");
  text = text.replace(/<(hr|\/tr)/gi, "\n");
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"');
  text = text.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)));
  text = text.replace(/&[a-zA-Z]+;/g, " ");
  text = text.replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").replace(/\s*\n\s*\n\s*/g, "\n\n");
  return text.trim();
}

module.exports = { createWebFetchTool, fetchUrl, htmlToPlainText };
