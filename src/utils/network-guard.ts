/**
 * HTTP target validation helpers for outbound web tools.
 * Ported from OpenHarness utils/network_guard.py
 */

import { URL } from "url";
import dns from "dns";
import { promisify } from "util";
const resolve4 = promisify(dns.resolve4);
const resolve6 = promisify(dns.resolve6);

const DEFAULT_PORTS = { http: 80, https: 443 };

class NetworkGuardError extends Error { constructor(m) { super(m); this.name = "NetworkGuardError"; } }

function validateHttpUrl(urlStr) {
  let parsed;
  try { parsed = new URL(urlStr); } catch (_) { throw new NetworkGuardError("Invalid URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new NetworkGuardError("Only http and https URLs are allowed");
  if (!parsed.hostname) throw new NetworkGuardError("URL must include a host");
  if (parsed.username || parsed.password) throw new NetworkGuardError("URLs with embedded credentials are not allowed");
  return parsed;
}

async function ensurePublicHttpUrl(urlStr) {
  const parsed = validateHttpUrl(urlStr);
  const port = parsed.port ? parseInt(parsed.port) : DEFAULT_PORTS[parsed.protocol.replace(":", "")];

  // Check for loopback / private
  const hostname = parsed.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.startsWith("0.")) {
    throw new NetworkGuardError(`Target is localhost: ${hostname}`);
  }

  // Check private network ranges
  if (hostname.match(/^10\.\d+\.\d+\.\d+$/) ||
      hostname.match(/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/) ||
      hostname.match(/^192\.168\.\d+\.\d+$/)) {
    throw new NetworkGuardError(`Target resolves to private address: ${hostname}`);
  }

  return parsed;
}

export { validateHttpUrl, ensurePublicHttpUrl, NetworkGuardError, DEFAULT_PORTS };
