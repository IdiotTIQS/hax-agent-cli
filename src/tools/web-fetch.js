const { URL } = require('node:url');
const { ToolExecutionError } = require('./error');
const { readPositiveInteger, requireString } = require('./utils');
const { isPrivateOrLocalHost } = require('../permissions');

function createWebFetchTool() {
  const DEFAULT_TIMEOUT_MS = 30_000;
  const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

  return {
    name: 'web.fetch',
    description: 'Fetch the content of a specific URL and convert HTML to plain text. Only supports HTTP and HTTPS URLs. IMPORTANT: Only fetch the URL the user explicitly requested. Do NOT automatically fetch links found in the response content.',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'The URL to fetch. Must start with http:// or https://' },
        method: { type: 'string', description: 'HTTP method (GET or POST)', default: 'GET' },
        maxBodyBytes: { type: 'number', description: 'Maximum response body size in bytes', default: DEFAULT_MAX_BODY_BYTES },
        timeoutMs: { type: 'number', description: 'Request timeout in milliseconds', default: DEFAULT_TIMEOUT_MS },
        maxRetries: { type: 'number', description: 'Maximum number of retry attempts on failure', default: 2 },
      },
    },
    async execute(args) {
      const url = requireString(args.url, 'url');
      const method = args.method === undefined ? 'GET' : requireString(args.method, 'method');
      const maxBodyBytes = readPositiveInteger(args.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, 'maxBodyBytes');
      const timeoutMs = readPositiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs');
      const maxRetries = readPositiveInteger(args.maxRetries, 2, 'maxRetries');

      const parsedUrl = parseAndValidateUrl(url);

      let lastError;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const { body, truncated: bodyTruncated } = await fetchUrl({ parsedUrl, method, maxBodyBytes, timeoutMs });
          const plainText = htmlToPlainText(body);

          return {
            url: parsedUrl.href,
            status: 200,
            contentType: 'text/html',
            content: plainText,
            truncated: bodyTruncated,
            note: 'FETCH COMPLETE. You now have the content. STOP calling tools. Write your response to the user now using this content. Do NOT call web.fetch, web.search, or file.readDirectory again.',
          };
        } catch (error) {
          lastError = error;
          if (error.code === 'HTTP_ERROR' || error.code === 'INVALID_URL' || error.code === 'PRIVATE_REDIRECT_BLOCKED') {
            throw error;
          }
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      const message = lastError?.message || 'Unknown fetch error';
      throw new ToolExecutionError('FETCH_FAILED', `Failed to fetch ${url}: ${message}`);
    },
  };
}

function parseAndValidateUrl(urlString) {
  const trimmed = urlString.trim();

  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    throw new ToolExecutionError('INVALID_URL', 'URL must start with http:// or https://');
  }

  try {
    return new URL(trimmed);
  } catch (error) {
    throw new ToolExecutionError('INVALID_URL', `Invalid URL: ${error.message}`);
  }
}

async function fetchUrl({ parsedUrl, method, maxBodyBytes, timeoutMs }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await globalThis.fetch(parsedUrl.href, {
      method: method.toUpperCase(),
      headers: {
        'User-Agent': 'HaxAgent/1.3.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'manual',
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new ToolExecutionError('HTTP_ERROR', `HTTP ${response.status}: redirect without location`);
      }
      return handleRedirect(location, method, maxBodyBytes, timeoutMs, parsedUrl, timeoutId);
    }

    if (!response.ok) {
      throw new ToolExecutionError('HTTP_ERROR', `HTTP ${response.status}: ${response.statusText || 'Error'}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    let buffer = Buffer.from(arrayBuffer);

    const truncated = buffer.length >= maxBodyBytes;
    if (buffer.length > maxBodyBytes) {
      buffer = buffer.slice(0, maxBodyBytes);
    }

    return { body: buffer.toString('utf8'), truncated };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleRedirect(location, method, maxBodyBytes, timeoutMs, originalUrl, originalTimeoutId) {
  clearTimeout(originalTimeoutId);

  let redirectUrl;
  try {
    redirectUrl = new URL(location, originalUrl);
  } catch {
    throw new ToolExecutionError('INVALID_REDIRECT', `Invalid redirect URL: ${location}`);
  }

  if (!isPrivateOrLocalHost(originalUrl.hostname) && isPrivateOrLocalHost(redirectUrl.hostname)) {
    throw new ToolExecutionError('PRIVATE_REDIRECT_BLOCKED', `Redirect to private or local address blocked: ${redirectUrl.href}`);
  }

  return fetchUrl({ parsedUrl: redirectUrl, method, maxBodyBytes, timeoutMs });
}

function htmlToPlainText(html) {
  if (!html) return '';

  let text = html;

  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)/gi, '\n\n');
  text = text.replace(/<(hr|\/tr)/gi, '\n');

  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ');

  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  text = text.replace(/&[a-zA-Z]+;/g, ' ');

  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s+/g, '\n');
  text = text.replace(/\s*\n\s*\n\s*/g, '\n\n');

  return text.trim();
}

module.exports = { createWebFetchTool, fetchUrl, htmlToPlainText };
