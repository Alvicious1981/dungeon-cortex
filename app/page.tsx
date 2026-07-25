import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  Check,
  ChevronRight,
  Dice5,
  Feather,
  LockKeyhole,
  Map,
  ShieldCheck,
  Sparkles,
  Swords,
} from "lucide-react";
import CortexGateway from "@/components/brand/CortexGateway";
import CortexSigil from "@/components/brand/CortexSigil";

const PILLARS = [
  {
    icon: ShieldCheck,
    eyebrow: "Deterministic play",
    title: "The rules stay honest",
    copy: "Checks, damage, resources and consequences are resolved by code before the Dungeon Master narrates them.",
  },
  {
    icon: Feather,
    eyebrow: "Natural language",
    title: "Play in your own words",
    copy: "Describe an action instead of hunting through menus. Dungeon Cortex translates intent without taking control away from you.",
  },
  {
    icon: Map,
    eyebrow: "Persistent world",
    title: "Your chronicle remembers",
    copy: "Quests, allies, discoveries and combat state remain connected as your campaign moves between story and tactics.",
  },
];

const JOURNEY = [
  { number: "01", icon: Sparkles, title: "Forge a hero", copy: "Choose a 5e/SRD lineage and class, then assign your ability scores." },
  { number: "02", icon: BookOpenText, title: "Enter the chronicle", copy: "A campaign opens immediately, with a living narrative and clear game state." },
  { number: "03", icon: Swords, title: "Act, explore, survive", copy: "Move from freeform decisions to exploration and combat without losing context." },
];

export default function Home() {
  return (
    <main className="dc-atmosphere min-h-screen overflow-hidden text-[#e8dfcd]">
      <div className="mx-auto max-w-[92rem] px-4 sm:px-6 lg:px-8">
        <nav className="relative z-20 flex min-h-20 items-center justify-between border-b border-[#826943]/20" aria-label="Primary navigation">
          <Link href="/" className="flex items-center gap-3" aria-label="Dungeon Cortex home">
            <CortexSigil className="h-11 w-11 drop-shadow-[0_0_18px_rgba(167,139,250,0.22)]" />
            <span className="flex flex-col">
              <strong className="dc-heading text-base text-[#f1e7d3]">Dungeon Cortex</strong>
              <small className="mt-0.5 hidden text-[9px] uppercase tracking-[0.2em] text-[#8f826d] sm:block">Rules-backed solo adventure</small>
            </span>
          </Link>

          <div className="flex items-center gap-4">
            <a href="#how-it-plays" className="hidden text-sm text-[#b8aa92] transition hover:text-[#f3dc8a] sm:inline">How it plays</a>
            <Link href="/character/create" className="dc-button-primary rounded-md px-3 py-2 text-xs sm:px-4">
              <span className="hidden sm:inline">Create hero</span>
              <ChevronRight aria-hidden="true" size={16} />
            </Link>
          </div>
        </nav>

        <section className="grid min-h-[calc(100vh-5rem)] items-center gap-10 py-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(30rem,.95fr)] lg:py-20" aria-labelledby="home-title">
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#8a73aa]/45 bg-[#0e0c18]/80 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#cfc3e2] sm:text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(74,222,128,.55)]" />
              A solo 5e adventure with an AI Dungeon Master
            </div>

            <p className="dc-kicker mt-8">Your story. Honest consequences.</p>
            <h1 id="home-title" className="dc-heading mt-4 max-w-4xl text-5xl font-black leading-[0.96] tracking-[-0.045em] text-[#f4ead8] sm:text-7xl xl:text-[6.4rem]">
              Your choices shape the story.
              <span className="block italic text-[#f3dc8a]">The rules shape the world.</span>
            </h1>
            <p className="dc-copy mt-7 max-w-2xl text-lg leading-8 sm:text-xl">
              Speak freely, explore dangerous places and fight tactical battles in a campaign where narration never overrides mechanical truth.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link href="/character/create" className="dc-button-primary rounded-md px-6 py-3.5">
                Forge your hero <ArrowRight aria-hidden="true" size={18} />
              </Link>
              <a href="#how-it-plays" className="inline-flex min-h-11 items-center justify-center rounded-md border border-[#6d588a] bg-[#0f0d18]/75 px-6 py-3.5 font-bold text-[#e4d9c6] transition hover:-translate-y-0.5 hover:border-[#9072b3] hover:bg-[#1c1729]">
                See how it works
              </a>
            </div>

            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-3 text-xs text-[#938875]" aria-label="Product guarantees">
              {["D&D 5e / SRD 2014 foundation", "Backend-resolved mechanics", "Single-player by design"].map((point) => (
                <li key={point} className="flex items-center gap-2">
                  <Check aria-hidden="true" size={15} className="text-[#c9a84a]" /> {point}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative min-h-[38rem] lg:min-h-[44rem]" aria-label="Dungeon Cortex campaign preview">
            <div aria-hidden="true" className="absolute left-1/2 top-1/2 h-[34rem] w-[34rem] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(132,93,210,.24),rgba(213,171,66,.08)_36%,transparent_68%)] motion-safe:animate-pulse" />
            <CortexGateway className="absolute inset-0 m-auto w-full max-w-[44rem] drop-shadow-[0_32px_42px_rgba(0,0,0,.55)]" />

            <div className="absolute bottom-8 left-0 w-[95%] max-w-[31rem] rounded-xl border border-[#725d8f]/60 bg-[linear-gradient(145deg,rgba(20,16,30,.92),rgba(8,8,15,.96))] p-5 shadow-[0_24px_70px_rgba(0,0,0,.48)] backdrop-blur-xl sm:bottom-16">
              <div className="flex items-center justify-between">
                <span className="flex flex-col">
                  <small className="text-[9px] uppercase tracking-[0.18em] text-[#8e819d]">Active chronicle</small>
                  <strong className="dc-heading mt-1 text-[#f3dc8a]">The Ashen Vault</strong>
                </span>
                <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-[9px] font-extrabold uppercase tracking-widest text-emerald-300">Live</span>
              </div>

              <div className="my-4 border-y border-[#6b5884]/30 py-4">
                <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#a78bfa]">Dungeon Master</p>
                <p className="dc-copy mt-2 text-sm leading-6">The basalt doors grind apart. Heat rolls across the bridge as something enormous shifts beyond the ember-lit threshold.</p>
              </div>

              <div className="flex items-center gap-3">
                <Dice5 aria-hidden="true" size={19} className="text-[#d8b758]" />
                <span className="flex flex-col">
                  <small className="text-[9px] uppercase tracking-[0.16em] text-[#8e819d]">Resolved check</small>
                  <strong className="text-xs text-[#eee3d1]">Perception · 18</strong>
                </span>
                <span className="ml-auto rounded-full bg-emerald-300/10 px-2 py-1 text-[9px] font-extrabold uppercase tracking-widest text-emerald-300">Success</span>
              </div>
            </div>

            <div className="absolute right-0 top-14 grid w-56 grid-cols-[auto_1fr] items-center gap-3 rounded-xl border border-[#725d8f]/60 bg-[#100d1a]/90 p-3 shadow-2xl backdrop-blur-xl">
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#c8b1f7] bg-[radial-gradient(circle_at_35%_30%,#d5c0ff,#6d4ec7)] font-serif font-black text-[#120d1e]">V</span>
              <span className="flex flex-col">
                <small className="text-[8px] uppercase tracking-wider text-[#8e819d]">Veyra · Level 3 Ranger</small>
                <strong className="mt-1 text-xs text-[#d9cfbd]">24 / 28 HP</strong>
              </span>
              <div className="col-span-2 h-1 overflow-hidden rounded-full bg-red-950/50"><span className="block h-full w-[86%] bg-gradient-to-r from-emerald-400 to-emerald-300" /></div>
            </div>

            <div className="absolute bottom-52 right-1 flex items-center gap-3 rounded-xl border border-[#725d8f]/60 bg-[#100d1a]/90 px-4 py-3 shadow-2xl backdrop-blur-xl">
              <LockKeyhole aria-hidden="true" size={18} className="text-[#e5c35a]" />
              <span className="flex flex-col">
                <small className="text-[8px] uppercase tracking-wider text-[#8e819d]">Mechanical authority</small>
                <strong className="mt-1 text-xs text-[#ddd2bf]">Backend verified</strong>
              </span>
            </div>
          </div>
        </section>

        <section id="how-it-plays" className="border-t border-[#826943]/20 py-20 lg:py-24" aria-labelledby="pillars-title">
          <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,.65fr)]">
            <div>
              <p className="dc-kicker">Designed around player trust</p>
              <h2 id="pillars-title" className="dc-heading mt-3 text-3xl font-bold text-[#efe5d2] sm:text-5xl">Immersion without hidden rules</h2>
            </div>
            <p className="dc-copy leading-8 text-[#a99c87]">Dungeon Cortex combines the freedom of conversation with the clarity of a game interface. The Dungeon Master creates atmosphere; the system preserves truth.</p>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {PILLARS.map(({ icon: Icon, eyebrow, title, copy }) => (
              <article key={title} className="relative rounded-xl border border-[#5b4975]/55 bg-[linear-gradient(150deg,rgba(17,14,26,.93),rgba(8,8,14,.97))] p-6 transition hover:-translate-y-1 hover:border-[#a78bfa]/55">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[#a07ecb]/35 bg-[#533a81]/30 text-[#d8c1f8]"><Icon aria-hidden="true" size={23} strokeWidth={1.6} /></div>
                <p className="mt-6 text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#b99a45]">{eyebrow}</p>
                <h3 className="dc-heading mt-2 text-2xl font-bold text-[#efe4cf]">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-[#a99c87]">{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="grid items-center gap-12 border-t border-[#826943]/20 py-20 lg:grid-cols-[minmax(20rem,.8fr)_minmax(0,1.2fr)] lg:py-24" aria-labelledby="journey-title">
          <div className="relative mx-auto flex aspect-square w-full max-w-md items-center justify-center" aria-hidden="true">
            <div className="absolute inset-[5%] rounded-full bg-[radial-gradient(circle,rgba(167,139,250,.2),transparent_68%)]" />
            <div className="absolute inset-[15%] rounded-full border border-[#8e6fb5]/30" />
            <div className="absolute inset-[5%] rounded-full border border-dashed border-[#8e6fb5]/20" />
            <CortexSigil className="relative w-[44%] drop-shadow-[0_0_35px_rgba(167,139,250,.24)]" />
          </div>

          <div>
            <p className="dc-kicker">From blank page to first decision</p>
            <h2 id="journey-title" className="dc-heading mt-3 text-3xl font-bold text-[#efe5d2] sm:text-5xl">Begin in three clear steps</h2>
            <div className="mt-8 divide-y divide-[#64527c]/30">
              {JOURNEY.map(({ number, icon: Icon, title, copy }) => (
                <article key={number} className="grid grid-cols-[2rem_2.5rem_1fr] items-start gap-4 py-5">
                  <span className="pt-2 font-mono text-xs text-[#695a43]">{number}</span>
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#6f5690]/45 text-[#c9aaf1]"><Icon aria-hidden="true" size={20} /></span>
                  <div>
                    <h3 className="dc-heading text-xl font-bold text-[#eee3d0]">{title}</h3>
                    <p className="mt-1 text-sm leading-7 text-[#9f927d]">{copy}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mb-16 flex flex-col items-start justify-between gap-8 overflow-hidden rounded-2xl border border-[#7e629d]/50 bg-[linear-gradient(135deg,rgba(42,31,60,.86),rgba(15,12,22,.94))] p-7 shadow-[0_30px_90px_rgba(0,0,0,.35)] sm:p-10 lg:flex-row lg:items-center">
          <div>
            <p className="dc-kicker">The chronicle is waiting</p>
            <h2 className="dc-heading mt-3 text-3xl font-bold text-[#efe5d2] sm:text-4xl">Create a hero and make the first choice.</h2>
            <p className="dc-copy mt-4 max-w-2xl leading-7">No rules manual is required to begin. Dungeon Cortex keeps the state visible and the mechanics consistent while you focus on the adventure.</p>
          </div>
          <Link href="/character/create" className="dc-button-primary shrink-0 rounded-md px-6 py-3.5">Start your chronicle <ArrowRight aria-hidden="true" size={18} /></Link>
        </section>

        <footer className="flex flex-col justify-between gap-2 border-t border-[#826943]/20 py-6 text-xs text-[#716757] sm:flex-row">
          <span>Dungeon Cortex</span>
          <span>Built for deterministic D&amp;D 5e / SRD 2014 play.</span>
        </footer>
      </div>
    </main>
  );
}
