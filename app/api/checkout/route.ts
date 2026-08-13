import { NextRequest, NextResponse } from "next/server";
import Whop from "@whop/sdk";
import { holdSquare, releaseSquare } from "../../../lib/kv";

const whop = new Whop({ apiKey: process.env.WHOP_API_KEY! });
const WHOP_PLAN_ID = process.env.WHOP_PLAN_ID!; // the $10 plan for one square

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
    // Ties this specific checkout to the square via metadata, which comes
    // back on the payment.succeeded webhook payload.
    const checkoutConfig = await whop.checkoutConfigurations.create({
      plan_id: WHOP_PLAN_ID,
      metadata: {
        square_id: String(squareId),
        buyer_name: name,
        buyer_email: email,
        entry_type: "paid",
      },
    });

    // Hosted checkout page for this specific session (carries the metadata
    // above through to the webhook). Verify against your sandbox before
    // going live.
    const purchaseUrl = `https://whop.com/checkout/${checkoutConfig.id}`;

    return NextResponse.json({ purchaseUrl });
  } catch (err) {
    await releaseSquare(squareId);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Whop checkout error: ${message}` },
      { status: 502 }
    );
  }
}
