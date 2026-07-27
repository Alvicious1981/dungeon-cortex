import type { HTMLAttributes } from "react";

type PanelTone = "default" | "narrative" | "mechanical";

const toneClass: Record<PanelTone, string> = {
  default: "",
  narrative: "dc-panel--narrative",
  mechanical: "dc-panel--mechanical",
};

type PanelProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "aside" | "article";
  tone?: PanelTone;
};

export function Panel({
  as: Component = "section",
  tone = "default",
  className = "",
  ...props
}: PanelProps) {
  return <Component className={`dc-panel ${toneClass[tone]} ${className}`.trim()} {...props} />;
}
