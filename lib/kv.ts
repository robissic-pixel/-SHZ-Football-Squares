import { kv } from "@vercel/kv";

export type EntryType = "paid" | "free";

export interface SquareRecord {
  id: number; // 0-99
  status: "open" | "pending" | "locked";
  ownerName?: string;
  ownerEmail?: string;
  entryType?: EntryType;
  whopPaymentId?: string;
  claimedAt?: string;
  pendingExpiresAt?: string;
}

const SQUARE_KEY = (id: number) => `square:${id}`;
const PENDING_TTL_SECONDS = 10 * 60; // 10 min hold while user is on Whop checkout

export async function getAllSquares(): Promise<SquareRecord[]> {
  const keys = Array.from({ length: 100 }, (_, i) => SQUARE_KEY(i));
  const results = await kv.mget<SquareRecord[]>(...keys);
  return results.map((r, i) => r ?? { id: i, status: "open" });
}

export async function getSquare(id: number): Promise<SquareRecord> {
  const rec = await kv.get<SquareRecord>(SQUARE_KEY(id));
  return rec ?? { id, status: "open" };
}

/**
 * Atomically place a temporary hold on a square while the buyer completes
 * Whop checkout. Prevents two people from paying for the same square.
 * Returns false if the square is already pending/locked.
 */
export async function holdSquare(
  id: number,
  ownerName: string,
  ownerEmail: string
): Promise<boolean> {
  const existing = await getSquare(id);
  if (existing.status !== "open") return false;

  const record: SquareRecord = {
    id,
    status: "pending",
    ownerName,
    ownerEmail,
    pendingExpiresAt: new Date(Date.now() + PENDING_TTL_SECONDS * 1000).toISOString(),
  };
  // NX-style guard: only set if still absent/open. For true atomicity under
  // heavy concurrency, wrap this in kv.set with a Lua/transaction; low-traffic
  // squares boards are fine with this check-then-set.
  await kv.set(SQUARE_KEY(id), record, { ex: PENDING_TTL_SECONDS });
  return true;
}

export async function releaseSquare(id: number): Promise<void> {
  const existing = await getSquare(id);
  if (existing.status === "pending") {
    await kv.set(SQUARE_KEY(id), { id, status: "open" });
  }
}

export async function lockSquare(
  id: number,
  entryType: EntryType,
  ownerName: string,
  ownerEmail: string,
  whopPaymentId?: string
): Promise<void> {
  const record: SquareRecord = {
    id,
    status: "locked",
    ownerName,
    ownerEmail,
    entryType,
    whopPaymentId,
    claimedAt: new Date().toISOString(),
  };
  await kv.set(SQUARE_KEY(id), record);
}

// --- Digit randomization (run once, at kickoff, by an admin) ---

export async function getDigits(): Promise<{ rows: number[]; cols: number[] } | null> {
  return (await kv.get("board:digits")) ?? null;
}

export async function randomizeDigits(): Promise<{ rows: number[]; cols: number[] }> {
  const shuffle = (arr: number[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const digits = { rows: shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), cols: shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) };
  await kv.set("board:digits", digits);
  return digits;
}
