import Link from "next/link";
import { ChevronLeft, Shield } from "lucide-react";
import { getRaces, getClasses } from "@/lib/dnd-api/client";
import CharacterCreationForm from "@/components/character/CharacterCreationForm";

export const metadata = { title: "Create Character — Dungeon Cortex" };

export default async function CreateCharacterPage() {
  const [races, classes] = await Promise.all([getRaces(), getClasses()]);

  return (
    <main className="dc-atmosphere min-h-screen px-4 py-8 text-[#e2d9c5] sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-[#b9aa8f] hover:text-[#e8c84a]">
          <ChevronLeft aria-hidden="true" size={17} /> Hall of Records
        </Link>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(30rem,1.2fr)] lg:gap-10">
          <header className="pt-4 lg:sticky lg:top-12">
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-[#6f5b2f] bg-[#15121e]/90 text-[#e8c84a]"><Shield aria-hidden="true" size={23} /></div>
            <p className="dc-kicker">The first inscription</p>
            <h1 className="dc-heading mt-3 text-4xl font-black leading-tight text-[#f1dc87] sm:text-5xl">Create Your Character</h1>
            <p className="dc-copy mt-5 max-w-md text-lg leading-8">Choose a 5e/SRD lineage and class, then assign the standard heroic array. Your first campaign opens automatically when the hero is saved.</p>
          </header>
          <section className="dc-panel rounded-sm p-5 sm:p-8" aria-label="Character creation form">
            <CharacterCreationForm races={races} classes={classes} />
          </section>
        </div>
      </div>
    </main>
  );
}
