import Link from "next/link";
import { ChevronRight, ScrollText, ShieldCheck, Swords } from "lucide-react";

const PILLARS = [
  { icon: ShieldCheck, title: "Code is Law", copy: "Every roll and consequence is resolved by deterministic rules." },
  { icon: ScrollText, title: "A Living Chronicle", copy: "Speak freely while the game records quests, allies and discoveries." },
  { icon: Swords, title: "Tactical Adventure", copy: "Move between narrative, exploration and combat without losing context." },
];

export default function Home() {
  return (
    <main className="dc-atmosphere min-h-screen overflow-hidden text-[#e2d9c5]">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-5 py-12 sm:px-8 lg:py-20">
        <section className="max-w-3xl" aria-labelledby="home-title">
          <p className="dc-kicker mb-4">A rules-backed solo role-playing game</p>
          <h1 id="home-title" className="dc-heading text-5xl font-black leading-none text-[#f1dc87] sm:text-7xl lg:text-8xl">Dungeon<br />Cortex</h1>
          <p className="dc-copy mt-6 max-w-2xl text-lg leading-8 text-[#d2c6a8] sm:text-xl">A Dungeon Master that listens like a storyteller and resolves the world like a game. Forge a hero, declare your intent and watch the chronicle answer.</p>
          <Link href="/character/create" className="dc-button-primary mt-8 rounded-sm px-7 py-3.5 text-sm uppercase tracking-[0.14em]">
            Start your adventure <ChevronRight aria-hidden="true" className="ml-2" size={18} />
          </Link>
        </section>

        <section aria-label="Game pillars" className="mt-14 grid gap-px overflow-hidden rounded-sm border border-[#3b3150] bg-[#3b3150] md:grid-cols-3">
          {PILLARS.map(({ icon: Icon, title, copy }) => (
            <article key={title} className="bg-[#0c0c16]/95 p-5 sm:p-6">
              <Icon aria-hidden="true" size={22} strokeWidth={1.5} className="text-[#e8c84a]" />
              <h2 className="dc-heading mt-3 text-base font-bold text-[#eadcab]">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-[#a39478]">{copy}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
