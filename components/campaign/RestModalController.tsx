"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ShortRestModal, { type ShortRestCharacterData } from "./ShortRestModal";
import LongRestModal, { type LongRestCharacterData } from "./LongRestModal";
import { DUNGEON_OPEN_SHORT_REST, DUNGEON_OPEN_LONG_REST } from "@/lib/events/campaign-ui";
import type { RestFacts } from "@/lib/rules/rest-service";

export type RestCharacterPayload = ShortRestCharacterData & LongRestCharacterData;

export interface RestModalControllerProps {
  campaignId: string;
  character: RestCharacterPayload;
  inCombat?: boolean;
}

export function RestModalController({
  campaignId,
  character,
  inCombat = false,
}: RestModalControllerProps) {
  const router = useRouter();
  const [activeModal, setActiveModal] = useState<"short" | "long" | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [facts, setFacts] = useState<RestFacts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleOpenShort() {
      if (inCombat) {
        setActiveModal("short");
        setError("No puedes descansar durante un encuentro activo.");
        setFacts(null);
        return;
      }
      setActiveModal("short");
      setFacts(null);
      setError(null);
    }

    function handleOpenLong() {
      if (inCombat) {
        setActiveModal("long");
        setError("No puedes descansar durante un encuentro activo.");
        setFacts(null);
        return;
      }
      setActiveModal("long");
      setFacts(null);
      setError(null);
    }

    window.addEventListener(DUNGEON_OPEN_SHORT_REST, handleOpenShort);
    window.addEventListener(DUNGEON_OPEN_LONG_REST, handleOpenLong);
    return () => {
      window.removeEventListener(DUNGEON_OPEN_SHORT_REST, handleOpenShort);
      window.removeEventListener(DUNGEON_OPEN_LONG_REST, handleOpenLong);
    };
  }, [inCombat]);

  const handleClose = useCallback(() => {
    if (isProcessing) return;
    setActiveModal(null);
    setFacts(null);
    setError(null);
  }, [isProcessing]);

  const handleConfirm = useCallback(async () => {
    if (isProcessing || !activeModal) return;
    setIsProcessing(true);
    setError(null);

    try {
      const res = await fetch(`/api/campaign/${campaignId}/rest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: activeModal }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "No se pudo completar el descanso.");
        setIsProcessing(false);
        return;
      }

      const result = (await res.json()) as RestFacts;
      setFacts(result);
      setIsProcessing(false);
      router.refresh();
    } catch {
      setError("Error de conexión al procesar el descanso.");
      setIsProcessing(false);
    }
  }, [activeModal, campaignId, isProcessing, router]);

  if (!activeModal) return null;

  if (activeModal === "short") {
    return (
      <ShortRestModal
        isOpen={true}
        onClose={handleClose}
        character={character}
        onConfirm={handleConfirm}
        isProcessing={isProcessing}
        facts={facts}
        error={error}
      />
    );
  }

  return (
    <LongRestModal
      isOpen={true}
      onClose={handleClose}
      character={character}
      onConfirm={handleConfirm}
      isProcessing={isProcessing}
      facts={facts}
      error={error}
    />
  );
}

export default RestModalController;
