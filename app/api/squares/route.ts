import { NextResponse } from "next/server";
import { getAllSquares, getDigits } from "../../../lib/kv";

// This route reads live game state from KV on every request. Without this,
// Next.js's App Router will try to statically generate it at build time
// (baking in whatever the board looked like during the build, and never
// updating again) since the handler takes no request-derived input.
export const dynamic = "force-dynamic";

export async function GET() {
  const squares = await getAllSquares();
  const digits = await getDigits();

  // Never leak buyer emails to the public board.
  const publicSquares = squares.map((s) => ({
    id: s.id,
    status: s.status,
    ownerName: s.status === "locked" ? s.ownerName : undefined,
  }));

  return NextResponse.json({ squares: publicSquares, digits });
}
