import { NextRequest, NextResponse } from "next/server";
import { randomizeDigits, getDigits, isBoard } from "../../../../lib/kv";
import { requireEnv } from "../../../../lib/env";

export async function POST(req: NextRequest) {
  const ADMIN_SECRET = requireEnv("ADMIN_SECRET");
  const auth = req.headers.get("x-admin-secret");
  if (auth !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { board } = await req.json().catch(() => ({}));
  if (!isBoard(board)) {
    return NextResponse.json(
      { error: "Invalid board. Pass { \"board\": \"silver\" } or { \"board\": \"gold\" } in the request body." },
      { status: 400 }
    );
  }

  const existing = await getDigits(board);
  if (existing) {
    return NextResponse.json(
      {
        error: `Digits already randomized for the ${board} board. Delete board:${board}:digits in KV to redo (testing only).`,
      },
      { status: 409 }
    );
  }

  const digits = await randomizeDigits(board);
  return NextResponse.json({ board, ...digits });
}
