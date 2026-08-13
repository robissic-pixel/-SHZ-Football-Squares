import { kv } from "@vercel/kv";

export type EntryType = "paid" | "free";

/**
 * Two independent 100-square pools, each with its own price, its own Whop
 * plan, and its own set of KV keys — so claiming a square, drawing digits,
 * or closing entries on one board never touches the other.
 */
export const BOARDS = ["silver", "gold"] as const;
export type Board = (typeof BOARDS)[number];

export function isBoard(value: unknown): value is Board {
  return typeof value === "string" && (BOARDS as readonly string[]).includes(value);
}

export const BOARD_CONFIG: Record<Board, { label: string; price: number; planEnvVar: string }> = {
  silver: { label: "Silver Board", price: 10, planEnvVar: "WHOP_PLAN_ID_SILVER" },
  gold: { label: "Gold Board", price: 20, planEnvVar: "WHOP_PLAN_ID_GOLD" },
};

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

const SQUARE_KEY = (board: Board, id: number) => `square:${board}:${id}`;
const DIGITS_KEY = (board: Board) => `board:${board}:digits`;
const PENDING_TTL_SECONDS = 10 * 60; // 10 min hold while user is on Whop checkout

export async function getAllSquares(board: Board): Promise<SquareRecord[]> {
  const keys = Array.from({ length: 100 }, (_, i) => SQUARE_KEY(board, i));
  const results = await kv.mget<SquareRecord[]>(...keys);
  return results.map((r, i) => r ?? { id: i, status: "open" });
}

export async function getSquare(board: Board, id: number): Promise<SquareRecord> {
  const rec = await kv.get<SquareRecord>(SQUARE_KEY(board, id));
  return rec ?? { id, status: "open" };
}

/**
 * Atomically place a temporary hold on a square while the buyer completes
 * Whop checkout. Prevents two people from paying for the same square.
 * Returns false if the square is already pending/locked.
 *
 * This is a Redis-side compare-and-set (via EVAL) rather than a
 * check-then-set from application code, so two concurrent requests for the
 * same square can't both pass the "is it open" check before either writes —
 * only one caller can ever win the hold for a given square.
 */
const HOLD_SCRIPT = `
  local cur = redis.call("GET", KEYS[1])
  if cur == false then
    redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
    return 1
  end
  local ok, rec = pcall(cjson.decode, cur)
  if ok and rec.status == "open" then
    redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
    return 1
  end
  return 0
`;

export async function holdSquare(
  board: Board,
  id: number,
  ownerName: string,
  ownerEmail: string
): Promise<boolean> {
  const record: SquareRecord = {
    id,
    status: "pending",
    ownerName,
    ownerEmail,
    pendingExpiresAt: new Date(Date.now() + PENDING_TTL_SECONDS * 1000).toISOString(),
  };
  const result = await kv.eval<[string, number], number>(
    HOLD_SCRIPT,
    [SQUARE_KEY(board, id)],
    [JSON.stringify(record), PENDING_TTL_SECONDS]
  );
  return result === 1;
}

export async function releaseSquare(board: Board, id: number): Promise<void> {
  const existing = await getSquare(board, id);
  if (existing.status === "pending") {
    await kv.set(SQUARE_KEY(board, id), { id, status: "open" });
  }
}

export async function lockSquare(
  board: Board,
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
  await kv.set(SQUARE_KEY(board, id), record);
}

// --- Digit randomization (run once per board, at kickoff, by an admin) ---

export async function getDigits(board: Board): Promise<{ rows: number[]; cols: number[] } | null> {
  return (await kv.get(DIGITS_KEY(board))) ?? null;
}

export async function randomizeDigits(board: Board): Promise<{ rows: number[]; cols: number[] }> {
  const shuffle = (arr: number[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const digits = { rows: shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), cols: shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) };
  await kv.set(DIGITS_KEY(board), digits);
  return digits;
}

// --- Entry-window guard: block new entries once digits are drawn ---

export async function entriesAreOpen(board: Board): Promise<boolean> {
  const digits = await getDigits(board);
  return digits === null;
}

// --- Simple fixed-window rate limiter (per key, e.g. per email) ---

/**
 * Returns true if the caller is under the limit (and counts this call
 * against it), false if they've hit the limit for the current window.
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  const rlKey = `ratelimit:${key}`;
  const count = await kv.incr(rlKey);
  if (count === 1) {
    await kv.expire(rlKey, windowSeconds);
  }
  return count <= maxRequests;
}

// --- AMOE: one free entry per email address, per board ---

/**
 * Reserves the given email for a free entry on the given board. Returns
 * true the first time it's called for a given email+board pair, false on
 * any repeat — so the same person can't submit the free form multiple
 * times to stack extra squares on the same board. (A person CAN still
 * enter both boards once each — silver and gold are independent pools.)
 */
export async function claimAmoeEmail(board: Board, email: string): Promise<boolean> {
  const key = `amoe:claimed:${board}:${email.toLowerCase().trim()}`;
  const result = await kv.set(key, true, { nx: true });
  return result !== null;
}
