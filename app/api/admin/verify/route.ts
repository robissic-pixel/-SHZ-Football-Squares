import { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "../../../../lib/env";

/**
 * Lightweight check for whether a given secret matches ADMIN_SECRET,
 * used by the "Admin login" screen so the UI only unlocks admin controls
 * after the server actually confirms the secret — instead of unlocking
 * optimistically and only failing later on the first real admin action.
 */
export async function POST(req: NextRequest) {
  const ADMIN_SECRET = requireEnv("ADMIN_SECRET");
  const auth = req.headers.get("x-admin-secret");
  if (auth !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
