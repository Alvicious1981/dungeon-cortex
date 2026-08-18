"use client";

import { useEffect } from "react";
import Link from "next/link";

import { OnboardingShell } from "@/components/layouts/OnboardingShell";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { Button } from "@/components/ui/Button";
import { buttonClassName } from "@/components/ui/Button";

export default function CampaignsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Campaigns library error boundary caught:", error);
  }, [error]);

  return (
    <OnboardingShell
      eyebrow="Biblioteca"
      title="Tus campañas"
      description="Retoma una crónica en curso o empieza una nueva. Cada campaña conserva su personaje, su estado y su historia."
    >
      <div className="flex flex-col gap-4">
        <StatusMessage tone="error" title="No se ha podido cargar la lista">
          <p>
            No hemos conseguido leer tus campañas. Ninguna se ha perdido: siguen
            guardadas tal y como estaban.
          </p>
        </StatusMessage>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={() => reset()} className="sm:px-6">
            Reintentar
          </Button>
          <Link href="/" className={buttonClassName({ variant: "secondary", className: "sm:px-6" })}>
            Volver al inicio
          </Link>
        </div>
      </div>
    </OnboardingShell>
  );
}
