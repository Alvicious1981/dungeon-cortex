import type { HTMLAttributes } from "react";

type StatusTone = "info" | "success" | "warning" | "error";

const labels: Record<StatusTone, string> = {
  info: "Información",
  success: "Confirmado",
  warning: "Atención",
  error: "Error",
};

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
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`dc-status dc-status--${tone} ${className}`.trim()}
      {...props}
    >
      <p className="dc-status__title">{title ?? labels[tone]}</p>
      <div className="dc-status__body">{children}</div>
    </div>
  );
}
