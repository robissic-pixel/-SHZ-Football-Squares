"use client";

import { useEffect, useState } from "react";

interface Square {
  id: number;
  status: "open" | "pending" | "locked";
  ownerName?: string;
}

export default function BoardPage() {
  const [squares, setSquares] = useState<Square[]>([]);
  const [digits, setDigits] = useState<{ rows: number[]; cols: number[] } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<"paid" | "free" | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetch("/api/squares")
      .then((r) => r.json())
      .then((d) => {
        setSquares(d.squares);
        setDigits(d.digits);
      });

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  async function submitPaid() {
    if (selected === null) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ squareId: selected, name, email }),
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
      body: JSON.stringify({ name, email, mailingAddress: address }),
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
    alert(`You've been entered! Your square: #${data.squareId}`);
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1>SwineHeadz Squares</h1>
      <p>
        Pick an open square for $10, or use the free entry method below — both
        give identical odds to win. No purchase necessary to enter or win.
      </p>

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
              border: selected === sq.id ? "2px solid #2563eb" : "1px solid #ddd",
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
          <h3>Claim square #{selected} — $10</h3>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button disabled={busy || !name || !email} onClick={submitPaid}>
            {busy ? "Loading..." : "Pay with Whop"}
          </button>
        </div>
      )}

      <div style={{ border: "1px solid #ddd", padding: 16 }}>
        <h3>Free entry (no purchase necessary)</h3>
        <p style={{ fontSize: 13, color: "#555" }}>
          You'll be randomly assigned an open square with the same odds as a
          paid entry.
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
          Digits have been randomized — the board is locked for entries.
        </p>
      )}
    </main>
  );
}
