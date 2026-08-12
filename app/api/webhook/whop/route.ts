import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { kv } from "@vercel/kv";
import { lockSquare, releaseSquare } from "../../../../lib/kv";

const WEBHOOK_SECRET = process.env.WHOP_WEBHOOK_SECRET!; // the part after "whsec_"

// Whop follows the Standard Webhooks spec:
// headers: webhook-id, webhook-timestamp, webhook-signature ("v1,<base64 hmac>")
// signed content = `${id}.${timestamp}.${rawBody}`, HMAC-SHA256, base64 secret key.
function verifySignature(
  rawBody: string,
  id: string,
  timestamp: string,
  signatureHeader: string
): boolean {
  const secretKey = Buffer.from(WEBHOOK_SECRET, "base64");
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secretKey)
    .update(signedContent)
    .digest("base64");

  const candidates = signatureHeader.split(" ").map((s) => s.split(",")[1]);
  return candidates.some((c) =>
    crypto.timingSafeEqual(Buffer.from(c ?? ""), Buffer.from(expected))
  );
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const id = req.headers.get("webhook-id") ?? "";
  const timestamp = req.headers.get("webhook-timestamp") ?? "";
  const signature = req.headers.get("webhook-signature") ?? "";

  if (!id || !timestamp || !signature) {
    return NextResponse.json({ error: "Missing signature headers" }, { status: 400 });
  }

  // Reject stale events (>5 min old) to prevent replay attacks.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) {
    return NextResponse.json({ error: "Timestamp too old" }, { status: 400 });
  }

  if (!verifySignature(rawBody, id, timestamp, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Idempotency: Whop retries on failure/non-2xx, so dedupe by webhook id.
  const dedupeKey = `webhook:seen:${id}`;
  const alreadyProcessed = await kv.set(dedupeKey, true, { nx: true, ex: 86400 });
  if (alreadyProcessed === null) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const event = JSON.parse(rawBody);

  if (event.type === "payment.succeeded") {
    const { square_id, buyer_name, buyer_email } = event.data.metadata ?? {};
    const squareId = Number(square_id);

    if (Number.isInteger(squareId) && squareId >= 0 && squareId <= 99) {
      await lockSquare(squareId, "paid", buyer_name, buyer_email, event.data.id);
    }
  }

  if (event.type === "payment.failed") {
    const { square_id } = event.data.metadata ?? {};
    const squareId = Number(square_id);
    if (Number.isInteger(squareId)) {
      await releaseSquare(squareId);
    }
  }

  return NextResponse.json({ ok: true });
}
