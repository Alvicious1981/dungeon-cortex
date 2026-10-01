/** Local presentation intents. These never resolve or submit a game action. */
export const DUNGEON_PREPARE_ACTION = "dungeon-prepare-action";
export const DUNGEON_OPEN_CHARACTER = "dungeon-open-character";
export const DUNGEON_SHOW_ACTION = "dungeon-show-action";
export const DUNGEON_ADVENTURE_VIEW = "dungeon-adventure-view";

export interface PrepareActionDetail {
  action: string;
}

export function prepareDungeonAction(action: string): void {
  window.dispatchEvent(new CustomEvent<PrepareActionDetail>(DUNGEON_PREPARE_ACTION, {
    detail: { action },
  }));
}

export function openCharacterSheet(): void {
  window.dispatchEvent(new CustomEvent(DUNGEON_OPEN_CHARACTER));
}

export function openEquipmentSheet(): void {
  window.dispatchEvent(new CustomEvent(DUNGEON_OPEN_CHARACTER, { detail: { tab: "equipment" } }));
}
