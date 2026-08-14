import { NextRequest, NextResponse } from "next/server";
import { updateQuarterScore, computeAndSaveWinner, isBoard, QUARTER_KEYS } from "../../../../lib/kv";
import { requireEnv } from "../../../../lib/env";

export async function POST(req: NextRequest) {
  const ADMIN_SECRET = requireEnv("ADMIN_SECRET");
  const auth = req.headers.get("x-admin-secret");
  if (auth !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { board, quarter, side, value, computeWinner } = await req.json().catch(() => ({}));

  if (!isBoard(board) || !QUARTER_KEYS.includes(quarter)) {
    return NextResponse.json({ error: "Invalid board or quarter" }, { status: 400 });
  }

  if (computeWinner) {
    const quarters = await computeAndSaveWinner(board, quarter);
    return NextResponse.json({ board, quarters });
  }

  if (side !== "home" && side !== "away") {
    return NextResponse.json({ error: "side must be 'home' or 'away'" }, { status: 400 });
  }

  const quarters = await updateQuarterScore(board, quarter, side, String(value ?? ""));
  return NextResponse.json({ board, quarters });
}
