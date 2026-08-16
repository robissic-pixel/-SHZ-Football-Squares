import { NextRequest, NextResponse } from "next/server";
import { sequenceMatches, createUnlockToken } from "../../../lib/lock";
import { checkRateLimit } from "../../../lib/kv";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  // Rate-limit attempts per IP so the combo can't be brute-forced by a
  // script — 10 tries per 10 minutes is plenty for a real person who
  // fat-fingers a tap, not enough to search the space of combinations.
  const underLimit = await checkRateLimit(`unlock:${ip}`, 10, 10 * 60);
  if (!underLimit) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
  }

  const { sequence } = await req.json().catch(() => ({}));

  if (!sequenceMatches(sequence)) {
    return NextResponse.json({ error: "Incorrect code." }, { status: 401 });
  }

  const token = createUnlockToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(token.name, token.value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: token.maxAgeSeconds,
  });
  return res;
}
