"use client";

import { useId, useRef, useCallback } from "react";
import { Clock, Heart, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { useModalFocus } from "@/lib/hooks/useModalFocus";
import type { RestFacts } from "@/lib/rules/rest-service";

export interface ShortRestCharacterData {
  name: string;
  hp: number;
  maxHp: number;
  hitDiceRemaining: number;
  hitDiceTotal: number;
  hitDie?: string;
  className?: string;
}

export interface ShortRestModalProps {
  isOpen: boolean;
  onClose: () => void;
  character: ShortRestCharacterData;
  onConfirm?: () => Promise<void> | void;
  isProcessing?: boolean;
  facts?: RestFacts | null;
  error?: string | null;
}

export function ShortRestModal({
  isOpen,
  onClose,
  character,
  onConfirm,
  isProcessing = false,
  facts,
  error,
}: ShortRestModalProps) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => {
    if (isProcessing) return;
    onClose();
  }, [isProcessing, onClose]);

  useModalFocus({
    open: isOpen,
    onClose: handleClose,
    dialogRef,
    initialFocusRef: facts ? closeButtonRef : confirmButtonRef,
    returnFocusRef: confirmButtonRef,
  });

  if (!isOpen) return null;

  async function handleConfirm() {
    if (isProcessing || !onConfirm) return;
    await onConfirm();
  }

  const noHitDiceRemaining = character.hitDiceRemaining <= 0;
  const isFullyHealed = character.hp >= character.maxHp;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/75"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-md space-y-5 rounded-xl border border-[var(--dc-border)] bg-[var(--dc-surface)] p-6 shadow-2xl text-[var(--dc-text)]"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[var(--dc-border)] pb-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--dc-border)] bg-[var(--dc-surface-raised)] text-[var(--dc-action)]">
            <Clock size={20} aria-hidden="true" />
          </div>
          <div>
            <h2 id={titleId} className="text-base font-semibold text-[var(--dc-text)]">
              Descanso corto
            </h2>
            <p id={descId} className="text-xs text-[var(--dc-text-muted)]">
              {character.name} · Al menos 1 hora de reposo
            </p>
          </div>
        </div>

        {/* Success State */}
        {facts ? (
          <div className="space-y-4">
            <StatusMessage tone="success" title="Descanso completado">
              <div className="space-y-2 text-xs">
                <p>
                  {facts.hpRecovered > 0 ? (
                    <>
                      Recuperados <strong>{facts.hpRecovered} PG</strong> (de {facts.hpBefore} a{" "}
                      {facts.hpAfter}).
                    </>
                  ) : (
                    <>Puntos de golpe sin cambios ({facts.hpAfter} PG).</>
                  )}
                </p>
                <p>
                  Dados de golpe gastados: <strong>{facts.hitDiceSpent}</strong> (restantes:{" "}
                  {facts.hitDiceRemainingAfter}).
                </p>
                {facts.slotsRestored && (
                  <p className="text-[var(--dc-action-hover)]">
                    Espacios de conjuro de pacto restaurados.
                  </p>
                )}
                {facts.exhaustionReduced > 0 && (
                  <p>Nivel de agotamiento reducido en {facts.exhaustionReduced}.</p>
                )}
              </div>
            </StatusMessage>

            <div className="flex justify-end pt-2">
              <Button ref={closeButtonRef} variant="primary" onClick={onClose}>
                Aceptar y cerrar
              </Button>
            </div>
          </div>
        ) : (
          /* Initial / Processing / Error State */
          <div className="space-y-4">
            {/* Status alerts */}
            {error && (
              <StatusMessage tone="error" title="No se pudo descansar">
                <p className="text-xs">{error}</p>
              </StatusMessage>
            )}

            {noHitDiceRemaining && !error && (
              <StatusMessage tone="warning" title="Sin dados de golpe">
                <p className="text-xs">
                  No te quedan dados de golpe disponibles para recuperar salud durante este
                  descanso.
                </p>
              </StatusMessage>
            )}

            {isFullyHealed && !noHitDiceRemaining && !error && (
              <StatusMessage tone="info" title="Salud máxima">
                <p className="text-xs">
                  Ya te encuentras en tu salud máxima ({character.maxHp} PG). No necesitarás gastar
                  dados de golpe adicionales.
                </p>
              </StatusMessage>
            )}

            {/* Character Resource Stats */}
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--dc-border)] bg-[var(--dc-surface-raised)] p-3">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-[var(--dc-text-muted)]">
                  <Heart size={14} className="text-[var(--dc-error)]" aria-hidden="true" />
                  <span>Puntos de golpe</span>
                </div>
                <p className="text-sm font-semibold text-[var(--dc-text)]">
                  {character.hp} / {character.maxHp} PG
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-[var(--dc-text-muted)]">
                  <Sparkles size={14} className="text-[var(--dc-action)]" aria-hidden="true" />
                  <span>Dados de golpe</span>
                </div>
                <p className="text-sm font-semibold text-[var(--dc-text)]">
                  {character.hitDiceRemaining} / {character.hitDiceTotal}
                  {character.hitDie ? (
                    <span className="ml-1 text-xs font-normal text-[var(--dc-text-muted)]">
                      ({character.hitDie})
                    </span>
                  ) : null}
                </p>
              </div>
            </div>

            <p className="text-xs text-[var(--dc-text-muted)]">
              Durante un descanso corto, puedes gastar uno o más Dados de Golpe para recuperar puntos
              de golpe, además de restaurar ciertas habilidades de clase.
            </p>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="ghost"
                disabled={isProcessing}
                onClick={handleClose}
              >
                Cancelar
              </Button>
              <Button
                ref={confirmButtonRef}
                variant="primary"
                loading={isProcessing}
                disabled={isProcessing}
                onClick={handleConfirm}
              >
                Confirmar descanso
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ShortRestModal;
