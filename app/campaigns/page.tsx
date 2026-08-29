import Link from "next/link";

import { OnboardingShell } from "@/components/layouts/OnboardingShell";
import { Panel } from "@/components/ui/Panel";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { buttonClassName } from "@/components/ui/Button";
import { getAuthUser, AuthError } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export const metadata = {
  title: "Tus campañas",
};

// This page is backed by mutable per-user data. It must be rendered for each
// request rather than frozen to whatever campaigns existed during `next build`.
export const dynamic = "force-dynamic";

// Solo los campos con contrato de listado estable. Oro, misión activa,
// localización y tiempo jugado quedan deliberadamente fuera.
interface CampaignSummary {
  id: string;
  title: string;
  status: string;
  updatedAt: Date;
  character: { name: string; class: string; level: number };
}

const SHELL = {
  eyebrow: "Biblioteca",
  title: "Tus campañas",
  description:
    "Retoma una crónica en curso o empieza una nueva. Cada campaña conserva su personaje, su estado y su historia.",
} as const;

function formatUpdatedAt(value: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value);
}

function CampaignCard({ campaign }: { campaign: CampaignSummary }) {
  const isActive = campaign.status === "active";
  const { character } = campaign;

  return (
    <Panel as="article" className="flex flex-col gap-4 p-5 sm:p-6">
      <div>
        <h2 className="dc-heading text-xl font-semibold leading-tight sm:text-2xl">
          {campaign.title}
        </h2>
        <p className="dc-copy mt-2 text-sm">
          {character.name} · {character.class} · nivel{" "}
          <span className="dc-mechanical-value">{character.level}</span>
        </p>
      </div>

      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <div>
          <dt className="dc-kicker">Última partida</dt>
          <dd className="dc-copy mt-1">
            <time dateTime={campaign.updatedAt.toISOString()}>
              {formatUpdatedAt(campaign.updatedAt)}
            </time>
          </dd>
        </div>
        {!isActive && (
          <div>
            <dt className="dc-kicker">Estado</dt>
            <dd className="dc-copy mt-1">{campaign.status}</dd>
          </div>
        )}
      </dl>

      {isActive ? (
        <Link
          href={`/campaign/${campaign.id}`}
          className={buttonClassName({ className: "w-full sm:w-auto sm:self-start sm:px-6" })}
        >
          Continuar campaña
        </Link>
      ) : (
        // Visible y deshabilitado, con el motivo a la vista: nunca oculto.
        <div className="flex flex-col gap-2 sm:items-start">
          <span
            aria-disabled="true"
            className={buttonClassName({
              variant: "secondary",
              className: "w-full cursor-not-allowed opacity-50 sm:w-auto sm:px-6",
            })}
          >
            Continuar campaña
          </span>
          <p className="dc-help">
            Esta campaña no está activa, así que no puede retomarse.
          </p>
        </div>
      )}
    </Panel>
  );
}

export default async function CampaignsPage() {
  let campaigns: CampaignSummary[];

  try {
    const user = await getAuthUser();
    campaigns = await prisma.campaign.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        character: { select: { name: true, class: true, level: true } },
      },
    });
  } catch (e) {
    // A diferencia de /campaign/[id], aquí no hay recurso concreto que ocultar,
    // así que se explica el estado en lugar de devolver un 404 mudo.
    if (e instanceof AuthError) {
      return (
        <OnboardingShell {...SHELL}>
          <StatusMessage tone="warning" title="No hay sesión disponible">
            <p>
              El modo privado no está activo, así que no se puede identificar a
              quién pertenecen las campañas.
            </p>
            <p className="mt-2">
              Revisa la configuración local del proyecto y vuelve a cargar esta
              página.
            </p>
          </StatusMessage>
        </OnboardingShell>
      );
    }
    throw e;
  }

  return (
    <OnboardingShell {...SHELL}>
      {campaigns.length === 0 ? (
        <StatusMessage tone="info" title="Todavía no hay ninguna campaña">
          <p>
            Cuando crees un personaje se abrirá su primera crónica y aparecerá
            aquí.
          </p>
          <p className="mt-4">
            <Link href="/character/create" className={buttonClassName()}>
              Crear personaje
            </Link>
          </p>
        </StatusMessage>
      ) : (
        <div className="flex flex-col gap-6">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <CampaignCard campaign={campaign} />
              </li>
            ))}
          </ul>

          <p className="dc-help">
            ¿Quieres empezar otra historia?{" "}
            <Link href="/character/create" className="underline underline-offset-4">
              Crear personaje
            </Link>
          </p>
        </div>
      )}
    </OnboardingShell>
  );
}
