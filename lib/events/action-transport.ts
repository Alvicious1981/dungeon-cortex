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
