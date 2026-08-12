import { NextRequest, NextResponse } from "next/server";
import { lockSquare, getAllSquares } from "@/lib/kv";

/**
 * Free Alternative Method of Entry.
 *
 * IMPORTANT LEGAL NOTE (not legal advice): for AMOE to hold up, the free
 * route must be (a) easy to find and use — advertised as prominently as the
 * paid route, (b) require no purchase of any kind, and (c) give identical
 * odds of winning. In several states regulators/courts have required the
 * free method to be at least as convenient as paying (some require a
 * mail-in option, not just a web form). Confirm Texas-specific requirements
 * with an attorney before launch — this endpoint implements the "equal
 * odds, no purchase" mechanics but does not by itself guarantee compliance.
 */
export async function POST(req: NextRequest) {
  const { name, email, mailingAddress } = await req.json();

  if (!name || !email || !mailingAddress) {
    return NextResponse.json(
      { error: "Name, email, and mailing address are required." },
      { status: 400 }
    );
  }

  // Auto-assign a random open square so free entrants can't cherry-pick
  // (paid entrants can't meaningfully cherry-pick either, since digits are
  // randomized after the board fills — but this keeps the entry flow itself
  // free of any appearance of unequal treatment).
  const all = await getAllSquares();
  const open = all.filter((s) => s.status === "open");

  if (open.length === 0) {
    return NextResponse.json({ error: "Board is full." }, { status: 409 });
  }

  const chosen = open[Math.floor(Math.random() * open.length)];
  await lockSquare(chosen.id, "free", name, email);

  // Persist the mailing address + AMOE record separately for compliance
  // record-keeping (not stored on the square itself).
  const { kv } = await import("@vercel/kv");
  await kv.set(`amoe:${chosen.id}`, {
    name,
    email,
    mailingAddress,
    submittedAt: new Date().toISOString(),
  });

  return NextResponse.json({ squareId: chosen.id });
}
