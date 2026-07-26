import { getClasses, getRaces } from "@/lib/dnd-api/client";
import CharacterCreationForm from "@/components/character/CharacterCreationForm";
import { OnboardingShell } from "@/components/layouts/OnboardingShell";
import { Panel } from "@/components/ui/Panel";

export const metadata = { title: "Crear personaje" };

export default async function CreateCharacterPage() {
  const [races, classes] = await Promise.all([getRaces(), getClasses()]);

  return (
    <OnboardingShell
      eyebrow="El primer registro"
      title="Crea tu personaje"
      description="Elige un linaje y una clase del SRD 2014, asigna la matriz estándar y abre tu primera campaña. Las reglas y el estado permanecerán bajo autoridad del servidor."
    >
      <Panel
        tone="mechanical"
        aria-label="Formulario de creación de personaje"
        className="p-5 sm:p-7 lg:p-8"
      >
        <CharacterCreationForm races={races} classes={classes} />
      </Panel>
    </OnboardingShell>
  );
}
