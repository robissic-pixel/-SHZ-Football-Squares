import { NextRequest, NextResponse } from "next/server";
import { holdSquare, releaseSquare, entriesAreOpen, checkRateLimit, isBoard, BOARD_CONFIG } from "../../../lib/kv";
import { requireEnv } from "../../../lib/env";

export async function POST(req: NextRequest) {
  const { board, squareId, name, email } = await req.json();

  if (
    !isBoard(board) ||
    typeof squareId !== "number" ||
    squareId < 0 ||
    squareId > 99 ||
    !name ||
    !email
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Block new entries once the digits have been drawn — an entry after
  // that point no longer has the same odds as everyone who entered before
  // the draw, which undermines the "equal odds" premise the free AMOE
  // path depends on. Each board closes independently.
  if (!(await entriesAreOpen(board))) {
    return NextResponse.json(
      { error: "Entries are closed for this board — numbers have already been drawn." },
      { status: 409 }
    );
  }

  // Rate-limit per email+board so a bad actor can't repeatedly hold-and-
  // abandon squares (each hold blocks that square for up to 10 minutes) to
  // grief real buyers out of the board.
  const rateLimitKey = `${board}:${String(email).toLowerCase().trim()}`;
  const underLimit = await checkRateLimit(rateLimitKey, 5, 10 * 60);
  if (!underLimit) {
    return NextResponse.json(
      { error: "Too many checkout attempts. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  // Temporarily hold the square so nobody else can grab it mid-checkout.
  const held = await holdSquare(board, squareId, name, email);
  if (!held) {
    return NextResponse.json(
      { error: "That square is no longer available." },
      { status: 409 }
    );
  }

  try {
    const WHOP_API_KEY = requireEnv("WHOP_API_KEY");
    const WHOP_PLAN_ID = requireEnv(BOARD_CONFIG[board].planEnvVar); // WHOP_PLAN_ID_SILVER or WHOP_PLAN_ID_GOLD
    const APP_URL = requireEnv("APP_URL"); // e.g. https://shz-football-squares-yllj.vercel.app

    const res = await fetch("https://api.whop.com/api/v2/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHOP_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        plan_id: WHOP_PLAN_ID,
        redirect_url: `${APP_URL}/checkout-complete?board=${board}&square=${squareId}`,
        metadata: {
          board,
          square_id: String(squareId),
          buyer_name: name,
          buyer_email: email,
          entry_type: "paid",
        },
      }),
    });

    if (!res.ok) {
      await releaseSquare(board, squareId);
      const errText = await res.text();
      return NextResponse.json(
        { error: `Whop checkout error: ${errText}` },
        { status: 502 }
      );
    }

    const session = await res.json();
    return NextResponse.json({ purchaseUrl: session.purchase_url });
  } catch (err) {
    await releaseSquare(board, squareId);
    const message = err instanceof Error ? err.message : "Failed to create checkout session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
