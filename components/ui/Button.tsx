import type { ButtonHTMLAttributes } from "react";

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

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "default",
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={buttonClassName({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {children}
    </button>
  );
}
