import type { HTMLAttributes } from "react";
import { CircleCheck, CircleAlert, Info, TriangleAlert } from "lucide-react";

type StatusTone = "info" | "success" | "warning" | "error";

const labels: Record<StatusTone, string> = {
  info: "Información",
  success: "Confirmado",
  warning: "Atención",
  error: "Error",
};
const icons = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert };

type StatusMessageProps = HTMLAttributes<HTMLDivElement> & {
  tone?: StatusTone;
  title?: string;
};

export function StatusMessage({
  tone = "info",
  title,
  className = "",
  children,
  ...props
}: StatusMessageProps) {
  const Icon = icons[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`dc-status dc-status--${tone} ${className}`.trim()}
      {...props}
    >
      <p className="dc-status__title flex items-start gap-2"><Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />{title ?? labels[tone]}</p>
      <div className="dc-status__body">{children}</div>
    </div>
  );
}
