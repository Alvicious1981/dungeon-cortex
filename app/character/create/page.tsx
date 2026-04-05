import { getRaces, getClasses } from "@/lib/dnd-api/client";
import CharacterCreationForm from "@/components/character/CharacterCreationForm";

export const metadata = {
  title: "Create Character — Dungeon Cortex",
};

export default async function CreateCharacterPage() {
  const [races, classes] = await Promise.all([getRaces(), getClasses()]);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-12">
      <div className="max-w-xl mx-auto">
        <h1 className="text-3xl font-bold mb-2 tracking-tight">Create Your Character</h1>
        <p className="text-neutral-400 mb-8 text-sm">
          Choose your race and class, then set your ability scores.
        </p>
        <CharacterCreationForm races={races} classes={classes} />
      </div>
    </main>
  );
}
