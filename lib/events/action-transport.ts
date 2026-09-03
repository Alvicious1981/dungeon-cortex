export const DUNGEON_ACTION_REQUEST = "dungeon-action-request";
export const DUNGEON_ACTION_START = "dungeon-action-start";
export const DUNGEON_ACTION_END = "dungeon-action-end";
export const DUNGEON_ACTION_ERROR = "dungeon-action-error";
export const DUNGEON_TARGET_SELECTION_CHANGE =
  "dungeon-target-selection-change";

export interface DungeonActionRequest {
  action: string;
  targetIds?: string[];
  targetX?: number;
  targetY?: number;
}

export interface DungeonAttackRequest extends DungeonActionRequest {
  action: "Attack";
  targetIds: [string];
}

export interface DungeonActionRequestDetail {
  requestId: string;
  request: DungeonActionRequest;
}

/**
 * The wire shape POSTed to `/api/campaign/[id]/action`.
 *
 * `DungeonActionRequest` is what a component asks for and
 * `DungeonActionRequestDetail` is how that travels between components, with the
 * correlation id kept beside the request rather than inside it. On the wire the
 * two are flattened into one body, so this is the single declaration both the
 * client and the route use — neither side gets to describe the payload
 * differently from the other.
 *
 * `requestId` is optional so callers that predate DC-AUD-002 keep working. The
 * `ActionInput` client always sends the id it already generated for the action.
 * It is transport metadata only: DC-AUD-002 parses and validates it, and
 * nothing reads it. Deduplication belongs to DC-AUD-003.
 */
export interface DungeonActionRequestBody extends DungeonActionRequest {
  requestId?: string;
}

/**
 * Upper bound the route enforces on a submitted `requestId`. Lives here so the
 * two sides of the contract cannot disagree about it. Generated ids are around
 * thirty characters, so this is a guard against abuse, not a working limit.
 */
export const ACTION_REQUEST_ID_MAX_CHARS = 128;

export interface DungeonActionErrorDetail extends DungeonActionRequestDetail {
  error: string;
}

export interface DungeonTargetSelectionDetail {
  targetIds: string[];
}

let requestSequence = 0;

export function createDungeonActionRequestId(): string {
  requestSequence += 1;
  return `dungeon-action-${Date.now()}-${requestSequence}`;
}

export function requestDungeonAction(
  request: DungeonActionRequest,
  requestId = createDungeonActionRequestId()
): string {
  window.dispatchEvent(
    new CustomEvent<DungeonActionRequestDetail>(DUNGEON_ACTION_REQUEST, {
      detail: { requestId, request },
    })
  );
  return requestId;
}

export function requestDungeonAttack(
  targetId: string,
  requestId = createDungeonActionRequestId()
): string {
  const request: DungeonAttackRequest = {
    action: "Attack",
    targetIds: [targetId],
  };
  return requestDungeonAction(request, requestId);
}

export function dispatchDungeonTargetSelection(
  targetIds: string[]
): void {
  window.dispatchEvent(
    new CustomEvent<DungeonTargetSelectionDetail>(
      DUNGEON_TARGET_SELECTION_CHANGE,
      { detail: { targetIds: [...targetIds] } }
    )
  );
}

export function dispatchDungeonActionStart(
  detail: DungeonActionRequestDetail
): void {
  window.dispatchEvent(
    new CustomEvent<DungeonActionRequestDetail>(DUNGEON_ACTION_START, { detail })
  );
}

export function dispatchDungeonActionEnd(
  detail: DungeonActionRequestDetail
): void {
  window.dispatchEvent(
    new CustomEvent<DungeonActionRequestDetail>(DUNGEON_ACTION_END, { detail })
  );
}

export function dispatchDungeonActionError(
  detail: DungeonActionErrorDetail
): void {
  window.dispatchEvent(
    new CustomEvent<DungeonActionErrorDetail>(DUNGEON_ACTION_ERROR, { detail })
  );
}
