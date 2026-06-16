import CharacterSheetVTT, { type CharacterSheetProps } from "../CharacterSheetVTT";

interface CharacterSheetSidebarProps {
  viewModel: CharacterSheetProps;
  className?: string;
}

export default function CharacterSheetSidebar({ viewModel, className }: CharacterSheetSidebarProps) {
  return (
    <aside
      aria-label="Persistent character sheet"
      className={["h-screen w-80 overflow-y-auto p-3 xl:w-96", className]
        .filter(Boolean)
        .join(" ")}
    >
      <CharacterSheetVTT {...viewModel} />
    </aside>
  );
}
