"use client";

import { useEffect, useState } from "react";
import DialogueOverlay from "./DialogueOverlay";

/**
 * DialogueOverlayController.tsx — Milestone N: Slice 3
 *
 * The bridging component between the AI Narrator (via ActionInput SSE)
 * and the DialogueOverlay UI.
 *
 * Responsibilities:
 *  - Opens the overlay when the NPC roster dispatches `dungeon-npc-selected`.
 *  - Accumulates narrative tokens into `narrationText`.
 *  - Dispatches social intents as natural-language actions.
 */

/**
 * Detail carried by the `dungeon-npc-selected` window CustomEvent, dispatched
 * by NPCRoster when a player activates an NPC row.
 */
interface NpcSelectedDetail {
  npcId: string;
  name: string;
  disposition: number | null;
  hasMetPlayer: boolean;
}

/** Shape DialogueOverlay expects for the NPC it is rendering. */
interface DialogueNpc {
  id: string;
  name: string;
  race: string | null;
  profession: string | null;
  disposition: number | null;
  personalityTags: {
    motivation: string;
    secret: string;
    distinctiveTrait: string;
  } | null;
  hasMetPlayer: boolean;
}

/** Facts the social route resolves and returns; rendered verbatim, never narrated. */
export interface SocialCheckDisplay {
  approach: "persuade" | "intimidate" | "deceive";
  skill: string;
  roll: number;
  total: number;
  dc: number;
  success: boolean;
  attitudeBefore: string;
  attitudeAfter: string;
  dispositionBefore: number;
  dispositionAfter: number;
}

interface Props {
  campaignId: string;
  characterId: string;
}

export default function DialogueOverlayController({ campaignId, characterId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [npc, setNpc] = useState<DialogueNpc | null>(null);
  const [narrationText, setNarrationText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<SocialCheckDisplay | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 1. Open dialogue when the roster selects an NPC
    function handleNpcSelected(e: Event) {
      const customEvent = e as CustomEvent<NpcSelectedDetail>;
      const { npcId, name, disposition, hasMetPlayer } = customEvent.detail;
      setNpc({
        id: npcId,
        name,
        race: null,
        profession: null,
        disposition,
        personalityTags: null,
        hasMetPlayer,
      });
      setIsOpen(true);
      setNarrationText(""); // Clear for new conversation
      setResult(null); // Clear the prior check's facts for a new conversation
      setError(null); // Clear any error from a prior conversation
    }

    // 2. Accumulate narrative tokens
    function handleToken(e: Event) {
      const customEvent = e as CustomEvent<{ chunk: string }>;
      setNarrationText(prev => prev + customEvent.detail.chunk);
    }

    // 3. Track loading state from ActionInput
    function handleActionStart() {
      setIsLoading(true);
      setNarrationText(""); // Clear for new turn
    }
    
    // We listen to the window's broadcast of "done" (implicitly via router.refresh in ActionInput,
    // but better to have a direct event if possible. For now, ActionInput manages isLoading.)
    // Actually, let's just listen for tokens. If tokens are flowing, we are loading.
    // Better: listen for the end of the stream.
    function handleActionEnd() {
      setIsLoading(false);
    }

    window.addEventListener("dungeon-npc-selected", handleNpcSelected);
    window.addEventListener("dungeon-token", handleToken);
    window.addEventListener("dungeon-action-start", handleActionStart);
    window.addEventListener("dungeon-action-end", handleActionEnd);

    return () => {
      window.removeEventListener("dungeon-npc-selected", handleNpcSelected);
      window.removeEventListener("dungeon-token", handleToken);
      window.removeEventListener("dungeon-action-start", handleActionStart);
      window.removeEventListener("dungeon-action-end", handleActionEnd);
    };
  }, []);

  if (!isOpen || !npc) return null;

  // Backend code owns mechanical truth: this posts who, which approach, and
  // what the player wants. It never sends (or computes) a roll, a DC, or a
  // disposition — those come back from the route, and are rendered as-is.
  const resolveSocial = async (
    approach: "persuade" | "intimidate" | "deceive",
    intent: string
  ) => {
    if (!npc) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/campaign/${campaignId}/social`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ npcId: npc.id, approach, intent }),
      });
      if (!response.ok) {
        let message = "Something went wrong resolving that.";
        try {
          const body = await response.json();
          if (body && typeof body.error === "string") message = body.error;
        } catch {
          // Body wasn't JSON, or was empty — keep the generic fallback.
        }
        setError(message);
        return;
      }
      const facts = (await response.json()) as SocialCheckDisplay;
      setResult(facts);
      setNpc((prev) => (prev ? { ...prev, disposition: facts.dispositionAfter, hasMetPlayer: true } : prev));
    } catch {
      // Network failure, or fetch rejected for any other reason: the player
      // still deserves feedback rather than a click that silently did nothing.
      setError("Could not reach the server. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialIntent = (approach: "persuade" | "intimidate" | "deceive") => {
    void resolveSocial(approach, "");
  };

  const handleSpeak = (words: string, approach: "persuade" | "intimidate" | "deceive") => {
    void resolveSocial(approach, words);
  };

  const handleAskRumors = () => {
    // No backend route resolves this yet; nothing to post and nothing to
    // narrate without a resolved fact to render.
  };

  const handleApproach = () => {
    // Establishes first contact and resolves in the same call — the route
    // flips hasMetPlayer and returns dispositionAfter, which moves the
    // overlay into its "met" branch on the next render.
    void resolveSocial("persuade", "");
  };

  return (
    <DialogueOverlay
      npc={npc}
      narrationText={narrationText}
      characterId={characterId}
      result={result}
      error={error}
      onSpeak={handleSpeak}
      onSocialIntent={handleSocialIntent}
      onAskRumors={handleAskRumors}
      onApproach={handleApproach}
      onClose={() => {
        setIsOpen(false);
        setNpc(null);
      }}
      isLoading={isLoading}
    />
  );
}
