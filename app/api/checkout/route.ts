import { NextRequest, NextResponse } from "next/server";
import { holdSquare, releaseSquare, entriesAreOpen, checkRateLimit } from "../../../lib/kv";
import { requireEnv } from "../../../lib/env";

export async function POST(req: NextRequest) {
  const { squareId, name, email } = await req.json();

  if (
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
  // path depends on.
  if (!(await entriesAreOpen())) {
    return NextResponse.json(
      { error: "Entries are closed — numbers have already been drawn." },
      { status: 409 }
    );
  }

  // Rate-limit per email so a bad actor can't repeatedly hold-and-abandon
  // squares (each hold blocks that square for up to 10 minutes) to grief
  // real buyers out of the board.
  const rateLimitKey = String(email).toLowerCase().trim();
  const underLimit = await checkRateLimit(rateLimitKey, 5, 10 * 60);
  if (!underLimit) {
    return NextResponse.json(
      { error: "Too many checkout attempts. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  // Temporarily hold the square so nobody else can grab it mid-checkout.
  const held = await holdSquare(squareId, name, email);
  if (!held) {
    return NextResponse.json(
      { error: "That square is no longer available." },
      { status: 409 }
    );
  }

  try {
    const WHOP_API_KEY = requireEnv("WHOP_API_KEY");
    const WHOP_PLAN_ID = requireEnv("WHOP_PLAN_ID"); // the $10 plan for one square
    const APP_URL = requireEnv("APP_URL"); // e.g. https://shz-football-squares.vercel.app

    const res = await fetch("https://api.whop.com/api/v2/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHOP_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        plan_id: WHOP_PLAN_ID,
        redirect_url: `${APP_URL}/checkout-complete?square=${squareId}`,
        metadata: {
          square_id: String(squareId),
          buyer_name: name,
          buyer_email: email,
          entry_type: "paid",
        },
      }),
    });

    if (!res.ok) {
      await releaseSquare(squareId);
      const errText = await res.text();
      return NextResponse.json(
        { error: `Whop checkout error: ${errText}` },
        { status: 502 }
      );
    }

    const session = await res.json();
    return NextResponse.json({ purchaseUrl: session.purchase_url });
  } catch (err) {
    await releaseSquare(squareId);
    const message = err instanceof Error ? err.message : "Failed to create checkout session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
