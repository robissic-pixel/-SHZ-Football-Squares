import { NextRequest, NextResponse } from "next/server";
import { verifyUnlockToken, COOKIE_NAME } from "../../../../lib/lock";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cookieValue = req.cookies.get(COOKIE_NAME)?.value;
  return NextResponse.json(
    { unlocked: verifyUnlockToken(cookieValue) },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
