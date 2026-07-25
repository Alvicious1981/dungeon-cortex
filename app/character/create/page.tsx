import Link from "next/link";
import { Check, ChevronLeft, Shield, Sparkles } from "lucide-react";
import { getRaces, getClasses } from "@/lib/dnd-api/client";
import CharacterCreationForm from "@/components/character/CharacterCreationForm";
import CortexSigil from "@/components/brand/CortexSigil";

export const metadata = { title: "Create Character — Dungeon Cortex" };

export default async function CreateCharacterPage() {
  const [races, classes] = await Promise.all([getRaces(), getClasses()]);

  return (
    <main className="dc-atmosphere min-h-screen px-4 py-5 text-[#e8dfcd] sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3" aria-label="Return to Dungeon Cortex home">
            <CortexSigil className="h-10 w-10 drop-shadow-[0_0_18px_rgba(167,139,250,.22)]" />
            <span className="flex flex-col">
              <strong className="dc-heading text-base text-[#f1e7d3]">Dungeon Cortex</strong>
              <small className="hidden text-[9px] uppercase tracking-[0.2em] text-[#8f826d] sm:block">Character forge</small>
            </span>
          </Link>
          <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-[#b8aa92] transition hover:bg-white/5 hover:text-[#f3dc8a]"><ChevronLeft aria-hidden="true" size={17} /> Home</Link>
        </div>

        <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,.82fr)_minmax(32rem,1.18fr)] lg:gap-12">
          <header className="relative pt-2 lg:sticky lg:top-8">
            <div className="relative mb-7 flex h-32 w-32 items-center justify-center">
              <div className="absolute inset-0 rounded-full border border-dashed border-[#b890de]/45" />
              <div className="absolute -inset-10 rounded-full bg-[radial-gradient(circle,rgba(167,139,250,.2),transparent_68%)]" />
              <CortexSigil className="relative w-[58%]" />
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-[#8a73aa]/45 bg-[#0e0c18]/80 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#cfc3e2]"><Sparkles aria-hidden="true" size={14} /> Step 1 of 2 · Forge the hero</div>
            <p className="dc-kicker mt-7">The first inscription</p>
            <h1 className="dc-heading mt-3 text-5xl font-black leading-[0.98] tracking-[-0.04em] text-[#f4ead8] sm:text-6xl">Create your character</h1>
            <p className="dc-copy mt-5 max-w-xl text-lg leading-8">Choose a lineage and class, assign the standard heroic array, and give your adventurer a name. The first campaign opens as soon as the hero is saved.</p>

            <ul className="mt-7 space-y-3 text-sm text-[#a99c87]">
              {["5e/SRD race and class data", "Standard array ready to use", "Campaign opens automatically"].map((item) => (
                <li key={item} className="flex items-center gap-2"><Check aria-hidden="true" size={15} className="text-[#d6b653]" /> {item}</li>
              ))}
            </ul>

            <div className="mt-8 flex max-w-lg items-start gap-3 rounded-xl border border-[#675084]/45 bg-[#120e1b]/75 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#a07ecb]/35 bg-[#533a81]/30 text-[#d8c1f8]"><Shield aria-hidden="true" size={18} /></span>
              <div>
                <strong className="text-sm text-[#e6dbc7]">Rules stay server-side</strong>
                <p className="mt-1 text-xs leading-6 text-[#958873]">Your selections describe the hero. Dungeon Cortex remains responsible for legal actions, rolls and campaign state.</p>
              </div>
            </div>
          </header>

          <section className="dc-panel rounded-xl p-5 sm:p-8" aria-label="Character creation form">
            <div className="flex items-center justify-between border-b border-[#685381]/35 pb-5">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#b99a45]">Hero record</p>
                <h2 className="dc-heading mt-1 text-2xl font-bold text-[#efe5d2]">Identity and abilities</h2>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#c6a44e]/45 font-serif text-[#d9bb63]" aria-hidden="true">I</span>
            </div>
            <div className="mt-7"><CharacterCreationForm races={races} classes={classes} /></div>
          </section>
        </div>
      </div>
    </main>
  );
}
