"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  FileUp,
  History,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  RotateCcw,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import {
  CHARACTER_FIELD_LABELS,
  CHARACTER_FIELD_LIMITS,
  CHARACTER_EDITABLE_FIELDS,
  type CharacterAuditDto,
  type CharacterChangeProposalDto,
  type CharacterEditableField,
  type CharacterEditableSnapshot,
} from "@/lib/character-sheet/contracts";

interface CharacterProfileEditorProps {
  characterId: string;
  initialSnapshot: CharacterEditableSnapshot;
  nameLocked: boolean;
  mode: "profile" | "history";
  onSnapshotChange(snapshot: CharacterEditableSnapshot): void;
}

interface ApiErrorBody {
  error?: string;
  code?: string;
}

function operationKey(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  const fallback = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${uuid ?? fallback}`;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as ApiErrorBody;
  if (!response.ok) throw new Error(body.error ?? "La operación no pudo completarse.");
  return body as T;
}

function truncate(value: string, max = 180): string {
  return value.length > max ? `${value.slice(0, max)}...` : value || "Sin contenido";
}

export default function CharacterProfileEditor({
  characterId,
  initialSnapshot,
  nameLocked,
  mode,
  onSnapshotChange,
}: CharacterProfileEditorProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [editing, setEditing] = useState<CharacterEditableField | null>(null);
  const [draft, setDraft] = useState("");
  const [aiInstruction, setAiInstruction] = useState("");
  const [proposals, setProposals] = useState<CharacterChangeProposalDto[]>([]);
  const [history, setHistory] = useState<CharacterAuditDto[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const publishSnapshot = useCallback((next: CharacterEditableSnapshot) => {
    setSnapshot(next);
    onSnapshotChange(next);
  }, [onSnapshotChange]);

  const refreshActivity = useCallback(async () => {
    const [nextProposals, nextHistory] = await Promise.all([
      jsonRequest<CharacterChangeProposalDto[]>(`/api/character/${characterId}/proposals`),
      jsonRequest<CharacterAuditDto[]>(`/api/character/${characterId}/history`),
    ]);
    setProposals(nextProposals);
    setHistory(nextHistory);
  }, [characterId]);

  useEffect(() => {
    void refreshActivity().catch((error) => {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo cargar la actividad." });
    });
  }, [refreshActivity]);

  function beginEdit(field: CharacterEditableField) {
    setEditing(field);
    setDraft(snapshot[field]);
    setAiInstruction("");
    setMessage(null);
  }

  async function saveManual() {
    if (!editing) return;
    setBusy(`save:${editing}`);
    setMessage(null);
    try {
      const result = await jsonRequest<{ snapshot: CharacterEditableSnapshot }>(`/api/character/${characterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: snapshot.revision,
          idempotencyKey: operationKey("manual"),
          change: { field: editing, value: draft },
          reason: "Edición manual desde la hoja",
        }),
      });
      publishSnapshot(result.snapshot);
      setEditing(null);
      setMessage({ tone: "success", text: "Cambio guardado." });
      await refreshActivity();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo guardar." });
    } finally {
      setBusy(null);
    }
  }

  async function requestAiProposal() {
    if (!editing || !aiInstruction.trim()) return;
    setBusy(`ai:${editing}`);
    setMessage(null);
    try {
      const result = await jsonRequest<{ proposal: CharacterChangeProposalDto }>(`/api/character/${characterId}/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: snapshot.revision,
          idempotencyKey: operationKey("ai"),
          field: editing,
          instruction: aiInstruction,
        }),
      });
      setProposals((current) => [result.proposal, ...current.filter((item) => item.proposalId !== result.proposal.proposalId)]);
      setEditing(null);
      setMessage({ tone: "success", text: "Propuesta preparada para revisión." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "La IA no pudo preparar la propuesta." });
    } finally {
      setBusy(null);
    }
  }

  async function decideProposal(proposalId: string, decision: "accept" | "reject") {
    setBusy(`${decision}:${proposalId}`);
    setMessage(null);
    try {
      const result = await jsonRequest<{ snapshot?: CharacterEditableSnapshot }>(
        `/api/character/${characterId}/proposals/${proposalId}/${decision}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idempotencyKey: operationKey(decision) }),
        }
      );
      if (result.snapshot) publishSnapshot(result.snapshot);
      setMessage({ tone: "success", text: decision === "accept" ? "Propuesta aplicada." : "Propuesta rechazada." });
      await refreshActivity();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo resolver la propuesta." });
    } finally {
      setBusy(null);
    }
  }

  async function undoEvent(auditId: string) {
    setBusy(`undo:${auditId}`);
    setMessage(null);
    try {
      const result = await jsonRequest<{ snapshot: CharacterEditableSnapshot }>(
        `/api/character/${characterId}/history/${auditId}/undo`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedVersion: snapshot.revision, idempotencyKey: operationKey("undo") }),
        }
      );
      publishSnapshot(result.snapshot);
      setMessage({ tone: "success", text: "Se creó un cambio de deshacer." });
      await refreshActivity();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo deshacer." });
    } finally {
      setBusy(null);
    }
  }

  async function importPdf(file: File) {
    setBusy("pdf-import");
    setMessage(null);
    const form = new FormData();
    form.set("file", file);
    form.set("expectedVersion", String(snapshot.revision));
    form.set("idempotencyKey", operationKey("pdf"));
    try {
      const result = await jsonRequest<{ proposal: CharacterChangeProposalDto }>(
        `/api/character/${characterId}/pdf/import`,
        { method: "POST", body: form }
      );
      setProposals((current) => [result.proposal, ...current.filter((item) => item.proposalId !== result.proposal.proposalId)]);
      setMessage({ tone: "success", text: "PDF leído. Revisa la propuesta antes de aplicarla." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "No se pudo importar el PDF." });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      setBusy(null);
    }
  }

  const pendingProposals = proposals.filter((proposal) => proposal.status === "PENDING");

  if (mode === "history") {
    return (
      <section aria-labelledby="character-history-title">
        <h3 id="character-history-title" className="mb-4 flex items-center gap-2 text-base font-semibold text-neutral-100">
          <History size={18} aria-hidden="true" /> Historial de cambios
        </h3>
        {message && <StatusMessage {...message} />}
        {history.length === 0 ? (
          <p className="text-sm text-neutral-400">No hay cambios registrados.</p>
        ) : (
          <ol className="divide-y divide-neutral-800 border-y border-neutral-800">
            {history.map((event) => (
              <li key={event.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-neutral-100">{CHARACTER_FIELD_LABELS[event.field]}</strong>
                    <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-xs text-neutral-400">{event.source}</span>
                    <time className="text-xs text-neutral-500">{new Date(event.createdAt).toLocaleString("es-ES")}</time>
                  </div>
                  <p className="mt-2 text-sm text-neutral-400"><span className="text-rose-300">Antes:</span> {truncate(event.previousValue)}</p>
                  <p className="mt-1 text-sm text-neutral-300"><span className="text-emerald-300">Después:</span> {truncate(event.newValue)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void undoEvent(event.id)}
                  disabled={!event.canUndo || busy !== null}
                  className="flex h-11 items-center justify-center gap-2 rounded-md border border-neutral-700 px-3 text-sm text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  title={event.canUndo ? "Deshacer mediante un nuevo cambio" : "Existe un cambio posterior en este campo"}
                >
                  {busy === `undo:${event.id}` ? <LoaderCircle className="animate-spin" size={17} /> : <RotateCcw size={17} />}
                  Deshacer
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-neutral-100">Perfil editable</h3>
          <p className="text-xs text-neutral-500">Versión {snapshot.revision}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/character/${characterId}/pdf`}
            className="flex h-11 items-center gap-2 rounded-md border border-neutral-700 px-3 text-sm text-neutral-200 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <Download size={17} aria-hidden="true" /> Exportar PDF
          </a>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy !== null}
            className="flex h-11 items-center gap-2 rounded-md border border-neutral-700 px-3 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            {busy === "pdf-import" ? <LoaderCircle className="animate-spin" size={17} /> : <FileUp size={17} />}
            Importar PDF
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importPdf(file);
            }}
          />
        </div>
      </div>

      {message && <StatusMessage {...message} />}

      <div className="grid gap-3 md:grid-cols-2">
        {CHARACTER_EDITABLE_FIELDS.map((field) => {
          const isEditing = editing === field;
          const locked = field === "name" && nameLocked;
          return (
            <section key={field} className={`border border-neutral-800 bg-neutral-900/60 p-4 ${field === "backstory" ? "md:col-span-2" : ""}`}>
              <div className="flex min-h-11 items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-neutral-100">{CHARACTER_FIELD_LABELS[field]}</h4>
                  <p className="text-xs text-neutral-500">{snapshot[field].length}/{CHARACTER_FIELD_LIMITS[field]}</p>
                </div>
                <button
                  type="button"
                  onClick={() => beginEdit(field)}
                  disabled={locked || (editing !== null && !isEditing)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  aria-label={`Editar ${CHARACTER_FIELD_LABELS[field]}`}
                  title={locked ? "Bloqueado durante un encuentro activo" : `Editar ${CHARACTER_FIELD_LABELS[field]}`}
                >
                  {locked ? <LockKeyhole size={18} aria-hidden="true" /> : <Pencil size={18} aria-hidden="true" />}
                </button>
              </div>

              {locked && <p className="mt-1 text-xs text-amber-300">Bloqueado durante el encuentro activo.</p>}

              {isEditing ? (
                <div className="mt-3 space-y-3">
                  {field === "name" ? (
                    <input
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      maxLength={CHARACTER_FIELD_LIMITS[field]}
                      className="min-h-11 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                      aria-label={CHARACTER_FIELD_LABELS[field]}
                    />
                  ) : (
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      maxLength={CHARACTER_FIELD_LIMITS[field]}
                      rows={field === "backstory" ? 10 : 5}
                      className="w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 p-3 text-sm leading-6 text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                      aria-label={CHARACTER_FIELD_LABELS[field]}
                    />
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      disabled={busy !== null}
                      className="flex h-11 items-center gap-2 rounded-md px-3 text-sm text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                    >
                      <X size={17} aria-hidden="true" /> Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveManual()}
                      disabled={busy !== null}
                      className="flex h-11 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                    >
                      {busy === `save:${field}` ? <LoaderCircle className="animate-spin" size={17} /> : <Save size={17} />}
                      Guardar
                    </button>
                  </div>
                  <div className="border-t border-neutral-800 pt-3">
                    <label className="text-xs font-medium text-neutral-300" htmlFor={`ai-${field}`}>Ayuda de IA</label>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <input
                        id={`ai-${field}`}
                        value={aiInstruction}
                        onChange={(event) => setAiInstruction(event.target.value)}
                        maxLength={1_000}
                        className="min-h-11 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                      />
                      <button
                        type="button"
                        onClick={() => void requestAiProposal()}
                        disabled={busy !== null || !aiInstruction.trim()}
                        className="flex h-11 items-center justify-center gap-2 rounded-md bg-cyan-800 px-3 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                      >
                        {busy === `ai:${field}` ? <LoaderCircle className="animate-spin" size={17} /> : <Sparkles size={17} />}
                        Proponer
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-neutral-300">{snapshot[field] || "Sin contenido"}</p>
              )}
            </section>
          );
        })}
      </div>

      <section aria-labelledby="pending-proposals-title">
        <h3 id="pending-proposals-title" className="mb-3 flex items-center gap-2 text-base font-semibold text-neutral-100">
          <Sparkles size={18} aria-hidden="true" /> Propuestas pendientes
        </h3>
        {pendingProposals.length === 0 ? (
          <p className="text-sm text-neutral-400">No hay propuestas pendientes.</p>
        ) : (
          <div className="space-y-3">
            {pendingProposals.map((proposal) => (
              <article key={proposal.proposalId} className="border border-cyan-800/60 bg-cyan-950/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm text-cyan-100">{proposal.actor === "AI" ? "Propuesta de IA" : "Importación PDF"}</strong>
                  <time className="text-xs text-neutral-500">{new Date(proposal.createdAt).toLocaleString("es-ES")}</time>
                </div>
                <p className="mt-2 text-sm text-neutral-300">{proposal.reason}</p>
                <div className="mt-3 divide-y divide-neutral-800 border-y border-neutral-800">
                  {proposal.changes.map((change) => {
                    const previous = proposal.previousValues.find((entry) => entry.field === change.field)?.value ?? "";
                    return (
                      <div key={change.field} className="grid gap-2 py-3 sm:grid-cols-2">
                        <div><span className="text-xs font-medium text-rose-300">Actual · {CHARACTER_FIELD_LABELS[change.field]}</span><p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-400">{truncate(previous, 500)}</p></div>
                        <div><span className="text-xs font-medium text-emerald-300">Propuesto · {CHARACTER_FIELD_LABELS[change.field]}</span><p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-200">{truncate(change.value, 500)}</p></div>
                      </div>
                    );
                  })}
                </div>
                {proposal.warnings.length > 0 && (
                  <ul className="mt-3 list-inside list-disc text-xs text-amber-200">
                    {proposal.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                )}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void decideProposal(proposal.proposalId, "reject")}
                    disabled={busy !== null}
                    className="flex h-11 items-center gap-2 rounded-md border border-neutral-700 px-3 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                  >
                    <X size={17} aria-hidden="true" /> Rechazar
                  </button>
                  <button
                    type="button"
                    onClick={() => void decideProposal(proposal.proposalId, "accept")}
                    disabled={busy !== null}
                    className="flex h-11 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                  >
                    {busy === `accept:${proposal.proposalId}` ? <LoaderCircle className="animate-spin" size={17} /> : <Check size={17} />}
                    Aceptar
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusMessage({ tone, text }: { tone: "success" | "error"; text: string }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`mb-4 border px-3 py-2 text-sm ${
        tone === "error"
          ? "border-rose-700 bg-rose-950/30 text-rose-100"
          : "border-emerald-700 bg-emerald-950/30 text-emerald-100"
      }`}
    >
      {text}
    </div>
  );
}
