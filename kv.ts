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
 *
 * NOTE: these claims are cleared by resetBoard() when a new game starts,
 * so a "new game" reset lets previously-claimed emails get a free entry
 * again. They are NOT cleared by admin square-level fixes — only a full
 * board reset touches them.
 */
export async function claimAmoeEmail(board: Board, email: string): Promise<boolean> {
  const key = `amoe:claimed:${board}:${email.toLowerCase().trim()}`;
  const result = await kv.set(key, true, { nx: true });
  return result !== null;
}

// --- Admin: direct square assign/release (e.g. cash payment, stuck hold) ---

export async function adminAssignSquare(board: Board, id: number, name: string): Promise<void> {
  await lockSquare(board, id, "paid", name, "", undefined);
}

export async function adminReleaseSquare(board: Board, id: number): Promise<void> {
  await kv.set(SQUARE_KEY(board, id), { id, status: "open" });
}

// --- Board config: team names, house cut, forward/backward split ---

export interface BoardSettings {
  homeTeam: string;
  awayTeam: string;
  housePct: number; // % of the pot the house keeps before payouts
  forwardPct: number; // of each quarter's net payout, forward winner's share
  payoutSplit: { Q1: number; Q2: number; Q3: number; Q4: number; F: number }; // % of net pool, per quarter
}

const CONFIG_KEY = (board: Board) => `config:${board}`;

const DEFAULT_SETTINGS: BoardSettings = {
  homeTeam: "HOME",
  awayTeam: "AWAY",
  housePct: 20,
  forwardPct: 62.5,
  payoutSplit: { Q1: 25, Q2: 25, Q3: 25, Q4: 25, F: 0 },
};

export async function getBoardSettings(board: Board): Promise<BoardSettings> {
  const stored = await kv.get<BoardSettings>(CONFIG_KEY(board));
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function updateBoardSettings(
  board: Board,
  patch: Partial<BoardSettings>
): Promise<BoardSettings> {
  const current = await getBoardSettings(board);
  const next: BoardSettings = {
    ...current,
    ...patch,
    payoutSplit: { ...current.payoutSplit, ...(patch.payoutSplit ?? {}) },
  };
  await kv.set(CONFIG_KEY(board), next);
  return next;
}

// --- Quarters: scores + computed winners, per board ---

export type QuarterKey = "Q1" | "Q2" | "Q3" | "Q4" | "F";
export const QUARTER_KEYS: QuarterKey[] = ["Q1", "Q2", "Q3", "Q4", "F"];

export interface WinnerResult {
  forward: { rowIdx: number; colIdx: number; name: string };
  backward: { rowIdx: number; colIdx: number; name: string };
}

export interface QuarterState {
  home: string;
  away: string;
  winner: WinnerResult | null;
}

export type QuartersState = Record<QuarterKey, QuarterState>;

const QUARTERS_KEY = (board: Board) => `quarters:${board}`;

const EMPTY_QUARTERS: QuartersState = {
  Q1: { home: "", away: "", winner: null },
  Q2: { home: "", away: "", winner: null },
  Q3: { home: "", away: "", winner: null },
  Q4: { home: "", away: "", winner: null },
  F: { home: "", away: "", winner: null },
};

export async function getQuarters(board: Board): Promise<QuartersState> {
  const stored = await kv.get<QuartersState>(QUARTERS_KEY(board));
  return stored ?? EMPTY_QUARTERS;
}

export async function updateQuarterScore(
  board: Board,
  quarter: QuarterKey,
  side: "home" | "away",
  value: string
): Promise<QuartersState> {
  const current = await getQuarters(board);
  const next: QuartersState = {
    ...current,
    [quarter]: { ...current[quarter], [side]: value.replace(/[^0-9]/g, "") },
  };
  await kv.set(QUARTERS_KEY(board), next);
  return next;
}

/**
 * Computes the forward/backward winning square for a quarter from its
 * scores and the board's drawn digits, then persists the result. Mirrors
 * the scoring rule from the original artifact: the home team's last digit
 * picks the row (forward) or column (backward); the away team's last digit
 * picks the column (forward) or row (backward).
 */
export async function computeAndSaveWinner(
  board: Board,
  quarter: QuarterKey
): Promise<QuartersState> {
  const [digits, squares, quarters] = await Promise.all([
    getDigits(board),
    getAllSquares(board),
    getQuarters(board),
  ]);

  const q = quarters[quarter];
  if (!digits || q.home === "" || q.away === "") {
    return quarters;
  }

  const hDigit = Number(q.home.slice(-1));
  const aDigit = Number(q.away.slice(-1));
  const fwdRow = digits.rows.indexOf(hDigit);
  const fwdCol = digits.cols.indexOf(aDigit);
  const backRow = digits.rows.indexOf(aDigit);
  const backCol = digits.cols.indexOf(hDigit);

  if (fwdRow === -1 || fwdCol === -1 || backRow === -1 || backCol === -1) {
    return quarters;
  }

  const nameAt = (r: number, c: number) => squares[r * 10 + c]?.ownerName || "Unclaimed square";

  const winner: WinnerResult = {
    forward: { rowIdx: fwdRow, colIdx: fwdCol, name: nameAt(fwdRow, fwdCol) },
    backward: { rowIdx: backRow, colIdx: backCol, name: nameAt(backRow, backCol) },
  };

  const next: QuartersState = { ...quarters, [quarter]: { ...q, winner } };
  await kv.set(QUARTERS_KEY(board), next);
  return next;
}

// --- Full board reset (squares, digits, quarters, AMOE claims — keeps settings/pin) ---

export async function resetBoard(board: Board): Promise<void> {
  const keys = Array.from({ length: 100 }, (_, i) => SQUARE_KEY(board, i));
  await Promise.all(keys.map((k) => kv.del(k)));
  await kv.del(DIGITS_KEY(board));
  await kv.del(QUARTERS_KEY(board));

  // Also clear AMOE claims so a "new game" lets the same emails get a
  // free entry again — otherwise anyone who used their free square last
  // game would be locked out of the free-entry form forever.
  const amoeKeys = await kv.keys(`amoe:claimed:${board}:*`);
  if (amoeKeys.length > 0) {
    await kv.del(...amoeKeys);
  }
}

// --- Reset log: audit trail for board resets ---

export interface ResetLogEntry {
  board: Board;
  resetAt: string;
  actor?: string; // whoever/whatever triggered it, if known
}

const RESET_LOG_KEY = (board: Board) => `resetlog:${board}`;
const RESET_LOG_MAX_ENTRIES = 50;

export async function logBoardReset(board: Board, actor?: string): Promise<void> {
  const entry: ResetLogEntry = { board, resetAt: new Date().toISOString(), actor };
  await kv.lpush(RESET_LOG_KEY(board), JSON.stringify(entry));
  await kv.ltrim(RESET_LOG_KEY(board), 0, RESET_LOG_MAX_ENTRIES - 1);
}

export async function getResetLog(board: Board): Promise<ResetLogEntry[]> {
  const raw = await kv.lrange<string>(RESET_LOG_KEY(board), 0, RESET_LOG_MAX_ENTRIES - 1);
  return raw.map((r) => JSON.parse(r) as ResetLogEntry);
}
