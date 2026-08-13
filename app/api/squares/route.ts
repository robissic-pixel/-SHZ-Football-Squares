import { NextResponse } from "next/server";
import { getAllSquares, getDigits } from "../../../lib/kv";

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
