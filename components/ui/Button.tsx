import type { ComponentPropsWithRef } from "react";
import { LoaderCircle } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "default" | "compact";

const variantClass: Record<ButtonVariant, string> = {
  primary: "dc-button dc-button--primary",
  secondary: "dc-button dc-button--secondary",
  ghost: "dc-button dc-button--ghost",
  danger: "dc-button dc-button--danger",
};

const sizeClass: Record<ButtonSize, string> = {
  default: "dc-button--default",
  compact: "dc-button--compact",
};

export function buttonClassName({
  variant = "primary",
  size = "default",
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return `${variantClass[variant]} ${sizeClass[size]} ${className}`.trim();
}

type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "default",
  loading = false,
  type = "button",
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={buttonClassName({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <LoaderCircle size={16} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />}
      {children}
    </button>
  );
}
