/**
 * lib/actions/roll-command.ts
 *
 * The `/roll` command handler, moved out of the action route (DC-AUD-008).
 *
 * `/roll` is the one submission that route answers without a mechanical gate:
 * it rolls the dice the player named, writes the result, and replies 202. It
 * resolves before `buildCampaignContext` runs and before the route's
 * `gameEvents` array exists, so it emits no `GameEvent`, never reaches the SSE
 * builder, and shares no mutable state with the resolution gates below it.
 * That isolation is what made it the one block safe to move on its own.
 *
 * Nothing here was redesigned. The prefix, the parsing, the order of writes,
 * the status code, the response body and the receipt settlement are the ones
 * the route already had.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { roll } from "@/lib/rules/dice";
import { completeActionReceiptWithResponse } from "@/lib/actions/request-receipt";

/**
 * The exact prefix a roll command carries — trailing space included.
 *
 * The space is part of the contract, not formatting: `/roll` on its own is not
 * a roll command and falls through to the intent gates, where it is classified
 * like any other text. Declared here and imported by the route so the
 * detection there and the parsing below cannot disagree about how many
 * characters to skip.
 */
export const ROLL_COMMAND_PREFIX = "/roll ";

export interface ResolveRollCommandInput {
  campaignId: string;
  /** The player's action, already trimmed by the route. */
  trimmedAction: string;
  /**
   * The acquired receipt id, when the submission carried a `requestId`. Absent
   * for a caller that predates the idempotency contract, which settles nothing
   * — exactly as before.
   */
  receiptId?: string;
  /**
   * The route's single idempotent writer of the player's own log line. Passed
   * as a callback rather than reimplemented here so `route.ts` keeps one owner
   * of the "written at most once" guarantee it shares with every other gate.
   */
  persistPlayerAction: () => Promise<void>;
}

export async function resolveRollCommand({
  campaignId,
  trimmedAction,
  receiptId,
  persistPlayerAction,
}: ResolveRollCommandInput): Promise<Response> {
  const notation = trimmedAction.slice(ROLL_COMMAND_PREFIX.length).trim();

  let rollContent: string;
  try {
    const result = roll(notation);
    const diceList = result.dice.map((d) => d.result).join(", ");
    const modifierPart = result.modifier !== 0
      ? ` ${result.modifier > 0 ? "+" : ""}${result.modifier}`
      : "";
    rollContent =
      `🎲 Roll ${result.notation}: [${diceList}]${modifierPart} = **${result.total}**`;
  } catch {
    rollContent = `⚠️ Invalid dice notation: "${notation}". Use format like 1d20+5 or 2d6.`;
  }

  // /roll is not a mechanical gate and has no rejection path: bad notation is
  // answered with a system line and 202, not a 4xx. The command is therefore
  // always canonical, and is written before the result that answers it.
  await persistPlayerAction();

  await prisma.gameLog.create({
    data: {
      campaignId,
      role: "system",
      content: rollContent,
    },
  });

  // `/roll` returns early and never reaches the convergence point where the
  // ordinary action settles its receipt, so it settles its own — storing the
  // exact body a duplicate must receive instead of rolling a second time.
  //
  // Not wrapped in a try/catch: if the receipt cannot be recorded, this must
  // not answer 202 as though durable idempotency existed. The failure
  // propagates and the receipt stays PROCESSING, which a retry refuses.
  const rollResponseBody = { ok: true };
  if (receiptId) {
    await completeActionReceiptWithResponse(receiptId, 202, rollResponseBody);
  }

  return NextResponse.json(rollResponseBody, { status: 202 });
}
