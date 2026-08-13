import { NextRequest, NextResponse } from "next/server";
import { getAllSquares, getDigits, isBoard } from "../../../lib/kv";

// This route reads live game state from KV on every request. Without this,
// Next.js's App Router will try to statically generate it at build time
// (baking in whatever the board looked like during the build, and never
// updating again) since a naive handler would take no request-derived input.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const boardParam = req.nextUrl.searchParams.get("board") ?? "silver";
  if (!isBoard(boardParam)) {
    return NextResponse.json({ error: "Invalid board. Use ?board=silver or ?board=gold." }, { status: 400 });
  }

  const squares = await getAllSquares(boardParam);
  const digits = await getDigits(boardParam);

  // Never leak buyer emails to the public board.
  const publicSquares = squares.map((s) => ({
    id: s.id,
    status: s.status,
    ownerName: s.status === "locked" ? s.ownerName : undefined,
  }));

  return NextResponse.json({ board: boardParam, squares: publicSquares, digits });
}
