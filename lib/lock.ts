import crypto from "crypto";
import { requireEnv } from "./env";

/**
 * Front-door number-combo lock. This is a soft gate to keep the board's
 * squares/prices/rules private to people who were actually given the
 * combo (e.g. shared in a group chat) — it is NOT a substitute for the
 * real payment/identity checks that still happen later at Whop checkout.
 * Treat it like a "members only" door code, not a security boundary
 * around money.
 */

const COOKIE_NAME = "shz_unlocked";
const SESSION_HOURS = 9;

export function getLockCombo(): number[] {
  const raw = requireEnv("LOCK_COMBO"); // e.g. "15,76,89,34,56,23"
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n));
}

function sign(payload: string): string {
  const secret = requireEnv("LOCK_SECRET");
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/** Builds a signed, expiring cookie value proving the combo was solved. */
export function createUnlockToken(): { name: string; value: string; maxAgeSeconds: number } {
  const expiresAt = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const payload = `unlocked:${expiresAt}`;
  const signature = sign(payload);
  return { name: COOKIE_NAME, value: `${expiresAt}.${signature}`, maxAgeSeconds: SESSION_HOURS * 60 * 60 };
}

export function verifyUnlockToken(cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  const [expiresAtStr, signature] = cookieValue.split(".");
  const expiresAt = Number(expiresAtStr);
  if (!expiresAt || !signature || Date.now() > expiresAt) return false;

  const expected = sign(`unlocked:${expiresAt}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function sequenceMatches(submitted: unknown): boolean {
  const combo = getLockCombo();
  if (!Array.isArray(submitted) || submitted.length !== combo.length) return false;
  return submitted.every((n, i) => Number(n) === combo[i]);
}

export { COOKIE_NAME };
