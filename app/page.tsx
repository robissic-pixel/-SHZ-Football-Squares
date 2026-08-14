"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ============================================================================
// SWINEHEADZ SQUARES — two independent boards (Silver $10 / Gold $20)
// Talks to the real backend (Redis-backed API routes + Whop checkout),
// but keeps the visual design and admin tooling from the original mockup.
// ============================================================================

type BoardKey = "silver" | "gold";
type QuarterKey = "Q1" | "Q2" | "Q3" | "Q4" | "F";
const QUARTER_KEYS: QuarterKey[] = ["Q1", "Q2", "Q3", "Q4", "F"];
const GRID = 10;
const POLL_MS = 5000;

interface Square {
  id: number;
  status: "open" | "pending" | "locked";
  ownerName?: string;
  pendingExpiresAt?: string;
}
interface Digits {
  rows: number[];
  cols: number[];
}
interface Settings {
  homeTeam: string;
  awayTeam: string;
  housePct: number;
  forwardPct: number;
  payoutSplit: Record<QuarterKey, number>;
}
interface WinnerResult {
  forward: { rowIdx: number; colIdx: number; name: string };
  backward: { rowIdx: number; colIdx: number; name: string };
}
interface QuarterState {
  home: string;
  away: string;
  winner: WinnerResult | null;
}
type Quarters = Record<QuarterKey, QuarterState>;

const BOARD_META: Record<BoardKey, { label: string; price: number }> = {
  silver: { label: "Silver Board", price: 10 },
  gold: { label: "Gold Board", price: 20 },
};

const THEMES = {
  silver: {
    bgDark: "#191C20",
    bg: "#2A2E34",
    accent: "#C6CCD4",
    accentSoft: "rgba(198,204,212,0.18)",
    accentSoftBorder: "rgba(198,204,212,0.5)",
    accentSofter: "rgba(198,204,212,0.05)",
    panel: "#ECEDEF",
    panelInput: "#FBFBFC",
    panelBorder: "#CDD1D7",
    muted: "#5C6169",
    chalk: "#E4E7EA",
    chalkDim: "#A9B2BC",
    danger: "#B23A2E",
    ink: "#15171A",
    pendingAccent: "#7A8797",
    pendingSoft: "rgba(122,135,151,0.18)",
    mineSoft: "rgba(198,204,212,0.42)",
    winnerForwardText: "#fff",
    winnerForwardBorder: "#FFD8CF",
    winnerBackwardText: "#15171A",
    winnerBackwardBorder: "#F4F6F8",
  },
  gold: {
    bgDark: "#0B211B",
    bg: "#12332A",
    accent: "#D9A63E",
    accentSoft: "rgba(217,166,62,0.18)",
    accentSoftBorder: "rgba(217,166,62,0.5)",
    accentSofter: "rgba(217,166,62,0.04)",
    panel: "#F3EEDF",
    panelInput: "#FFFDF7",
    panelBorder: "#D8CFB4",
    muted: "#6B6350",
    chalk: "#EFE7D2",
    chalkDim: "#B9C9BE",
    danger: "#B23A2E",
    ink: "#141310",
    pendingAccent: "#C97A2B",
    pendingSoft: "rgba(201,122,43,0.16)",
    mineSoft: "rgba(217,166,62,0.42)",
    winnerForwardText: "#fff",
    winnerForwardBorder: "#FFD8CF",
    winnerBackwardText: "#141310",
    winnerBackwardBorder: "#FFE9BC",
  },
} as const;
type Theme = (typeof THEMES)[BoardKey];

function pageTurfBackground(theme: Theme) {
  return `
    repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 2px, transparent 2px, transparent 70px),
    repeating-linear-gradient(180deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 5px, transparent 5px, transparent 130px),
    radial-gradient(ellipse 900px 500px at 50% 0%, ${theme.accentSofter} 0%, transparent 65%),
    linear-gradient(180deg, #1C4328 0%, #143723 40%, #0F2C1B 75%, #0A2014 100%)
  `;
}

function formatMoney(n: number) {
  return "$" + Number(n || 0).toFixed(2).replace(/\.00$/, "");
}
function qLabel(k: QuarterKey) {
  return k === "F" ? "Final" : k;
}
function initials(name: string) {
  return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
function timeUntil(iso?: string) {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expiring";
  const mins = Math.ceil(ms / 60000);
  return `${mins} min left`;
}
function getWinnerHighlight(quarters: Quarters, r: number, c: number): "forward" | "backward" | null {
  for (const qKey of QUARTER_KEYS) {
    const w = quarters[qKey]?.winner;
    if (!w) continue;
    if (w.forward.rowIdx === r && w.forward.colIdx === c) return "forward";
    if (w.backward.rowIdx === r && w.backward.colIdx === c) return "backward";
  }
  return null;
}

// ============================================================================
// HogPlayer — decorative flat-illustration hog football player.
// ============================================================================

function hogCornerStyle(corner: "bl" | "tr" | "br"): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "absolute",
    width: 92,
    height: 115,
    opacity: 0.3,
    pointerEvents: "none",
    zIndex: 0,
    filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.35))",
  };
  switch (corner) {
    case "bl":
      return { ...base, left: -8, bottom: -4 };
    case "tr":
      return { ...base, right: -4, top: 2, width: 84, height: 104, transform: "scaleX(-1)" };
    case "br":
      return { ...base, right: 6, bottom: -6, width: 76, height: 96 };
  }
}

function HogPlayer({ theme, corner, pose }: { theme: Theme; corner: "bl" | "tr" | "br"; pose: "run" | "block" | "reach" }) {
  const poses = {
    run: { legBack: -20, legFront: 24, armBack: -28, armFront: 34, tilt: -8 },
    block: { legBack: -32, legFront: 32, armBack: -42, armFront: 42, tilt: 0 },
    reach: { legBack: -10, legFront: 14, armBack: 8, armFront: 62, tilt: -14 },
  };
  const d = poses[pose];
  const jersey = theme.accent;
  const ink = theme.ink;
  const snout = "#C98A5E";
  const ball = "#7A4A25";
  const tusk = "#F4F0E6";

  return (
    <div style={hogCornerStyle(corner)} aria-hidden="true">
      <svg viewBox="0 0 120 150" width="100%" height="100%">
        <g transform={`rotate(${d.tilt} 60 80)`}>
          <rect x="52" y="95" width="14" height="40" rx="6" fill={ink} transform={`rotate(${d.legBack} 59 95)`} />
          <rect x="54" y="95" width="14" height="40" rx="6" fill={ink} transform={`rotate(${d.legFront} 61 95)`} />
          <rect x="38" y="55" width="44" height="46" rx="14" fill={jersey} stroke={ink} strokeWidth="3" />
          <rect x="30" y="58" width="12" height="34" rx="6" fill={jersey} stroke={ink} strokeWidth="2" transform={`rotate(${d.armBack} 36 60)`} />
          <rect x="78" y="58" width="12" height="34" rx="6" fill={jersey} stroke={ink} strokeWidth="2" transform={`rotate(${d.armFront} 84 60)`} />
          <ellipse
            cx="92"
            cy={pose === "reach" ? 20 : 88}
            rx="9"
            ry="6"
            fill={ball}
            stroke={ink}
            strokeWidth="1.5"
            transform={pose === "reach" ? "rotate(-30 92 20)" : "rotate(20 92 88)"}
          />
          <circle cx="60" cy="38" r="22" fill={ink} />
          <circle cx="60" cy="40" r="15" fill={jersey} opacity="0.15" />
          <ellipse cx="60" cy="46" rx="10" ry="7" fill={snout} stroke={ink} strokeWidth="2" />
          <circle cx="56" cy="46" r="1.6" fill={ink} />
          <circle cx="64" cy="46" r="1.6" fill={ink} />
          <path d="M50 50 L46 56 L52 54 Z" fill={tusk} />
          <path d="M70 50 L74 56 L68 54 Z" fill={tusk} />
          <path d="M42 24 L34 14 L46 20 Z" fill={ink} />
          <path d="M78 24 L86 14 L74 20 Z" fill={ink} />
          <path d="M48 42 Q60 52 72 42" stroke={theme.danger} strokeWidth="3" fill="none" />
        </g>
      </svg>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
function shuffledDigits() {
  const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ============================================================================
// BoardPanel — everything for one board (silver or gold)
// ============================================================================

function BoardPanel({ boardKey, theme }: { boardKey: BoardKey; theme: Theme }) {
  const styles = useMemo(() => getStyles(theme), [theme]);
  const meta = BOARD_META[boardKey];

  const [squares, setSquares] = useState<Square[]>([]);
  const [digits, setDigits] = useState<Digits | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [quarters, setQuarters] = useState<Quarters | null>(null);
  const [loading, setLoading] = useState(true);

  const [myName, setMyName] = useState("");
  const [myEmail, setMyEmail] = useState("");
  const [myAddress, setMyAddress] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<"paid" | "free" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [revealCell, setRevealCell] = useState<string | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [secretInput, setSecretInput] = useState("");
  const [secretError, setSecretError] = useState("");
  const [adminSecret, setAdminSecret] = useState("");

  const [teamDraft, setTeamDraft] = useState({ home: "", away: "" });
  const [flipping, setFlipping] = useState(false);
  const [flipRow, setFlipRow] = useState<number[] | null>(null);
  const [flipCol, setFlipCol] = useState<number[] | null>(null);
  const [confirmingRedraw, setConfirmingRedraw] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  const load = useCallback(
    async (silent?: boolean) => {
      try {
        if (!silent) setLoading(true);
        const headers: HeadersInit = adminSecret ? { "x-admin-secret": adminSecret } : {};
        const res = await fetch(`/api/squares?board=${boardKey}`, { headers });
        const data = await res.json();
        setSquares(data.squares);
        setDigits(data.digits);
        setSettings(data.settings);
        setQuarters(data.quarters);
      } catch {
        // transient — next poll will retry
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [boardKey, adminSecret]
  );

  useEffect(() => {
    setSelected(null);
    setMode(null);
    setError(null);
    load();
    const interval = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey, adminSecret]);

  useEffect(() => {
    if (settings) setTeamDraft({ home: settings.homeTeam, away: settings.awayTeam });
  }, [settings?.homeTeam, settings?.awayTeam]);

  const adminFetch = async (url: string, body: any) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": adminSecret },
      body: JSON.stringify({ board: boardKey, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  };

  const [verifyingPin, setVerifyingPin] = useState(false);

  const submitPin = async () => {
    const candidate = secretInput;
    setVerifyingPin(true);
    setSecretError("");
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "x-admin-secret": candidate },
      });
      if (!res.ok) {
        setSecretError("Incorrect admin secret.");
        setVerifyingPin(false);
        return;
      }
      setAdminSecret(candidate);
      setIsAdmin(true);
      setShowPinModal(false);
      setSecretInput("");
      setSecretError("");
      showToast("Admin unlocked.");
    } catch {
      setSecretError("Could not verify right now — check your connection and try again.");
    } finally {
      setVerifyingPin(false);
    }
  };

  const cellKey = (r: number, c: number) => `${r}-${c}`;

  const reserveSquare = async (r: number, c: number) => {
    if (!myName.trim() || !myEmail.trim()) {
      showToast("Enter your name and email first (top of page) before picking a square.");
      return;
    }
    if (digits) {
      showToast("Numbers are already drawn — board is locked.");
      return;
    }
    const id = r * GRID + c;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: boardKey, squareId: id, name: myName.trim(), email: myEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        setBusy(false);
        return;
      }
      window.location.href = data.purchaseUrl;
    } catch (e) {
      setError("Could not start checkout. Please try again.");
      setBusy(false);
    }
  };

  const submitFree = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/amoe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: boardKey, name: myName.trim(), email: myEmail.trim(), mailingAddress: myAddress.trim() }),
      });
      const data = await res.json();
      setBusy(false);
      if (!res.ok) {
        setError(data.error);
        return;
      }
      setMode(null);
      setSelected(null);
      load();
      showToast(`You've been entered on the ${meta.label}! Your square: #${data.squareId + 1}`);
    } catch {
      setBusy(false);
      setError("Could not submit entry. Please try again.");
    }
  };

  const adminClaimDirect = async (r: number, c: number) => {
    const name = window.prompt("Name to assign this square to (e.g. paid by cash):", "");
    if (!name || !name.trim()) return;
    try {
      await adminFetch("/api/admin/square", { squareId: r * GRID + c, action: "assign", name: name.trim() });
      showToast(`Square assigned to ${name.trim()}.`);
      load();
    } catch (e: any) {
      showToast(e.message || "Failed to assign square.");
    }
  };

  const adminReleaseConfirmed = async (r: number, c: number) => {
    try {
      await adminFetch("/api/admin/square", { squareId: r * GRID + c, action: "release" });
      showToast("Square released.");
      load();
    } catch (e: any) {
      showToast(e.message || "Failed to release square.");
    }
  };

  const handleCellTap = (r: number, c: number) => {
    const key = cellKey(r, c);
    const sq = squares[r * GRID + c];
    if (!sq) return;

    if (sq.status === "locked") {
      if (revealCell === key) {
        if (isAdmin) adminReleaseConfirmed(r, c);
        else showToast(`Claimed by ${sq.ownerName}.`);
        setRevealCell(null);
        return;
      }
      setRevealCell(key);
      setTimeout(() => setRevealCell((cur) => (cur === key ? null : cur)), 2600);
      return;
    }

    if (sq.status === "pending") {
      if (revealCell === key) {
        showToast(
          isAdmin
            ? `Pending checkout${sq.ownerName ? ` from ${sq.ownerName}` : ""} — ${timeUntil(sq.pendingExpiresAt)}.`
            : "Someone is currently checking out for this square."
        );
        setRevealCell(null);
        return;
      }
      setRevealCell(key);
      setTimeout(() => setRevealCell((cur) => (cur === key ? null : cur)), 2600);
      return;
    }

    // open
    if (isAdmin) adminClaimDirect(r, c);
    else {
      setSelected(r * GRID + c);
      setMode("paid");
      setError(null);
    }
  };

  const drawNumbers = async () => {
    if (digits && !confirmingRedraw) {
      setConfirmingRedraw(true);
      return;
    }
    setConfirmingRedraw(false);
    setFlipping(true);
    for (let i = 0; i < 8; i++) {
      setFlipRow(shuffledDigits());
      setFlipCol(shuffledDigits());
      await sleep(70);
    }
    try {
      await adminFetch("/api/admin/randomize", {});
      showToast("Numbers drawn! Board is locked.");
    } catch (e: any) {
      showToast(e.message || "Failed to draw numbers (already drawn?).");
    }
    setFlipping(false);
    load();
  };

  const saveTeams = async () => {
    try {
      await adminFetch("/api/admin/config", { homeTeam: teamDraft.home || "HOME", awayTeam: teamDraft.away || "AWAY" });
      showToast("Team names updated.");
      load();
    } catch (e: any) {
      showToast(e.message || "Failed to update teams.");
    }
  };

  const updateHousePct = async (value: string) => {
    const n = Number(value.replace(/[^0-9.]/g, "")) || 0;
    setSettings((s) => (s ? { ...s, housePct: n } : s));
    try {
      await adminFetch("/api/admin/config", { housePct: n });
    } catch (e: any) {
      showToast(e.message || "Failed to update house cut.");
    }
  };

  const updateForwardPct = async (value: string) => {
    const n = Number(value.replace(/[^0-9.]/g, "")) || 0;
    setSettings((s) => (s ? { ...s, forwardPct: n } : s));
    try {
      await adminFetch("/api/admin/config", { forwardPct: n });
    } catch (e: any) {
      showToast(e.message || "Failed to update split.");
    }
  };

  const updatePayoutSplit = async (qKey: QuarterKey, value: string) => {
    const n = Number(value.replace(/[^0-9]/g, "")) || 0;
    setSettings((s) => (s ? { ...s, payoutSplit: { ...s.payoutSplit, [qKey]: n } } : s));
    try {
      await adminFetch("/api/admin/config", { payoutSplit: { [qKey]: n } });
    } catch (e: any) {
      showToast(e.message || "Failed to update payout split.");
    }
  };

  const updateScore = async (qKey: QuarterKey, side: "home" | "away", value: string) => {
    const cleaned = value.replace(/[^0-9]/g, "");
    setQuarters((q) => (q ? { ...q, [qKey]: { ...q[qKey], [side]: cleaned } } : q));
    try {
      await adminFetch("/api/admin/score", { quarter: qKey, side, value: cleaned });
    } catch (e: any) {
      showToast(e.message || "Failed to save score.");
    }
  };

  const computeWinner = async (qKey: QuarterKey) => {
    try {
      await adminFetch("/api/admin/score", { quarter: qKey, computeWinner: true });
      showToast(`${qLabel(qKey)} winner computed.`);
      load();
    } catch (e: any) {
      showToast(e.message || "Draw numbers and enter both scores first.");
    }
  };

  const doResetBoard = async () => {
    if (!confirmingReset) {
      setConfirmingReset(true);
      return;
    }
    setConfirmingReset(false);
    try {
      await adminFetch("/api/admin/reset", {});
      showToast("Board reset.");
      load();
    } catch (e: any) {
      showToast(e.message || "Failed to reset board.");
    }
  };

  if (loading || !settings || !quarters) {
    return (
      <div style={styles.loadingWrap}>
        <div style={styles.loadingCard}>
          <div style={styles.loadingDot} />
          <span style={{ fontFamily: "'Space Mono', monospace" }}>Loading the board…</span>
        </div>
      </div>
    );
  }

  const drawn = !!digits;
  const claimedCount = squares.filter((s) => s.status === "locked").length;
  const pendingSquares = squares.filter((s) => s.status === "pending");
  const pot = claimedCount * meta.price;
  const houseCut = pot * (settings.housePct / 100);
  const netPool = pot - houseCut;
  const payoutTotalPct = Object.values(settings.payoutSplit).reduce((a, b) => a + b, 0);
  const quarterAmount = (qKey: QuarterKey) => (netPool * (settings.payoutSplit[qKey] || 0)) / 100;
  const forwardAmount = (qKey: QuarterKey) => (quarterAmount(qKey) * settings.forwardPct) / 100;
  const backwardAmount = (qKey: QuarterKey) => (quarterAmount(qKey) * (100 - settings.forwardPct)) / 100;

  return (
    <div style={styles.boardOuter}>
      {toast && <div style={styles.toast}>{toast}</div>}

      {showPinModal && (
        <div style={styles.modalOverlay} onClick={() => setShowPinModal(false)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.panelLabel}>Admin secret</div>
            <input
              style={styles.input}
              type="password"
              placeholder="ADMIN_SECRET"
              value={secretInput}
              autoFocus
              onChange={(e) => {
                setSecretInput(e.target.value);
                setSecretError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && !verifyingPin && submitPin()}
            />
            {secretError && <div style={styles.errorBox}>{secretError}</div>}
            <button style={{ ...styles.primaryBtn, marginTop: 12, opacity: verifyingPin ? 0.6 : 1 }} onClick={submitPin} disabled={verifyingPin}>
              {verifyingPin ? "Checking…" : "Unlock"}
            </button>
            <button
              style={{ ...styles.ghostBtn, marginTop: 8 }}
              onClick={() => {
                setShowPinModal(false);
                setSecretInput("");
                setSecretError("");
              }}
            >
              Cancel
            </button>
            <div style={styles.hint}>
              This is the same ADMIN_SECRET set in Vercel env vars — shared across both boards.
            </div>
          </div>
        </div>
      )}

      <div style={styles.viewToggleRow}>
        {isAdmin ? (
          <>
            <span style={styles.adminBadge}>ADMIN · {meta.label.toUpperCase()}</span>
            <button style={styles.linkBtn} onClick={() => setIsAdmin(false)}>
              View as player
            </button>
          </>
        ) : (
          <button style={styles.linkBtn} onClick={() => setShowPinModal(true)}>
            Admin login
          </button>
        )}
      </div>

      {/* Setup / info panel */}
      <section style={styles.panel}>
        {!isAdmin && (
          <>
            <div style={styles.panelLabel}>Your info</div>
            <input
              style={styles.input}
              placeholder="Name"
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              maxLength={40}
            />
            <input
              style={{ ...styles.input, marginTop: 8 }}
              placeholder="Email"
              value={myEmail}
              onChange={(e) => setMyEmail(e.target.value)}
              maxLength={80}
            />
            <div style={styles.hint}>
              {settings.homeTeam} vs {settings.awayTeam} · {formatMoney(meta.price)} per square
            </div>
          </>
        )}

        {isAdmin && (
          <>
            <div style={styles.panelLabel}>Teams</div>
            <div style={styles.teamRow}>
              <input
                style={{ ...styles.input, marginBottom: 8 }}
                placeholder="Home team"
                value={teamDraft.home}
                onChange={(e) => setTeamDraft((t) => ({ ...t, home: e.target.value }))}
                maxLength={16}
              />
              <input
                style={styles.input}
                placeholder="Away team"
                value={teamDraft.away}
                onChange={(e) => setTeamDraft((t) => ({ ...t, away: e.target.value }))}
                maxLength={16}
              />
            </div>
            <button style={styles.ghostBtn} onClick={saveTeams}>
              Save team names
            </button>

            <div style={styles.divider} />

            <div style={styles.hint}>
              Price is fixed at {formatMoney(meta.price)}/square via the Whop plan for this board
              (change the plan in Whop to adjust price).
            </div>

            <div style={styles.panelLabel}>House cut</div>
            <div style={styles.priceRow}>
              <input style={styles.input} inputMode="decimal" value={settings.housePct} onChange={(e) => updateHousePct(e.target.value)} />
              <span style={styles.priceSign}>%</span>
            </div>

            <div style={styles.potLine}>
              {claimedCount} squares confirmed ({pendingSquares.length} pending) · pot is <strong>{formatMoney(pot)}</strong>
              <br />
              house keeps <strong>{formatMoney(houseCut)}</strong> · net pool is <strong>{formatMoney(netPool)}</strong>
            </div>

            <div style={styles.panelLabel}>Forward / backward split</div>
            <div style={styles.priceRow}>
              <input style={styles.input} inputMode="decimal" value={settings.forwardPct} onChange={(e) => updateForwardPct(e.target.value)} />
              <span style={styles.priceSign}>%</span>
            </div>
            <div style={styles.hint}>
              Forward gets {settings.forwardPct}% of each quarter's payout, backward gets the remaining{" "}
              {(100 - settings.forwardPct).toFixed(1).replace(/\.0$/, "")}%.
            </div>

            <div style={styles.panelLabel}>Payout split by quarter</div>
            {QUARTER_KEYS.map((qKey) => (
              <div key={qKey} style={styles.payoutBlock}>
                <div style={styles.payoutRow}>
                  <span style={styles.payoutLabel}>{qLabel(qKey)}</span>
                  <input
                    style={styles.payoutInput}
                    inputMode="numeric"
                    value={settings.payoutSplit[qKey]}
                    onChange={(e) => updatePayoutSplit(qKey, e.target.value)}
                  />
                  <span style={styles.payoutPct}>% of net</span>
                  <span style={styles.payoutAmount}>{formatMoney(quarterAmount(qKey))}</span>
                </div>
                <div style={styles.payoutSubRow}>
                  <span>↳ forward {formatMoney(forwardAmount(qKey))}</span>
                  <span>↳ backward {formatMoney(backwardAmount(qKey))}</span>
                </div>
              </div>
            ))}
            <div style={{ ...styles.hint, color: payoutTotalPct === 100 ? theme.muted : theme.danger }}>
              {payoutTotalPct === 100 ? "Splits add up to 100% of the net pool." : `Splits add up to ${payoutTotalPct}% — should total 100%.`}
            </div>

            <div style={styles.divider} />

            <button style={{ ...styles.primaryBtn, opacity: flipping ? 0.6 : 1 }} onClick={drawNumbers} disabled={flipping}>
              {flipping ? "Drawing…" : confirmingRedraw ? "Tap again to confirm redraw" : drawn ? "Already drawn" : "Draw numbers"}
            </button>
            {confirmingRedraw && (
              <button style={{ ...styles.ghostBtn, marginTop: 6 }} onClick={() => setConfirmingRedraw(false)}>
                Cancel
              </button>
            )}
            <div style={styles.hint}>
              {drawn
                ? "Numbers are locked in — entries are closed for this board. Redraw isn't supported from here; delete the board's digits key in KV to redo (testing only)."
                : "Confirm squares first, then draw to lock the board and assign digits 0–9."}
            </div>

            <div style={styles.divider} />

            <button style={styles.dangerBtn} onClick={doResetBoard}>
              {confirmingReset ? "Tap again to confirm reset" : "Reset this board (squares, digits, quarters)"}
            </button>
            {confirmingReset && (
              <button style={{ ...styles.ghostBtn, marginTop: 6 }} onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
            )}
          </>
        )}

        {!isAdmin && (
          <div style={styles.potLine}>
            {claimedCount} squares claimed · pot is <strong>{formatMoney(pot)}</strong>
          </div>
        )}
      </section>

      {/* Board — styled as a football field */}
      <section style={styles.boardWrap}>
        <div style={styles.turfField}>
          <div style={styles.headerPillWrap}>
            <div style={styles.headerPill}>
              <img src="/mascot.webp" alt="" style={styles.headerPillMascot} />
              <span style={styles.headerPillWordmark}>SWINEHEADZ</span>
              <span style={styles.headerPillTag}>{meta.label.toUpperCase()}</span>
            </div>
          </div>

          <HogPlayer theme={theme} corner="bl" pose="run" />
          <HogPlayer theme={theme} corner="tr" pose="block" />
          <HogPlayer theme={theme} corner="br" pose="reach" />

          <div style={styles.yardRail("left")} aria-hidden="true">
            {["GOAL", "10", "20", "30", "40", "50", "40", "30", "20", "10", "GOAL"].map((v, i) => (
              <span key={i} style={styles.yardRailLabel}>
                {v}
              </span>
            ))}
          </div>
          <div style={styles.yardRail("right")} aria-hidden="true">
            {["GOAL", "10", "20", "30", "40", "50", "40", "30", "20", "10", "GOAL"].map((v, i) => (
              <span key={i} style={styles.yardRailLabel}>
                {v}
              </span>
            ))}
          </div>

          <div style={styles.boardScroll}>
            <div style={styles.axisAwayLabel}>{settings.awayTeam} →</div>
            <div style={styles.boardGridOuter}>
              <div style={styles.axisHomeLabel}>
                <span>{settings.homeTeam} ↓</span>
              </div>
              <div style={styles.gridPlate}>
                <div style={styles.headerRow}>
                  <div style={styles.cornerCell} />
                  {Array.from({ length: GRID }).map((_, c) => (
                    <div key={c} style={styles.numCell}>
                      {flipping ? (flipCol ? flipCol[c] : "–") : digits ? digits.cols[c] : "–"}
                    </div>
                  ))}
                </div>
                {Array.from({ length: GRID }).map((_, r) => (
                  <div key={r} style={styles.bodyRow}>
                    <div style={styles.numCell}>{flipping ? (flipRow ? flipRow[r] : "–") : digits ? digits.rows[r] : "–"}</div>
                    {Array.from({ length: GRID }).map((_, c) => {
                      const id = r * GRID + c;
                      const sq = squares[id];
                      const key = cellKey(r, c);
                      const isRevealed = revealCell === key;
                      const isMine = sq?.status === "locked" && myName.trim() && sq.ownerName === myName.trim();
                      let cellStyle: React.CSSProperties = { ...styles.cell };
                      if (sq?.status === "locked") {
                        cellStyle = { ...cellStyle, ...styles.cellFilled };
                        if (isMine) cellStyle = { ...cellStyle, ...styles.cellMine };
                      } else if (sq?.status === "pending") {
                        cellStyle = { ...cellStyle, ...styles.cellPending };
                      }
                      const win = quarters ? getWinnerHighlight(quarters, r, c) : null;
                      if (win === "forward") cellStyle = { ...cellStyle, ...styles.cellWinnerForward };
                      if (win === "backward") cellStyle = { ...cellStyle, ...styles.cellWinnerBackward };
                      if (isRevealed) cellStyle = { ...cellStyle, ...styles.cellRevealed };

                      return (
                        <div key={c} style={styles.cellSlot}>
                          {isRevealed && (
                            <div style={styles.revealBubble}>
                              <span style={styles.revealName}>{sq?.ownerName || (sq?.status === "pending" ? "Pending…" : "")}</span>
                              <span style={styles.revealHint}>
                                {sq?.status === "locked"
                                  ? isAdmin
                                    ? "tap again to release"
                                    : "confirmed"
                                  : sq?.status === "pending"
                                  ? isAdmin
                                    ? "tap again for details"
                                    : "checkout in progress"
                                  : ""}
                              </span>
                            </div>
                          )}
                          <button
                            style={cellStyle}
                            onClick={() => handleCellTap(r, c)}
                            title={sq?.status === "locked" ? sq.ownerName : sq?.status === "pending" ? "Pending checkout" : "Open square"}
                          >
                            <span style={styles.cellNumber}>{id + 1}</span>
                            {sq?.status === "locked" && sq.ownerName ? (
                              <span style={styles.cellName}>{sq.ownerName.length > 9 ? initials(sq.ownerName) : sq.ownerName}</span>
                            ) : sq?.status === "pending" ? (
                              "…"
                            ) : (
                              ""
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={styles.endzoneBottomText}>
            <span style={styles.endzoneBottomLabel}>GOAL</span>
            <span style={styles.endzoneBottomWordmark}>NETWORK</span>
            <span style={styles.endzoneBottomTag}>EST. GAME DAY</span>
            <span style={styles.endzoneBottomLabel}>GOAL</span>
          </div>
        </div>

        <div style={styles.legendRow}>
          <span style={styles.legendItem}>
            <span style={{ ...styles.legendSwatch, ...styles.cellFilled }} /> Confirmed
          </span>
          <span style={styles.legendItem}>
            <span style={{ ...styles.legendSwatch, ...styles.cellPending }} /> Pending payment
          </span>
          <span style={styles.legendItem}>
            <span style={{ ...styles.legendSwatch, ...styles.cellMine }} /> Yours
          </span>
        </div>
      </section>

      {/* Player entry panel */}
      {!isAdmin && (
        <section style={styles.panel}>
          {mode === "paid" && selected !== null && (
            <>
              <div style={styles.panelLabel}>
                Claim square #{selected + 1} — {formatMoney(meta.price)}
              </div>
              <button style={{ ...styles.primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy || !myName || !myEmail} onClick={() => reserveSquare(Math.floor(selected / GRID), selected % GRID)}>
                {busy ? "Loading…" : "Pay with Whop"}
              </button>
              <div style={styles.divider} />
            </>
          )}
          <div style={styles.panelLabel}>Free entry (no purchase necessary)</div>
          <p style={styles.hint}>
            You'll be randomly assigned an open square on the {meta.label} with the same odds as a paid entry.
          </p>
          <input style={styles.input} placeholder="Mailing address" value={myAddress} onChange={(e) => setMyAddress(e.target.value)} />
          <button
            style={{ ...styles.ghostBtn, marginTop: 8 }}
            disabled={busy || !myName || !myEmail || !myAddress}
            onClick={submitFree}
          >
            {busy ? "Submitting…" : "Enter free"}
          </button>
          {error && <div style={styles.errorBox}>{error}</div>}
        </section>
      )}

      {/* Pending queue (admin only) */}
      {isAdmin && (
        <section style={styles.panel}>
          <div style={styles.panelLabel}>Pending checkouts ({pendingSquares.length})</div>
          {pendingSquares.length === 0 ? (
            <div style={styles.hint}>No checkouts in progress right now.</div>
          ) : (
            pendingSquares.map((sq) => (
              <div key={sq.id} style={styles.queueRow}>
                <span style={styles.queueSquare}>#{sq.id + 1}</span>
                <span style={styles.queueName}>{sq.ownerName || "—"}</span>
                <span style={styles.queueTime}>{timeUntil(sq.pendingExpiresAt)}</span>
                <button style={styles.smallGhostBtn} onClick={() => adminReleaseConfirmed(Math.floor(sq.id / GRID), sq.id % GRID)}>
                  Release
                </button>
              </div>
            ))
          )}
          <div style={styles.hint}>
            Whop's webhook confirms payment and locks the square automatically — you only need
            Release here for a stuck or abandoned checkout. Holds auto-expire after 10 minutes on
            their own either way.
          </div>
        </section>
      )}

      {/* Scores + winners */}
      <section style={styles.panel}>
        {isAdmin ? (
          <>
            <div style={styles.panelLabel}>Quarter scores</div>
            {QUARTER_KEYS.map((qKey) => {
              const q = quarters[qKey];
              return (
                <div key={qKey} style={styles.scoreRow}>
                  <div style={styles.scoreLabel}>{qLabel(qKey)}</div>
                  <input
                    style={styles.scoreInput}
                    inputMode="numeric"
                    placeholder={settings.homeTeam.slice(0, 3).toUpperCase()}
                    value={q.home}
                    onChange={(e) => updateScore(qKey, "home", e.target.value)}
                  />
                  <input
                    style={styles.scoreInput}
                    inputMode="numeric"
                    placeholder={settings.awayTeam.slice(0, 3).toUpperCase()}
                    value={q.away}
                    onChange={(e) => updateScore(qKey, "away", e.target.value)}
                  />
                  <button style={styles.smallBtn} onClick={() => computeWinner(qKey)}>
                    Set
                  </button>
                </div>
              );
            })}
            <div style={styles.divider} />
          </>
        ) : (
          <div style={styles.panelLabel}>
            {settings.homeTeam} vs {settings.awayTeam} — Winners
          </div>
        )}

        {isAdmin && <div style={styles.panelLabel}>Winners</div>}
        {QUARTER_KEYS.every((k) => !quarters[k].winner) ? (
          <div style={styles.hint}>No winners yet.</div>
        ) : (
          QUARTER_KEYS.map((qKey) => {
            const q = quarters[qKey];
            if (!q.winner) return null;
            return (
              <div key={qKey} style={styles.winnerBlock}>
                <div style={styles.winnerRow}>
                  <span style={styles.winnerQ}>{qLabel(qKey)} fwd</span>
                  <span style={styles.winnerName}>{q.winner.forward.name}</span>
                  <span style={styles.winnerPayout}>{formatMoney(forwardAmount(qKey))}</span>
                </div>
                <div style={styles.winnerRow}>
                  <span style={styles.winnerQ}>{qLabel(qKey)} back</span>
                  <span style={styles.winnerName}>{q.winner.backward.name}</span>
                  <span style={styles.winnerPayout}>{formatMoney(backwardAmount(qKey))}</span>
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

// ============================================================================
// App shell — logo, brand header, tab switcher, yard ticker
// ============================================================================

export default function SwineheadzSquaresApp() {
  const [activeKey, setActiveKey] = useState<BoardKey>("silver");
  const theme = THEMES[activeKey];

  return (
    <div style={{ ...outerStyles.page, background: pageTurfBackground(theme) }}>
      <style>{fontImport + keyframes}</style>

      <div style={outerStyles.cornerTabRow}>
        {(Object.keys(BOARD_META) as BoardKey[]).map((key) => {
          const t = THEMES[key];
          const active = key === activeKey;
          const m = BOARD_META[key];
          return (
            <button key={key} onClick={() => setActiveKey(key)} style={outerStyles.cornerTab(t, active)}>
              <span style={outerStyles.cornerTabLabel}>{m.label}</span>
              <span style={outerStyles.cornerTabSub}>${m.price} / square</span>
            </button>
          );
        })}
      </div>

      <header style={outerStyles.header}>
        <img src="/logo.webp" alt="Swineheadz Network" style={outerStyles.logo} />
        <h1 style={outerStyles.title}>
          <span style={{ ...outerStyles.titleStitch, borderBottomColor: theme.accent }}>SWINEHEADZ SQUARES</span>
        </h1>
        <p style={outerStyles.subtitle}>SWINEHEADZ NETWORK · 100 SQUARES · WINNER EVERY QUARTER</p>
      </header>

      <main style={outerStyles.main}>
        <BoardPanel key={activeKey} boardKey={activeKey} theme={theme} />
      </main>
    </div>
  );
}

// ============================================================================
// styles
// ============================================================================

const fontImport = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Space+Mono:wght@400;700&family=Inter:wght@400;500;600;700&display=swap');
`;
const keyframes = `
@keyframes dotPulse { 0%,100%{opacity:.3} 50%{opacity:1} }
@keyframes popIn { 0%{opacity:0; transform:translateX(-50%) scale(0.85);} 100%{opacity:1; transform:translateX(-50%) scale(1);} }
`;

const outerStyles: any = {
  page: { minHeight: "100vh", fontFamily: "'Inter', sans-serif", paddingBottom: 40 },
  header: { padding: "28px 20px 0", textAlign: "center", position: "relative", maxWidth: 720, margin: "0 auto" },
  logo: { width: "clamp(120px, 26vw, 200px)", height: "auto", objectFit: "contain", filter: "drop-shadow(0 10px 22px rgba(0,0,0,0.55))" },
  title: { fontFamily: "'Anton', sans-serif", fontSize: "clamp(30px, 8vw, 52px)", letterSpacing: "0.03em", margin: "10px 0 0", color: "#F3EEDF" },
  titleStitch: { borderBottom: "3px dashed", paddingBottom: 4 },
  subtitle: { fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#9aa4ac", marginTop: 10, letterSpacing: "0.04em" },
  cornerTabRow: { display: "flex", justifyContent: "space-between", maxWidth: 1000, margin: "0 auto", padding: "20px 16px 0", gap: 12 },
  cornerTab: (t: Theme, active: boolean) => ({
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-start" as const,
    gap: 1,
    padding: "10px 16px",
    borderRadius: 8,
    border: `1.5px solid ${active ? t.accent : "rgba(255,255,255,0.25)"}`,
    cursor: "pointer",
    fontFamily: "'Space Mono', monospace",
    background: active
      ? `linear-gradient(155deg, ${t.accent} 0%, ${t.bg} 55%, ${t.accent} 100%)`
      : "rgba(20,22,25,0.55)",
    color: active ? t.ink : "#C7CCD2",
    boxShadow: active ? "0 4px 12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.4)" : "none",
    transition: "all 0.15s ease-out",
  }),
  cornerTabLabel: { fontSize: 12, fontWeight: 700, letterSpacing: "0.03em" },
  cornerTabSub: { fontSize: 10, opacity: 0.85 },
  main: { maxWidth: 1100, margin: "24px auto 0", padding: "0 16px" },
};

function getStyles(theme: Theme): any {
  return {
    boardOuter: { display: "grid", gridTemplateColumns: "1fr", gap: 20, color: theme.chalk },
    loadingWrap: { minHeight: "40vh", display: "flex", alignItems: "center", justifyContent: "center", color: theme.chalk },
    loadingCard: { display: "flex", alignItems: "center", gap: 10 },
    loadingDot: { width: 10, height: 10, borderRadius: "50%", background: theme.accent, animation: "dotPulse 1s infinite" },
    toast: { position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)", background: theme.ink, color: theme.chalk, padding: "10px 16px", borderRadius: 8, fontSize: 13, fontFamily: "'Space Mono', monospace", zIndex: 50, border: `1px solid ${theme.accent}`, boxShadow: "0 6px 20px rgba(0,0,0,0.4)", maxWidth: "88vw", textAlign: "center" },
    modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 20 },
    modalCard: { background: theme.panel, color: theme.ink, borderRadius: 14, padding: 20, width: "100%", maxWidth: 320, boxShadow: "0 12px 32px rgba(0,0,0,0.4)" },
    viewToggleRow: { display: "flex", justifyContent: "center", alignItems: "center", gap: 10 },
    linkBtn: { background: "none", border: "none", color: theme.accent, fontFamily: "'Space Mono', monospace", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 4 },
    adminBadge: { fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: "0.06em", color: theme.ink, background: theme.accent, padding: "3px 8px", borderRadius: 4, fontWeight: 700 },
    panel: { background: theme.panel, color: theme.ink, borderRadius: 14, padding: 18, boxShadow: "0 8px 24px rgba(0,0,0,0.25)" },
    panelLabel: { fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: theme.muted, marginBottom: 8, marginTop: 14 },
    input: { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: `1.5px solid ${theme.panelBorder}`, fontSize: 14, fontFamily: "'Inter', sans-serif", outline: "none", background: theme.panelInput, color: theme.ink },
    teamRow: { display: "flex", flexDirection: "column" },
    ghostBtn: { width: "100%", padding: "9px 12px", borderRadius: 8, border: `1.5px solid ${theme.bg}`, background: "transparent", color: theme.bg, fontWeight: 600, fontSize: 13, cursor: "pointer" },
    primaryBtn: { width: "100%", padding: "13px 12px", borderRadius: 8, border: "none", background: theme.accent, color: theme.ink, fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "'Space Mono', monospace", letterSpacing: "0.03em" },
    hint: { fontSize: 12, color: theme.muted, marginTop: 8, lineHeight: 1.5 },
    divider: { height: 1, background: theme.panelBorder, margin: "16px 0" },
    dangerBtn: { marginTop: 20, width: "100%", padding: "9px 12px", borderRadius: 8, border: `1.5px solid ${theme.danger}`, background: "transparent", color: theme.danger, fontWeight: 600, fontSize: 12, cursor: "pointer" },
    errorBox: { marginTop: 12, fontSize: 12, color: theme.danger, fontFamily: "'Space Mono', monospace" },
    boardWrap: { background: theme.bgDark, borderRadius: 14, overflow: "hidden", boxShadow: `0 10px 28px rgba(0,0,0,0.4), inset 0 0 0 1px ${theme.accentSoftBorder}` },
    headerPillWrap: { display: "flex", justifyContent: "center", paddingTop: 14, position: "relative", zIndex: 3 },
    headerPill: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "7px 18px 7px 8px",
      borderRadius: 999,
      background: `linear-gradient(155deg, ${theme.accent} 0%, ${theme.bg} 55%, ${theme.accent} 100%)`,
      boxShadow: "0 6px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.4)",
      border: `1px solid ${theme.accentSoftBorder}`,
    },
    headerPillMascot: { width: 24, height: 24, objectFit: "contain", borderRadius: "50%", background: "#EDEDED", padding: 2, boxShadow: `0 0 0 1.5px ${theme.ink}` },
    headerPillWordmark: { fontFamily: "'Anton', sans-serif", fontSize: 15, letterSpacing: "0.04em", color: theme.ink, fontStyle: "italic" },
    headerPillTag: { fontFamily: "'Space Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: theme.ink, opacity: 0.75 },
    turfField: {
      position: "relative",
      overflow: "hidden",
      padding: "8px 34px 30px",
      background: `repeating-linear-gradient(90deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 2px, transparent 2px, transparent 42px), repeating-linear-gradient(180deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 60px, transparent 60px, transparent 120px), linear-gradient(180deg, #1F4D2B 0%, #16371F 100%)`,
      boxShadow: "inset 0 0 46px rgba(0,0,0,0.5)",
    },
    yardRail: (side: "left" | "right") => ({
      position: "absolute" as const,
      top: 70,
      bottom: 46,
      [side]: 8,
      width: 20,
      display: "flex",
      flexDirection: "column" as const,
      justifyContent: "space-between" as const,
      alignItems: "center" as const,
      zIndex: 1,
    }),
    yardRailLabel: {
      fontFamily: "'Space Mono', monospace",
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: "0.05em",
      color: theme.accent,
      opacity: 0.75,
      writingMode: "vertical-rl" as const,
      transform: "rotate(180deg)",
      textShadow: "0 1px 2px rgba(0,0,0,0.6)",
    },
    boardScroll: { position: "relative", zIndex: 2, overflowX: "auto", paddingBottom: 4, paddingTop: 20 },
    axisAwayLabel: { fontFamily: "'Space Mono', monospace", fontSize: 12, color: theme.accent, marginBottom: 6, marginLeft: 44, textShadow: "0 1px 3px rgba(0,0,0,0.8)" },
    boardGridOuter: { display: "flex", gap: 10, minWidth: 560 },
    gridPlate: { background: "rgba(0,0,0,0.4)", borderRadius: 10, padding: 8, boxShadow: `inset 0 0 0 1px ${theme.accentSofter}` },
    axisHomeLabel: { writingMode: "vertical-rl", transform: "rotate(180deg)", fontFamily: "'Space Mono', monospace", fontSize: 13, color: theme.accent, display: "flex", alignItems: "center" },
    endzoneBottomText: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      marginTop: 14,
      fontFamily: "'Space Mono', monospace",
    },
    endzoneBottomLabel: { fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", color: theme.accent, opacity: 0.8 },
    endzoneBottomWordmark: { fontFamily: "'Anton', sans-serif", fontSize: 16, letterSpacing: "0.05em", color: theme.chalk, fontStyle: "italic" },
    endzoneBottomTag: { fontSize: 10, letterSpacing: "0.08em", color: theme.chalkDim },
    headerRow: { display: "flex" },
    bodyRow: { display: "flex" },
    cornerCell: { width: 44, height: 44, flexShrink: 0 },
    numCell: { width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Mono', monospace", fontSize: 15, color: theme.accent, fontWeight: 700, flexShrink: 0 },
    cellSlot: { position: "relative", width: 48, height: 48, flexShrink: 0 },
    cellRevealed: { transform: "scale(1.14)", zIndex: 5, boxShadow: "0 4px 14px rgba(0,0,0,0.45)" },
    revealBubble: { position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", background: theme.ink, border: `1.5px solid ${theme.accent}`, borderRadius: 8, padding: "8px 12px", whiteSpace: "nowrap", zIndex: 30, textAlign: "center", boxShadow: "0 8px 20px rgba(0,0,0,0.5)", animation: "popIn 0.15s ease-out", pointerEvents: "none" },
    revealName: { display: "block", fontFamily: "'Anton', sans-serif", fontSize: 19, letterSpacing: "0.02em", color: theme.chalk },
    revealHint: { display: "block", fontFamily: "'Space Mono', monospace", fontSize: 9, color: theme.accent, marginTop: 2 },
    cell: {
      width: 46,
      height: 46,
      flexShrink: 0,
      margin: 1,
      borderRadius: 6,
      border: "1.5px solid rgba(20,20,20,0.85)",
      background: "#F4F2EA",
      color: "#15171A",
      fontSize: 15,
      fontFamily: "'Space Mono', monospace",
      fontWeight: 700,
      cursor: "pointer",
      padding: 0,
      position: "relative",
      transition: "transform 0.15s ease-out, box-shadow 0.15s ease-out",
    },
    cellNumber: { position: "absolute", top: 2, left: 3, fontSize: 8, fontWeight: 400, opacity: 0.5, lineHeight: 1 },
    cellName: { fontSize: 9, fontWeight: 700, lineHeight: 1.1, padding: "0 3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%", display: "block" },
    cellFilled: { background: "#FFFFFF", border: `2px solid ${theme.ink}` },
    cellMine: { background: theme.mineSoft, border: `2px solid ${theme.accent}` },
    cellPending: { background: theme.pendingSoft, border: `1.5px dashed ${theme.pendingAccent}`, color: "#EFEFEF" },
    cellWinnerForward: { background: theme.danger, border: `2px solid ${theme.winnerForwardBorder}`, color: theme.winnerForwardText },
    cellWinnerBackward: { background: theme.accent, border: `2px solid ${theme.winnerBackwardBorder}`, color: theme.winnerBackwardText },
    legendRow: { display: "flex", flexWrap: "wrap", gap: 14, padding: "12px 16px 16px" },
    legendItem: { display: "flex", alignItems: "center", gap: 6, fontFamily: "'Space Mono', monospace", fontSize: 11, color: theme.chalkDim },
    legendSwatch: { width: 12, height: 12, borderRadius: 3, display: "inline-block" },
    scoreRow: { display: "grid", gridTemplateColumns: "44px 1fr 1fr 50px", gap: 6, alignItems: "center", marginBottom: 6 },
    scoreLabel: { fontFamily: "'Space Mono', monospace", fontSize: 12, fontWeight: 700, color: theme.muted },
    scoreInput: { padding: "7px 8px", borderRadius: 6, border: `1.5px solid ${theme.panelBorder}`, fontSize: 13, background: theme.panelInput, color: theme.ink, minWidth: 0 },
    smallBtn: { padding: "7px 10px", borderRadius: 6, border: "none", background: theme.bg, color: theme.chalk, fontSize: 11, fontWeight: 700, cursor: "pointer" },
    smallGhostBtn: { padding: "7px 10px", borderRadius: 6, border: `1.5px solid ${theme.danger}`, background: "transparent", color: theme.danger, fontSize: 11, fontWeight: 700, cursor: "pointer" },
    queueRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "8px 10px", background: theme.panelInput, borderRadius: 6, marginBottom: 6, border: `1px solid ${theme.panelBorder}` },
    queueSquare: { fontFamily: "'Space Mono', monospace", fontSize: 12, fontWeight: 700, color: theme.pendingAccent, minWidth: 34 },
    queueName: { fontSize: 13, fontWeight: 700, color: theme.ink, flex: 1 },
    queueTime: { fontFamily: "'Space Mono', monospace", fontSize: 11, color: theme.muted },
    winnerRow: { display: "grid", gridTemplateColumns: "44px 1fr auto", gap: 8, alignItems: "center", padding: "8px 10px", background: theme.panelInput, borderRadius: 6, marginBottom: 6, border: `1px solid ${theme.panelBorder}` },
    winnerQ: { fontFamily: "'Space Mono', monospace", fontSize: 12, color: theme.muted, fontWeight: 700 },
    winnerName: { fontSize: 13, fontWeight: 700, color: theme.ink },
    winnerPayout: { fontFamily: "'Space Mono', monospace", fontSize: 13, fontWeight: 700, color: theme.bg },
    priceRow: { display: "flex", alignItems: "center", gap: 6 },
    priceSign: { fontFamily: "'Space Mono', monospace", fontSize: 15, fontWeight: 700, color: theme.muted },
    potLine: { fontSize: 12, color: theme.muted, marginTop: 8 },
    payoutBlock: { marginBottom: 10 },
    payoutRow: { display: "grid", gridTemplateColumns: "36px 46px 60px 1fr", gap: 8, alignItems: "center", marginBottom: 4 },
    payoutSubRow: { display: "flex", justifyContent: "space-between", fontFamily: "'Space Mono', monospace", fontSize: 11, color: theme.muted, paddingLeft: 10 },
    payoutLabel: { fontFamily: "'Space Mono', monospace", fontSize: 12, fontWeight: 700, color: theme.muted },
    payoutInput: { padding: "6px 8px", borderRadius: 6, border: `1.5px solid ${theme.panelBorder}`, fontSize: 13, background: theme.panelInput, color: theme.ink, minWidth: 0 },
    payoutPct: { fontSize: 11, color: theme.muted },
    payoutAmount: { fontFamily: "'Space Mono', monospace", fontSize: 12, fontWeight: 700, color: theme.bg, textAlign: "right" },
    winnerBlock: { marginBottom: 8 },
  };
}
