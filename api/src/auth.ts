import { verifyMessage, type Address, type Hex } from "viem";

const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build the EIP-191 message a solver must sign to prove address ownership.
 */
export function buildRegistrationMessage(
  address: string,
  endpointUrl: string,
  timestamp: number,
): string {
  return `FirmSwap Solver Registration\nAddress: ${address.toLowerCase()}\nEndpoint: ${endpointUrl}\nTimestamp: ${timestamp}`;
}

/**
 * Build the EIP-191 message a solver must sign for unregistration.
 */
export function buildUnregistrationMessage(
  address: string,
  timestamp: number,
): string {
  return `FirmSwap Solver Unregistration\nAddress: ${address.toLowerCase()}\nTimestamp: ${timestamp}`;
}

/**
 * Verify a solver's EIP-191 signature proves ownership of the claimed address.
 * Returns `{ ok: true }` or `{ ok: false, error: string }`.
 */
export async function verifySolverAuth(
  address: string,
  message: string,
  signature: string,
  timestamp: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Check timestamp freshness
  const now = Date.now();
  if (Math.abs(now - timestamp) > MAX_TIMESTAMP_DRIFT_MS) {
    return { ok: false, error: "Signature timestamp expired or too far in the future" };
  }

  try {
    const valid = await verifyMessage({
      address: address as Address,
      message,
      signature: signature as Hex,
    });

    if (!valid) {
      return { ok: false, error: "Invalid signature — does not match claimed address" };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "Invalid signature format" };
  }
}
