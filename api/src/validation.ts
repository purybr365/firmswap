const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ORDER_ID_RE = /^0x[0-9a-fA-F]{64}$/;

/** Validate an Ethereum address (0x + 40 hex chars). */
export function isValidAddress(s: string): boolean {
  return ADDRESS_RE.test(s);
}

/** Validate an order ID / bytes32 (0x + 64 hex chars). */
export function isValidOrderId(s: string): boolean {
  return ORDER_ID_RE.test(s);
}

/**
 * Validate an amount string: non-empty, non-negative integer, fits in uint256.
 * Rejects floats, negative numbers, exponential notation, and empty strings.
 */
export function isValidAmount(s: string): boolean {
  if (!s || !/^\d+$/.test(s)) return false;
  try {
    const n = BigInt(s);
    return n > 0n && n < 2n ** 256n;
  } catch {
    return false;
  }
}

/**
 * Validate a URL string: must be http or https with a valid hostname.
 */
export function isValidUrl(s: string): boolean {
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
