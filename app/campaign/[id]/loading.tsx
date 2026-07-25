export default function CampaignLoading() {
  return (
    <main className="dc-atmosphere min-h-screen px-4 py-8 text-[#e2d9c5]" aria-busy="true" aria-live="polite">
      <p className="sr-only">Opening campaign…</p>
      <div className="mx-auto max-w-[100rem] animate-pulse motion-reduce:animate-none">
        <div className="mb-6 h-8 w-64 rounded-sm bg-[#2a2338]" />
        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
          <div className="dc-panel hidden h-[38rem] rounded-sm lg:block" />
          <div className="space-y-5">
            <div className="dc-panel aspect-video rounded-sm" />
            <div className="dc-panel h-64 rounded-sm" />
            <div className="dc-panel h-32 rounded-sm" />
          </div>
          <div className="space-y-4">
            <div className="dc-panel h-40 rounded-sm" />
            <div className="dc-panel h-56 rounded-sm" />
          </div>
        </div>
      </div>
    </main>
  );
}
