import { NextRequest, NextResponse } from "next/server";
import { getAllSquares, getDigits, getBoardSettings, getQuarters, isBoard } from "../../../lib/kv";

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

  const [squares, digits, settings, quarters] = await Promise.all([
    getAllSquares(boardParam),
    getDigits(boardParam),
    getBoardSettings(boardParam),
    getQuarters(boardParam),
  ]);

  // Admins (identified by the same shared secret used for other admin
  // routes) can see who's holding a pending square and when that hold
  // expires, so they can spot and release stuck checkouts. Everyone else
  // only ever sees owner names for squares that are fully locked in — a
  // pending buyer's name/email never leaks to other players.
  const isAdminRequest =
    !!process.env.ADMIN_SECRET && req.headers.get("x-admin-secret") === process.env.ADMIN_SECRET;

  const publicSquares = squares.map((s) => ({
    id: s.id,
    status: s.status,
    ownerName: s.status === "locked" || (isAdminRequest && s.status === "pending") ? s.ownerName : undefined,
    pendingExpiresAt: isAdminRequest ? s.pendingExpiresAt : undefined,
  }));

  return NextResponse.json(
    { board: boardParam, squares: publicSquares, digits, settings, quarters },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
