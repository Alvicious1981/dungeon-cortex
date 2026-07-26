import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonClassName } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";

export default function NotFound() {
  return (
    <main className="dc-page-shell flex items-center justify-center p-4">
      <Panel
        aria-labelledby="not-found-title"
        className="w-full max-w-lg p-6 text-center sm:p-8"
      >
        <p className="dc-kicker">Ruta no encontrada</p>
        <h1 id="not-found-title" className="dc-heading mt-3 text-3xl font-semibold">
          Este registro no existe.
        </h1>
        <p className="dc-copy mt-4 leading-7">
          La página solicitada no está disponible o su dirección ha cambiado.
          No se ha modificado ningún estado de campaña.
        </p>
        <Link
          href="/"
          className={buttonClassName({ variant: "secondary", className: "mt-6" })}
        >
          <ArrowLeft aria-hidden="true" size={18} />
          Volver al inicio
        </Link>
      </Panel>
    </main>
  );
}
