import { NextRequest, NextResponse } from "next/server";
import { resetBoard, isBoard } from "../../../../lib/kv";
import { requireEnv } from "../../../../lib/env";

export async function POST(req: NextRequest) {
  const ADMIN_SECRET = requireEnv("ADMIN_SECRET");
  const auth = req.headers.get("x-admin-secret");
  if (auth !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { board } = await req.json().catch(() => ({}));
  if (!isBoard(board)) {
    return NextResponse.json({ error: "Invalid board" }, { status: 400 });
  }

  await resetBoard(board);
  return NextResponse.json({ ok: true });
}
