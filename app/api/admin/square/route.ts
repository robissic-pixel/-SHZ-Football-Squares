import { NextRequest, NextResponse } from "next/server";
import { adminAssignSquare, adminReleaseSquare, isBoard } from "../../../../lib/kv";
import { requireEnv } from "../../../../lib/env";

/**
 * Admin direct control over a single square — assign it to someone who
 * paid outside Whop (cash, Venmo, etc.), or force-release a stuck/expired
 * hold or a mistaken assignment back to open.
 */
export async function POST(req: NextRequest) {
  const ADMIN_SECRET = requireEnv("ADMIN_SECRET");
  const auth = req.headers.get("x-admin-secret");
  if (auth !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { board, squareId, action, name } = await req.json().catch(() => ({}));
  const id = Number(squareId);

  if (!isBoard(board) || !Number.isInteger(id) || id < 0 || id > 99) {
    return NextResponse.json({ error: "Invalid board or squareId" }, { status: 400 });
  }

  if (action === "assign") {
    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: "name is required to assign a square" }, { status: 400 });
    }
    await adminAssignSquare(board, id, String(name).trim());
    return NextResponse.json({ ok: true });
  }

  if (action === "release") {
    await adminReleaseSquare(board, id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "action must be 'assign' or 'release'" }, { status: 400 });
}
