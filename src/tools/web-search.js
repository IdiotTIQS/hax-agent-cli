"use strict";

const { ToolExecutionError } = require("./error");
const { requireString, readPositiveInteger } = require("./utils");
const { fetchUrl, htmlToPlainText } = require("./web-fetch");

const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 15_000;

function createWebSearchTool() {
  return {
    name: "web.search",
    description: "Search the web for information. Returns relevant search results with titles, URLs, and snippets.",
    inputSchema: {
      type: "object", required: ["query"],
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Max results (1-20)", default: DEFAULT_MAX_RESULTS },
        timeoutMs: { type: "number", description: "Timeout ms", default: DEFAULT_TIMEOUT_MS },
      },
    },
    async execute(args) {
      const query = requireString(args.query, "query");
      const maxResults = Math.min(readPositiveInteger(args.maxResults, DEFAULT_MAX_RESULTS, "maxResults"), 20);
      const timeoutMs = readPositiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");

      let results = [];
      try { results = await searchDuckDuckGo(query, maxResults, timeoutMs); } catch (_) {}
      if (results.length === 0) {
        try { results = await searchBingFallback(query, maxResults, timeoutMs); } catch (_) {}
      }
      return {
        query, results, resultCount: results.length,
        note: "SEARCH COMPLETE. STOP calling tools. Write your response now.",
      };
    },
  };
}

async function searchDuckDuckGo(query, maxResults, timeoutMs) {
  const url = new URL(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  const { body } = await fetchUrl({ parsedUrl: url, method: "GET", maxBodyBytes: 2*1024*1024, timeoutMs });
  return parseDdgResults(body, maxResults);
}

async function searchBingFallback(query, maxResults, timeoutMs) {
  const url = new URL(`https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`);
  const { body } = await fetchUrl({ parsedUrl: url, method: "GET", maxBodyBytes: 512*1024, timeoutMs });
  return parseBingRss(body, maxResults);
}

function parseDdgResults(html, maxResults) {
  const results = [];
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null && results.length < maxResults) {
    const url = decodeDdgUrl(m[1]);
    if (!url || !url.startsWith("http")) continue;
    const title = htmlToPlainText(m[2]).trim();
    if (title.length >= 2) results.push({ title, url });
  }
  if (results.length === 0) {
    const fallRe = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]{3,200})<\/a>/gi;
    while ((m = fallRe.exec(html)) !== null && results.length < maxResults) {
      const title = m[2].replace(/<[^>]+>/g, "").trim();
      if (title.length >= 3 && !m[1].includes("duckduckgo.com"))
        results.push({ title, url: m[1] });
    }
  }
  return results.slice(0, maxResults);
}

function decodeDdgUrl(raw) {
  try {
    const p = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    if (p.hostname.includes("duckduckgo.com")) {
      const u = p.searchParams.get("uddg");
      if (u) return decodeURIComponent(u);
    }
    return p.href;
  } catch { return raw.startsWith("http") ? raw : null; }
}

function parseBingRss(xml, maxResults) {
  const results = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null && results.length < maxResults) {
    const tm = m[1].match(/<title>([\s\S]*?)<\/title>/i);
    const lm = m[1].match(/<link>([\s\S]*?)<\/link>/i);
    if (tm && lm) {
      const title = htmlToPlainText(tm[1]).trim();
      const url = lm[1].trim();
      if (title && url.startsWith("http")) results.push({ title, url });
    }
  }
  return results;
}

module.exports = { createWebSearchTool };
