"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpenText, History, LockKeyhole, PencilLine, Shield, User, X } from "lucide-react";
import CharacterSheetVTT, { type CharacterSheetProps } from "./CharacterSheetVTT";
import CharacterProfileEditor from "./sheet/CharacterProfileEditor";
import type { CharacterEditableSnapshot } from "@/lib/character-sheet/contracts";
import { useModalFocus } from "@/lib/hooks/useModalFocus";
import { DUNGEON_OPEN_CHARACTER, prepareDungeonAction } from "@/lib/events/campaign-ui";
import EquipmentTab from "./sheet/EquipmentTab";

interface CharacterSheetControllerProps {
  sheet: CharacterSheetProps;
  profile: CharacterEditableSnapshot;
  nameLocked: boolean;
}

type SheetTab = "mechanics" | "equipment" | "profile" | "history";

const tabs: Array<{ id: SheetTab; label: string; icon: typeof User }> = [
  { id: "mechanics", label: "Mecánica", icon: LockKeyhole },
  { id: "equipment", label: "Equipo", icon: Shield },
  { id: "profile", label: "Perfil", icon: PencilLine },
  { id: "history", label: "Historial", icon: History },
];

export default function CharacterSheetController({
  sheet,
  profile: initialProfile,
  nameLocked,
}: CharacterSheetControllerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<SheetTab>("mechanics");
  const [profile, setProfile] = useState(initialProfile);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pendingActionRef = useRef<string | null>(null);
  const closeSheet = useCallback(() => setIsOpen(false), []);
  useModalFocus({ open: isOpen, onClose: closeSheet, dialogRef, initialFocusRef: closeRef, returnFocusRef });

  useEffect(() => {
    const openSheet = (event: Event) => {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : triggerRef.current;
      if ((event as CustomEvent<{ tab?: string }>).detail?.tab === "equipment") setTab("equipment");
      setIsOpen(true);
    };
    window.addEventListener(DUNGEON_OPEN_CHARACTER, openSheet);
    return () => window.removeEventListener(DUNGEON_OPEN_CHARACTER, openSheet);
  }, []);

  useEffect(() => {
    if (!isOpen && pendingActionRef.current) {
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      // The modal has released focus before the action input receives this intent.
      prepareDungeonAction(action);
    }
  }, [isOpen]);

  const currentSheet: CharacterSheetProps = {
    ...sheet,
    identity: { ...sheet.identity, name: profile.name },
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => { returnFocusRef.current = event.currentTarget; setIsOpen(true); }}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-amber-300/30 bg-amber-700/20 px-3 text-sm font-medium text-amber-100 hover:bg-amber-700/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        aria-label="Abrir hoja de personaje"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <BookOpenText className="h-5 w-5" aria-hidden="true" />
        Personaje
      </button>

      {isOpen && createPortal(
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="character-sheet-dialog-title"
          tabIndex={-1}
          className="fixed inset-0 z-50 bg-black/85 sm:p-4"
        >
          <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden border border-neutral-700 bg-neutral-950 shadow-2xl sm:h-[calc(100vh-2rem)] sm:rounded-lg">
            <header className="flex min-h-16 items-center gap-3 border-b border-neutral-800 px-4">
              <div className="min-w-0 flex-1">
                <h2 id="character-sheet-dialog-title" className="truncate text-lg font-semibold text-neutral-50">
                  {profile.name}
                </h2>
                <p className="truncate text-sm text-neutral-400">
                  Nivel {sheet.identity.level} · {sheet.identity.race} · {sheet.identity.className}
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={closeSheet}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                aria-label="Cerrar hoja"
                title="Cerrar"
              >
                <X aria-hidden="true" />
              </button>
            </header>

            <nav className="grid grid-cols-4 border-b border-neutral-800" aria-label="Secciones de la hoja">
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`flex min-h-12 flex-col items-center justify-center gap-1 border-b-2 px-1 py-2 text-xs font-medium sm:flex-row sm:gap-2 sm:px-3 sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300 ${
                    tab === id
                      ? "border-amber-400 bg-amber-400/10 text-amber-100"
                      : "border-transparent text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
                  }`}
                  aria-current={tab === id ? "page" : undefined}
                >
                  <Icon size={17} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
              {tab === "mechanics" ? (
                <div>
                  <div className="mb-3 flex items-center gap-2 text-sm text-neutral-400">
                    <LockKeyhole size={16} aria-hidden="true" />
                    <span>Consulta los valores actuales de tu personaje.</span>
                  </div>
                  <CharacterSheetVTT {...currentSheet} />
                </div>
              ) : tab === "equipment" ? (
                <EquipmentTab items={sheet.inventory} onPrepare={(action) => {
                  pendingActionRef.current = action;
                  closeSheet();
                }} />
              ) : (
                <CharacterProfileEditor
                  characterId={profile.id}
                  initialSnapshot={profile}
                  nameLocked={nameLocked}
                  mode={tab}
                  onSnapshotChange={setProfile}
                />
              )}
            </div>
          </div>
        </div>, document.body
      )}
    </>
  );
}
