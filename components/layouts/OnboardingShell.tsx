import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

interface OnboardingShellProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}

export function OnboardingShell({
  eyebrow,
  title,
  description,
  children,
}: OnboardingShellProps) {
  return (
    <main className="dc-page-shell">
      <div className="dc-container py-6 sm:py-10 lg:py-14">
        <Link href="/" className="dc-back-link">
          <ArrowLeft aria-hidden="true" size={18} />
          Volver al inicio
        </Link>

        <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(16rem,0.78fr)_minmax(0,1.22fr)] lg:gap-12">
          <header className="lg:sticky lg:top-10 lg:pt-5">
            <p className="dc-kicker">{eyebrow}</p>
            <h1 className="dc-heading mt-3 text-4xl font-semibold leading-[1.05] sm:text-5xl">
              {title}
            </h1>
            <p className="dc-copy mt-5 max-w-md text-base leading-7 sm:text-lg sm:leading-8">
              {description}
            </p>
          </header>

          {children}
        </div>
      </div>
    </main>
  );
}
