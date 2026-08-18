"use client";

import { useEffect } from "react";
import Link from "next/link";

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
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4 text-center"
      style={{ background: "#070710", color: "#E2D9C5", fontFamily: "var(--font-cinzel), serif" }}
    >
      <div 
        className="max-w-md space-y-6 rounded-lg p-8"
        style={{
          background: "rgba(12,12,22,0.92)",
          border: "1px solid rgba(228,168,50,0.2)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
        }}
      >
        <div 
          className="mx-auto w-16 h-16 flex items-center justify-center rounded-full mb-4"
          style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)" }}
        >
          <span className="text-3xl" aria-hidden="true">⚠️</span>
        </div>
        
        <h1 
          className="text-2xl font-bold uppercase tracking-widest"
          style={{ color: "#E8C84A" }}
        >
          Se ha roto el hilo
        </h1>
        
        <p 
          className="text-sm"
          style={{ fontFamily: "var(--font-crimson), serif", color: "#C8B898", lineHeight: "1.6" }}
        >
          Algo ha fallado al preparar esta pantalla y no hemos podido mostrarla. Tu partida no se ha perdido: sigue guardada tal y como estaba. Puedes reintentar aquí mismo o volver al inicio.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 pt-4">
          <button
            onClick={() => reset()}
            className="flex-1 py-2 px-4 rounded text-sm font-semibold uppercase tracking-wider transition-colors"
            style={{ 
              background: "rgba(245,158,11,0.15)", 
              color: "#F59E0B",
              border: "1px solid rgba(245,158,11,0.3)"
            }}
          >
            Reintentar
          </button>
          <Link
            href="/"
            className="flex-1 py-2 px-4 rounded text-sm font-semibold uppercase tracking-wider transition-colors inline-block"
            style={{ 
              background: "rgba(255,255,255,0.05)", 
              color: "#C8B898",
              border: "1px solid rgba(255,255,255,0.1)"
            }}
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
