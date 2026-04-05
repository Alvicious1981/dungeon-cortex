import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center px-4">
      <div className="max-w-md text-center space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">Dungeon Cortex</h1>
        <p className="text-neutral-400 text-base leading-relaxed">
          An AI Dungeon Master that plays by the rules. Create your character and
          enter a world where every roll matters.
        </p>
        <Link
          href="/character/create"
          className="inline-block rounded-md bg-amber-600 hover:bg-amber-500 px-6 py-3 text-sm font-semibold text-white transition-colors"
        >
          Start your adventure
        </Link>
      </div>
    </main>
  );
}
