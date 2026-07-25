import { BookOpenText, Map, ScrollText, UserRound } from "lucide-react";

const ITEMS = [
  { href: "#scene", label: "Scene", icon: Map },
  { href: "#chronicle", label: "Chronicle", icon: BookOpenText },
  { href: "#character", label: "Character", icon: UserRound },
  { href: "#journal", label: "Journal", icon: ScrollText },
] as const;

export default function CampaignMobileNav() {
  return (
    <nav aria-label="Campaign areas" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-[#4a3b24] bg-[#090811]/95 px-[max(0.5rem,env(safe-area-inset-left))] pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {ITEMS.map(({ href, label, icon: Icon }) => (
        <a key={href} href={href} className="flex min-h-16 flex-col items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#a39478] hover:text-[#f1dc87]">
          <Icon aria-hidden="true" size={19} strokeWidth={1.6} />
          {label}
        </a>
      ))}
    </nav>
  );
}
