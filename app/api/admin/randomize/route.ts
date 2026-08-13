import { NextRequest, NextResponse } from "next/server";
import { randomizeDigits, getDigits } from "../../../../lib/kv";

const ADMIN_SECRET = process.env.ADMIN_SECRET!;

export async function POST(req: NextRequest) {
  const auth = req.headers.get("x-admin-secret");
  if (auth !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await getDigits();
  if (existing) {
    return NextResponse.json(
      { error: "Digits already randomized. Delete board:digits in KV to redo (testing only)." },
      { status: 409 }
    );
  }

  const digits = await randomizeDigits();
  return NextResponse.json(digits);
}
