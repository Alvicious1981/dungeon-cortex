"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CircleAlert, RotateCcw } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/Button";

export default function CampaignError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Campaign Segment Error Boundary caught:", error);
  }, [error]);

  return (
    <main className="dc-page-shell flex min-h-screen items-center justify-center p-4">
      <section
        role="alert"
        aria-labelledby="campaign-error-title"
        className="dc-panel w-full max-w-lg p-6 sm:p-8"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--dc-error)_55%,var(--dc-border))] bg-[color-mix(in_srgb,var(--dc-error)_12%,transparent)] text-[var(--dc-error)]">
          <CircleAlert aria-hidden="true" size={23} />
        </span>
        <p className="dc-kicker mt-5">Interrupción recuperable</p>
        <h1
          id="campaign-error-title"
          className="dc-heading mt-2 text-2xl font-semibold"
        >
          No se pudo abrir la campaña
        </h1>
        <p className="dc-copy mt-4 text-base leading-7">
          No ha sido posible leer esta campaña de forma segura. Puedes
          reintentar la solicitud o volver al inicio. La interfaz no inventará
          resultados mientras el estado autoritativo no esté disponible.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Button type="button" onClick={reset}>
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
      </section>
    </main>
  );
}
