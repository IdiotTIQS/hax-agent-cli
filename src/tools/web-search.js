const { URL } = require('node:url');
const { ToolExecutionError } = require('./error');
const { requireString, readPositiveInteger } = require('./utils');
const { fetchUrl, htmlToPlainText } = require('./web-fetch');

function createWebSearchTool() {
  const DEFAULT_MAX_RESULTS = 10;
  const DEFAULT_TIMEOUT_MS = 15_000;

  return {
    name: 'web.search',
    description: 'Search the web for information. Returns relevant search results with titles, URLs, and snippets.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'The search query string' },
        maxResults: { type: 'number', description: 'Maximum number of results to return', default: DEFAULT_MAX_RESULTS },
        timeoutMs: { type: 'number', description: 'Request timeout in milliseconds', default: DEFAULT_TIMEOUT_MS },
      },
    },
    async execute(args) {
      const query = requireString(args.query, 'query');
      const maxResults = readPositiveInteger(args.maxResults, DEFAULT_MAX_RESULTS, 'maxResults');
      const timeoutMs = readPositiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs');

      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const parsedUrl = new URL(searchUrl);

      const { body: html } = await fetchUrl({
        parsedUrl,
        method: 'GET',
        maxBodyBytes: 2 * 1024 * 1024,
        timeoutMs,
      });

      const results = parseDuckDuckgoResults(html, maxResults);

      return {
        query,
        results,
        resultCount: results.length,
        note: 'SEARCH COMPLETE. You now have the search results. STOP calling tools. Write your response to the user now using these results. Do NOT call web.fetch, web.search, or file.readDirectory again.',
      };
    },
  };
}

function parseDuckDuckgoResults(html, maxResults) {
  const results = [];
  const resultRegex = /<a[^>]*class="[^"]*result[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
  let match;

  while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
    const url = match[1].replace(/https?:\/\/duckduckgo\.com\/l\/\?uddg=/, '').replace(/[&?]at=.*/, '');
    const title = htmlToPlainText(match[2]).trim();

    if (title && url.startsWith('http')) {
      results.push({ title, url });
    }
  }

  if (results.length === 0) {
    const simpleLinks = html.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/gi) || [];
    for (const tag of simpleLinks.slice(0, maxResults)) {
      const urlMatch = tag.match(/href="(https?:\/\/[^"]+)"/);
      const titleMatch = tag.match(/>([^<]+)</);
      if (urlMatch && titleMatch) {
        const title = titleMatch[1].trim();
        if (title.length > 3 && !title.toLowerCase().includes('duckduckgo')) {
          results.push({ title, url: urlMatch[1] });
        }
      }
    }
  }

  return results.slice(0, maxResults);
}

module.exports = { createWebSearchTool };
