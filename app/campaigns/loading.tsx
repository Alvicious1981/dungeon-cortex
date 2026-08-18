import { OnboardingShell } from "@/components/layouts/OnboardingShell";
import { Panel } from "@/components/ui/Panel";

// Dimensiones estables: los huecos ocupan lo mismo que la tarjeta real, para
// que la lista no salte al llegar los datos.
function CardSkeleton() {
  return (
    <Panel as="div" className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="h-7 w-3/4 rounded" style={{ background: "var(--dc-surface-soft)" }} />
      <div className="h-4 w-1/2 rounded" style={{ background: "var(--dc-surface-soft)" }} />
      <div className="h-4 w-2/5 rounded" style={{ background: "var(--dc-surface-soft)" }} />
      <div className="h-11 w-full rounded sm:w-48" style={{ background: "var(--dc-surface-soft)" }} />
    </Panel>
  );
}

export default function CampaignsLoading() {
  return (
    <OnboardingShell
      eyebrow="Biblioteca"
      title="Tus campañas"
      description="Retoma una crónica en curso o empieza una nueva. Cada campaña conserva su personaje, su estado y su historia."
    >
      <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
        <p className="dc-help">Cargando tus campañas…</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    </OnboardingShell>
  );
}
