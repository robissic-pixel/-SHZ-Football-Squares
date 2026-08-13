import { NextRequest, NextResponse } from "next/server";
import { lockSquare, getAllSquares, entriesAreOpen, claimAmoeEmail, isBoard } from "../../../lib/kv";
import { kv } from "@vercel/kv";

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
  const { board, name, email, mailingAddress } = await req.json();

  if (!isBoard(board) || !name || !email || !mailingAddress) {
    return NextResponse.json(
      { error: "Board, name, email, and mailing address are required." },
      { status: 400 }
    );
  }

  // Block new entries once the digits have been drawn for this board.
  if (!(await entriesAreOpen(board))) {
    return NextResponse.json(
      { error: "Entries are closed for this board — numbers have already been drawn." },
      { status: 409 }
    );
  }

  // One free entry per email address per board. Without this, the same
  // person (or a script) could submit repeatedly and claim every open
  // square for free, which both defeats the paid revenue model and isn't
  // really "one entry" in the spirit of an AMOE. A person can still enter
  // both boards once each, since silver and gold are independent pools.
  const emailAvailable = await claimAmoeEmail(board, email);
  if (!emailAvailable) {
    return NextResponse.json(
      { error: "This email has already been used for a free entry on this board." },
      { status: 409 }
    );
  }

  // Auto-assign a random open square so free entrants can't cherry-pick.
  const all = await getAllSquares(board);
  const open = all.filter((s) => s.status === "open");

  if (open.length === 0) {
    return NextResponse.json({ error: "This board is full." }, { status: 409 });
  }

  const chosen = open[Math.floor(Math.random() * open.length)];
  await lockSquare(board, chosen.id, "free", name, email);

  // Persist the mailing address + AMOE record separately for compliance
  // record-keeping (not stored on the square itself).
  await kv.set(`amoe:${board}:${chosen.id}`, {
    name,
    email,
    mailingAddress,
    submittedAt: new Date().toISOString(),
  });

  return NextResponse.json({ board, squareId: chosen.id });
}
