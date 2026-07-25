export const DUNGEON_ACTION_REQUEST = "dungeon-action-request";
export const DUNGEON_ACTION_START = "dungeon-action-start";
export const DUNGEON_ACTION_END = "dungeon-action-end";
export const DUNGEON_ACTION_ERROR = "dungeon-action-error";

export interface DungeonActionRequest {
  action: string;
  targetIds?: string[];
  targetX?: number;
  targetY?: number;
}

export interface DungeonActionRequestDetail {
  requestId: string;
  request: DungeonActionRequest;
}

export interface DungeonActionErrorDetail extends DungeonActionRequestDetail {
  error: string;
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
