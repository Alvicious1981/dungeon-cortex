"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CircleAlert, RotateCcw } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { StatusMessage } from "@/components/ui/StatusMessage";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Registro para diagnóstico; no se muestra al jugador.
    console.error("Root Error Boundary caught:", error);
  }, [error]);

  return (
    <main className="dc-page-shell flex min-h-screen items-center justify-center p-4">
      <Panel
        aria-labelledby="root-error-title"
        className="w-full max-w-lg p-6 sm:p-8"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--dc-error)_55%,var(--dc-border))] bg-[color-mix(in_srgb,var(--dc-error)_12%,transparent)] text-[var(--dc-error)]">
          <CircleAlert aria-hidden="true" size={23} />
        </span>
        <p className="dc-kicker mt-5">Interrupción recuperable</p>
        <h1 id="root-error-title" className="dc-heading mt-2 text-2xl font-semibold">
          Se ha roto el hilo
        </h1>

        <StatusMessage tone="error" title="No se pudo preparar esta pantalla" className="mt-5">
          <p>
            Tu partida no se ha perdido: sigue guardada tal y como estaba.
            Puedes reintentar aquí mismo o volver al inicio.
          </p>
        </StatusMessage>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Button
            type="button"
            onClick={reset}
          >
            <RotateCcw aria-hidden="true" size={17} />
            Reintentar
          </Button>
          <Link
            href="/"
            className={buttonClassName({ variant: "secondary" })}
          >
            Volver al inicio
          </Link>
        </div>
      </Panel>
    </main>
  );
}
