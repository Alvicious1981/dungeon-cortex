"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import CombatHUD from "./CombatHUD";
import type { GameEvent } from "@/lib/events/game-events";
import {
  DUNGEON_ACTION_END,
  DUNGEON_ACTION_START,
  requestDungeonAction,
} from "@/lib/events/action-transport";
import { applyCombatTargetsToCombatants } from "./combat-state";

interface Props {
  combatants: Array<{
    id: string;
    name: string;
    hp: number;
    maxHp: number;
    initiativeTotal: number;
    conditions: string[];
    isPlayer?: boolean;
  }>;
  activeTurnIndex: number;
  /** The player is at 0 HP (death-saves spec §7.4). */
  playerDown?: boolean;
  children?: ReactNode;
}

export default function CombatHUDController({
  combatants,
  activeTurnIndex,
  playerDown = false,
  children,
}: Props) {
  const [isPending, setIsPending] = useState(false);
  const [localCombatants, setLocalCombatants] = useState(combatants);
  const [localTurnIndex, setLocalTurnIndex] = useState(activeTurnIndex);
  const pendingRequests = useRef(new Set<string>());
  const latestProps = useRef({ combatants, activeTurnIndex });
  // Props that arrived while a request was pending, and whether the stream
  // changed local state since the current run of pending requests began.
  const syncDeferred = useRef(false);
  const streamChangedState = useRef(false);

  // Props are the server's snapshot. While a request is pending the stream is
  // newer than any snapshot that lands (it can be the previous action's
  // refresh), so the snapshot waits for the end of the request. Depending on
  // `isPending` here instead would apply it at the end event, which fires before
  // this request's own `router.refresh()` has landed, and show stale values.
  useEffect(() => {
    latestProps.current = { combatants, activeTurnIndex };
    if (pendingRequests.current.size > 0) {
      syncDeferred.current = true;
      return;
    }
    setLocalCombatants(combatants);
    setLocalTurnIndex(activeTurnIndex);
  }, [combatants, activeTurnIndex]);

  useEffect(() => {
    function handleActionStart(event: Event) {
      if (pendingRequests.current.size === 0) streamChangedState.current = false;
      pendingRequests.current.add((event as CustomEvent<{ requestId: string }>).detail?.requestId ?? "legacy");
      setIsPending(true);
    }

    function handleActionEnd(event: Event) {
      pendingRequests.current.delete((event as CustomEvent<{ requestId: string }>).detail?.requestId ?? "legacy");
      const stillPending = pendingRequests.current.size > 0;
      setIsPending(stillPending);

      if (stillPending || !syncDeferred.current) return;
      syncDeferred.current = false;
      // If the stream changed something, this request's own refresh is about to
      // bring the newer snapshot. If it changed nothing (a refused request has
      // no refresh), the snapshot that landed meanwhile is all there is.
      if (streamChangedState.current) return;
      setLocalCombatants(latestProps.current.combatants);
      setLocalTurnIndex(latestProps.current.activeTurnIndex);
    }

    function handleGameEvent(event: Event) {
      const { event: gameEvent } = (
        event as CustomEvent<{ event: GameEvent }>
      ).detail;

      if (gameEvent.type === "COMBAT_CONSEQUENCE") {
        streamChangedState.current = true;
        setLocalCombatants((current) =>
          applyCombatTargetsToCombatants(current, gameEvent.payload.targets)
        );
        return;
      }

      if (
        gameEvent.type === "TURN_ADVANCE" ||
        gameEvent.type === "ROUND_ADVANCE"
      ) {
        const nextTurnIndex = gameEvent.payload.nextTurnIndex;
        if (typeof nextTurnIndex === "number") {
          streamChangedState.current = true;
          setLocalTurnIndex(nextTurnIndex);
        }
      }
    }

    window.addEventListener(DUNGEON_ACTION_START, handleActionStart);
    window.addEventListener(DUNGEON_ACTION_END, handleActionEnd);
    window.addEventListener("dungeon-game-event", handleGameEvent);

    return () => {
      window.removeEventListener(DUNGEON_ACTION_START, handleActionStart);
      window.removeEventListener(DUNGEON_ACTION_END, handleActionEnd);
      window.removeEventListener("dungeon-game-event", handleGameEvent);
    };
  }, []);

  function handleAction(action: string) {
    if (isPending) return;
    requestDungeonAction({ action });
  }

  return (
    <CombatHUD
      combatants={localCombatants}
      activeTurnIndex={localTurnIndex}
      isPending={isPending}
      onActionTrigger={handleAction}
      playerDown={playerDown}
    >
      {children}
    </CombatHUD>
  );
}
