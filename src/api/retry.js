"use strict";

/**
 * API Retry - exponential backoff with jitter.
 * Ported from OpenHarness api/client.py.
 */

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 529]);

function isRetryable(err) {
  const status = err?.status || err?.statusCode || 0;
  if (RETRYABLE_STATUS_CODES.has(status)) return true;
  const msg = String(err?.message || "").toLowerCase();
  return /rate.?limit|too many requests|server error|internal server|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i.test(msg);
}

function parseRetryAfter(err) {
  const h = err?.headers?.["retry-after"] || err?.response?.headers?.["retry-after"];
  if (!h) return 0;
  const s = parseInt(h, 10);
  if (Number.isFinite(s) && s > 0) return s * 1000;
  try { const d = new Date(h); if (!isNaN(d.getTime())) return Math.max(0, d.getTime() - Date.now()); } catch (_) {}
  return 0;
}

async function withRetry(fn, { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 30000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt >= maxRetries) throw err;
      const retryAfter = parseRetryAfter(err);
      const delay = retryAfter > 0 ? Math.min(retryAfter, maxDelayMs)
        : Math.min(baseDelayMs * Math.pow(2, attempt) + Math.random() * baseDelayMs * 0.5, maxDelayMs);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

module.exports = { withRetry, isRetryable, parseRetryAfter };
