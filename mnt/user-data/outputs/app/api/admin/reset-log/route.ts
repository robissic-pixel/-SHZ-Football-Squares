import { NextRequest, NextResponse } from "next/server";
import { getResetLog, isBoard } from "../../../../lib/kv";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const isAdmin =
    !!process.env.ADMIN_SECRET && req.headers.get("x-admin-secret") === process.env.ADMIN_SECRET;
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const boardParam = req.nextUrl.searchParams.get("board") ?? "silver";
  if (!isBoard(boardParam)) {
    return NextResponse.json({ error: "Invalid board. Use ?board=silver or ?board=gold." }, { status: 400 });
  }

  const log = await getResetLog(boardParam);
  return NextResponse.json(
    { board: boardParam, log },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
