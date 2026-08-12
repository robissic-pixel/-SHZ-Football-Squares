import { NextRequest, NextResponse } from "next/server";
import { holdSquare, releaseSquare } from "@/lib/kv";

const WHOP_API_KEY = process.env.WHOP_API_KEY!;
const WHOP_PLAN_ID = process.env.WHOP_PLAN_ID!; // the $10 plan for one square
const APP_URL = process.env.APP_URL!; // e.g. https://shz-football-squares.vercel.app

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

  // Temporarily hold the square so nobody else can grab it mid-checkout.
  const held = await holdSquare(squareId, name, email);
  if (!held) {
    return NextResponse.json(
      { error: "That square is no longer available." },
      { status: 409 }
    );
  }

  try {
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
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
