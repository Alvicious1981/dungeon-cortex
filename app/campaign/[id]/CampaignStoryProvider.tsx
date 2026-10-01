"use client";

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameEvent } from "@/lib/events/game-events";

/** Presentation only: these are received frames, never reconstructed game facts. */
export interface LiveStoryEntry {
  requestId: string;
  action: string;
  baselineIds: Set<string>;
  afterLog?: { id: string; createdAt: string };
  events: GameEvent[];
  narrative: string;
  status: "receiving" | "received" | "uncertain" | "refused";
}

interface StoryActions {
  rememberLogs(logs: Array<{ id: string; createdAt: string }>): void;
  begin(requestId: string, action: string): void;
  event(requestId: string, event: GameEvent, index: number): void;
  text(requestId: string, text: string): void;
  finish(requestId: string, status: LiveStoryEntry["status"]): void;
}

const StoryContext = createContext<{ entries: LiveStoryEntry[]; actions: StoryActions } | null>(null);

export function CampaignStoryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<LiveStoryEntry[]>([]);
  const knownIds = useRef(new Set<string>());
  const newestLog = useRef<{ id: string; createdAt: string } | undefined>(undefined);
  const actions = useMemo<StoryActions>(() => {
    function update(requestId: string, transform: (entry: LiveStoryEntry) => LiveStoryEntry) {
      setEntries((current) => current.map((entry) => entry.requestId === requestId ? transform(entry) : entry));
    }
    return {
      rememberLogs(logs) {
        knownIds.current = new Set(logs.map((log) => log.id));
        newestLog.current = logs[logs.length - 1];
      },
      begin(requestId, action) {
        const baselineIds = new Set(knownIds.current);
        const afterLog = newestLog.current;
        setEntries((current) => {
          if (current.some((entry) => entry.requestId === requestId)) {
            // An explicit retry keeps already received facts visible. Replayed
            // events replace their original positions instead of duplicating.
            return current.map((entry) => entry.requestId === requestId ? { ...entry, status: "receiving" } : entry);
          }
          return [...current, { requestId, action, baselineIds, afterLog, events: [], narrative: "", status: "receiving" }];
        });
      },
      event(requestId, event, index) {
        update(requestId, (entry) => {
          const events = [...entry.events];
          events[index] = event;
          return { ...entry, events };
        });
      },
      text(requestId, narrative) { update(requestId, (entry) => ({ ...entry, narrative })); },
      finish(requestId, status) { update(requestId, (entry) => ({ ...entry, status })); },
    };
  }, []);
  return <StoryContext.Provider value={{ entries, actions }}>{children}</StoryContext.Provider>;
}

/** Optional so the transport and historical log remain independently usable. */
export function useCampaignStory() { return useContext(StoryContext); }
