export default function CampaignLoading() {
  return (
    <main
      className="dc-page-shell min-h-screen px-4 py-7"
      aria-busy="true"
      aria-live="polite"
    >
      <p className="sr-only">Abriendo campaña…</p>
      <div className="mx-auto max-w-[100rem] animate-pulse motion-reduce:animate-none">
        <div className="mb-7 space-y-2">
          <div className="h-3 w-28 rounded bg-[var(--dc-surface-soft)]" />
          <div className="h-8 w-64 max-w-full rounded bg-[var(--dc-surface-raised)]" />
        </div>
        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
          <div className="dc-panel hidden h-[38rem] lg:block" />
          <div className="space-y-5">
            <div className="dc-panel aspect-video min-h-56" />
            <div className="dc-panel h-64" />
            <div className="dc-panel h-32" />
          </div>
          <div className="space-y-4">
            <div className="dc-panel h-40" />
            <div className="dc-panel h-56" />
          </div>
        </div>
      </div>
    </main>
  );
}
