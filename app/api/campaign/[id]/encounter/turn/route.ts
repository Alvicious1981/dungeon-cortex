import { NextResponse } from "next/server";

/**
 * Retired on 2026-07-25 by Milestone U.
 *
 * Turn advancement is now resolved exclusively by the authenticated campaign
 * action SSE route using the canonical "End Turn" request. Keeping this route
 * as an explicit 410 avoids a second mutation contract while giving stale
 * clients a deterministic migration signal.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'This endpoint is retired. Send { "action": "End Turn" } to the campaign action stream.',
    },
    { status: 410 }
  );
}
