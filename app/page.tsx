import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  CircleDot,
  ShieldCheck,
} from "lucide-react";
import { buttonClassName } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";

const PRINCIPLES = [
  {
    icon: BookOpenText,
    title: "La historia ocupa el centro",
    copy: "Declara lo que intenta hacer tu personaje y sigue la escena en una bitácora pensada para leer.",
  },
  {
    icon: ShieldCheck,
    title: "Las reglas no se improvisan",
    copy: "El servidor valida acciones, tiradas y consecuencias antes de que la narración las presente.",
  },
  {
    icon: CircleDot,
    title: "El estado siempre es visible",
    copy: "Recursos, condiciones y resultados mecánicos se muestran separados del relato.",
  },
];

export default function Home() {
  return (
    <main className="dc-page-shell">
      <div className="dc-container flex min-h-svh flex-col">
        <header className="flex min-h-20 items-center justify-between border-b border-[var(--dc-border)]">
          <Link
            href="/"
            aria-label="Dungeon Cortex, inicio"
            className="dc-heading rounded-md text-lg font-semibold no-underline"
          >
            Dungeon Cortex
          </Link>
          <p className="hidden text-xs font-medium uppercase tracking-[0.14em] text-[var(--dc-text-subtle)] sm:block">
            Director de Mazmorras individual
          </p>
        </header>

        <section
          aria-labelledby="home-title"
          className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[minmax(0,1.08fr)_minmax(20rem,0.92fr)] lg:py-20"
        >
          <div className="max-w-3xl">
            <p className="dc-kicker">Narración inmersiva · reglas deterministas</p>
            <h1
              id="home-title"
              className="dc-heading mt-4 text-5xl font-semibold leading-[0.94] sm:text-7xl lg:text-8xl"
            >
              Tu intención mueve la historia.
            </h1>
            <p className="dc-copy dc-reading-width mt-7 text-lg leading-8 sm:text-xl sm:leading-9">
              Crea un héroe de D&amp;D 5e, entra en campaña y juega con libertad.
              Dungeon Cortex narra la ficción mientras el backend mantiene la
              autoridad sobre reglas, estado y consecuencias.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/character/create"
                className={buttonClassName({ className: "w-full sm:w-auto sm:px-6" })}
              >
                Crear personaje
                <ArrowRight aria-hidden="true" size={18} />
              </Link>
              <a
                href="#principios"
                className={buttonClassName({
                  variant: "ghost",
                  className: "w-full sm:w-auto",
                })}
              >
                Cómo funciona
              </a>
            </div>
          </div>

          <Panel
            as="aside"
            tone="narrative"
            aria-label="Estructura de una sesión"
            className="overflow-hidden p-5 sm:p-6"
          >
            <div className="border-b border-[var(--dc-border)] pb-4">
              <p className="dc-kicker">Una sesión, tres voces</p>
              <h2 className="dc-heading mt-2 text-2xl font-semibold">
                Ficción clara. Mecánica verificable.
              </h2>
            </div>
            <dl className="mt-2 divide-y divide-[var(--dc-border)]">
              <div className="py-4">
                <dt className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--dc-narrative)]">
                  Narración
                </dt>
                <dd className="mt-2 text-sm leading-6 text-[var(--dc-text-muted)]">
                  Escena, atmósfera y consecuencias ya resueltas.
                </dd>
              </div>
              <div className="py-4">
                <dt className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--dc-mechanical)]">
                  Estado mecánico
                </dt>
                <dd className="mt-2 text-sm leading-6 text-[var(--dc-text-muted)]">
                  Valores confirmados, recursos y eventos del servidor.
                </dd>
              </div>
              <div className="pt-4">
                <dt className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--dc-action-hover)]">
                  Tu intención
                </dt>
                <dd className="mt-2 text-sm leading-6 text-[var(--dc-text-muted)]">
                  Lenguaje natural y acciones disponibles sin duplicar reglas en el navegador.
                </dd>
              </div>
            </dl>
          </Panel>
        </section>

        <section
          id="principios"
          aria-labelledby="principles-title"
          className="scroll-mt-8 border-t border-[var(--dc-border)] py-12 sm:py-16"
        >
          <p className="dc-kicker">Principios de experiencia</p>
          <h2 id="principles-title" className="dc-heading mt-3 text-3xl font-semibold sm:text-4xl">
            Una mesa de juego, no una ventana de chat.
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {PRINCIPLES.map(({ icon: Icon, title, copy }) => (
              <article
                key={title}
                className="rounded-xl border border-[var(--dc-border)] bg-[var(--dc-surface)] p-5 sm:p-6"
              >
                <Icon
                  aria-hidden="true"
                  size={22}
                  strokeWidth={1.7}
                  className="text-[var(--dc-action-hover)]"
                />
                <h3 className="dc-heading mt-4 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--dc-text-muted)]">{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <footer className="border-t border-[var(--dc-border)] py-6 text-xs leading-5 text-[var(--dc-text-subtle)]">
          Dungeon Cortex utiliza exclusivamente D&amp;D 5e / SRD 2014 como base mecánica.
        </footer>
      </div>
    </main>
  );
}
