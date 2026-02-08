import { promises as dns } from "node:dns";
import { isIPv4, isIPv6 } from "node:net";

/**
 * Extract the IPv4 portion from an IPv4-mapped IPv6 address (e.g. ::ffff:127.0.0.1).
 * Returns the IPv4 string if mapped, or null otherwise.
 */
function extractMappedIPv4(ip: string): string | null {
  const match = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  return match ? match[1] : null;
}

/**
 * Check if an IP address is in a private/reserved range.
 * Blocks: 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, 0.x, ::1, fc00::/7, fe80::/10,
 * and IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) that map to private ranges.
 */
function isPrivateIP(ip: string): boolean {
  if (isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    return (
      parts[0] === 127 ||                                    // loopback
      parts[0] === 10 ||                                     // class A private
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || // class B private
      (parts[0] === 192 && parts[1] === 168) ||              // class C private
      (parts[0] === 169 && parts[1] === 254) ||              // link-local / cloud metadata
      parts[0] === 0                                         // current network
    );
  }
  if (isIPv6(ip)) {
    const lower = ip.toLowerCase();

    // Check for IPv4-mapped IPv6 (::ffff:x.x.x.x)
    const mappedV4 = extractMappedIPv4(lower);
    if (mappedV4) {
      return isPrivateIP(mappedV4);
    }

    return (
      lower === "::1" ||         // loopback
      lower === "::" ||          // unspecified
      lower.startsWith("fc") ||  // unique local (fc00::/7)
      lower.startsWith("fd") ||  // unique local
      lower.startsWith("fe80")   // link-local
    );
  }
  return true; // block unknown formats
}

/** Blocked hostnames (case-insensitive) */
const BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google.com",
]);

/**
 * Validate a solver endpoint URL for SSRF safety.
 *
 * @param url - The URL to validate
 * @param allowHttp - Whether to allow HTTP (true for dev, false for production)
 * @param allowPrivateIps - Whether to allow private/reserved IP addresses (true for dev/test)
 * @returns `{ ok: true }` or `{ ok: false, error: string }`
 */
export async function validateSolverUrl(
  url: string,
  allowHttp: boolean = false,
  allowPrivateIps: boolean = false,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Invalid URL format" };
  }

  // Scheme check
  if (!allowHttp && parsed.protocol !== "https:") {
    return { ok: false, error: "Only HTTPS URLs are allowed in production" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "URL scheme must be http or https" };
  }

  // Blocked hostnames
  if (BLOCKED_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { ok: false, error: "Blocked hostname" };
  }

  // If hostname is already an IP, check directly
  if (isIPv4(parsed.hostname) || isIPv6(parsed.hostname)) {
    if (!allowPrivateIps && isPrivateIP(parsed.hostname)) {
      return { ok: false, error: "Private/reserved IP addresses are not allowed" };
    }
    return { ok: true };
  }

  // DNS resolution check
  try {
    const result = await dns.lookup(parsed.hostname);
    if (!allowPrivateIps && isPrivateIP(result.address)) {
      return { ok: false, error: "Hostname resolves to a private/reserved IP address" };
    }
  } catch {
    return { ok: false, error: "Unable to resolve hostname" };
  }

  return { ok: true };
}

/**
 * Re-validate a solver URL at request time (DNS rebinding protection).
 * Call this before making outbound HTTP requests to solver endpoints.
 * Returns the resolved IP address for use in the request, or an error.
 */
export async function validateSolverUrlAtRequestTime(
  url: string,
  allowPrivateIps: boolean = false,
): Promise<{ ok: true; resolvedAddress: string } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Invalid URL format" };
  }

  // If hostname is an IP, check directly
  if (isIPv4(parsed.hostname) || isIPv6(parsed.hostname)) {
    if (!allowPrivateIps && isPrivateIP(parsed.hostname)) {
      return { ok: false, error: "Private/reserved IP addresses are not allowed" };
    }
    return { ok: true, resolvedAddress: parsed.hostname };
  }

  // Re-resolve DNS at request time to prevent rebinding
  try {
    const result = await dns.lookup(parsed.hostname);
    if (!allowPrivateIps && isPrivateIP(result.address)) {
      return { ok: false, error: "Hostname resolves to a private/reserved IP address (DNS rebinding blocked)" };
    }
    return { ok: true, resolvedAddress: result.address };
  } catch {
    return { ok: false, error: "Unable to resolve hostname" };
  }
}
