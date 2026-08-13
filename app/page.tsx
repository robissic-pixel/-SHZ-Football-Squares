"use client";

import { useEffect, useState } from "react";

type BoardKey = "silver" | "gold";

const BOARD_META: Record<BoardKey, { label: string; price: number; accent: string }> = {
  silver: { label: "Silver Board", price: 10, accent: "#8a94a6" },
  gold: { label: "Gold Board", price: 20, accent: "#c9962e" },
};

interface Square {
  id: number;
  status: "open" | "pending" | "locked";
  ownerName?: string;
}

export default function BoardPage() {
  const [board, setBoard] = useState<BoardKey>("silver");
  const [squares, setSquares] = useState<Square[]>([]);
  const [digits, setDigits] = useState<{ rows: number[]; cols: number[] } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<"paid" | "free" | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = BOARD_META[board];

  const load = () =>
    fetch(`/api/squares?board=${board}`)
      .then((r) => r.json())
      .then((d) => {
        setSquares(d.squares);
        setDigits(d.digits);
      });

  // Reset per-board UI state and reload whenever the selected board changes.
  useEffect(() => {
    setSelected(null);
    setMode(null);
    setError(null);
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  async function submitPaid() {
    if (selected === null) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board, squareId: selected, name, email }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error);
      return;
    }
    window.location.href = data.purchaseUrl;
  }

  async function submitFree() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/amoe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board, name, email, mailingAddress: address }),
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
    alert(`You've been entered on the ${meta.label}! Your square: #${data.squareId}`);
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1>SwineHeadz Squares</h1>
      <p>
        Pick an open square, or use the free entry method below — both give
        identical odds to win. No purchase necessary to enter or win.
      </p>

      <div style={{ display: "flex", gap: 8, margin: "16px 0 24px" }}>
        {(Object.keys(BOARD_META) as BoardKey[]).map((key) => {
          const m = BOARD_META[key];
          const active = key === board;
          return (
            <button
              key={key}
              onClick={() => setBoard(key)}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: 8,
                border: `2px solid ${active ? m.accent : "#ddd"}`,
                background: active ? m.accent : "#fff",
                color: active ? "#fff" : "#333",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {m.label} — ${m.price}/square
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 4, margin: "24px 0" }}>
        {squares.map((sq) => (
          <button
            key={sq.id}
            disabled={sq.status !== "open"}
            onClick={() => {
              setSelected(sq.id);
              setMode("paid");
              setError(null);
            }}
            style={{
              aspectRatio: "1",
              fontSize: 11,
              background:
                sq.status === "open" ? "#fff" : sq.status === "pending" ? "#fde68a" : "#a3a3a3",
              border: selected === sq.id ? `2px solid ${meta.accent}` : "1px solid #ddd",
              cursor: sq.status === "open" ? "pointer" : "not-allowed",
            }}
            title={sq.ownerName ?? "Open"}
          >
            {sq.status === "locked" ? "X" : sq.id}
          </button>
        ))}
      </div>

      {mode === "paid" && selected !== null && (
        <div style={{ border: "1px solid #ddd", padding: 16, marginBottom: 16 }}>
          <h3>
            Claim square #{selected} on the {meta.label} — ${meta.price}
          </h3>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button disabled={busy || !name || !email} onClick={submitPaid}>
            {busy ? "Loading..." : "Pay with Whop"}
          </button>
        </div>
      )}

      <div style={{ border: "1px solid #ddd", padding: 16 }}>
        <h3>Free entry (no purchase necessary) — {meta.label}</h3>
        <p style={{ fontSize: 13, color: "#555" }}>
          You'll be randomly assigned an open square on the {meta.label} with
          the same odds as a paid entry. (You may enter each board once.)
        </p>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="Mailing address" value={address} onChange={(e) => setAddress(e.target.value)} />
        <button
          disabled={busy || !name || !email || !address}
          onClick={() => {
            setMode("free");
            submitFree();
          }}
        >
          {busy ? "Submitting..." : "Enter free"}
        </button>
      </div>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {digits && (
        <p style={{ marginTop: 16, fontSize: 13, color: "#555" }}>
          Digits have been randomized for the {meta.label} — entries are
          closed for this board.
        </p>
      )}
    </main>
  );
}
