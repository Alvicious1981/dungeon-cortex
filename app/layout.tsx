import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Dungeon Cortex",
    template: "%s — Dungeon Cortex",
  },
  description:
    "Una experiencia individual de rol narrativo con reglas deterministas de D&D 5e/SRD 2014.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}

