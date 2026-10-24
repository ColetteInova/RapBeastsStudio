import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RapBeasts Studio",
  description:
    "Editor de letras e ritmos do RapBeasts — crie seus charts e sincronize com o jogo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
