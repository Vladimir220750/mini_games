import type { ReactNode } from "react";

export const metadata = {
  title: "RPS — Solana",
  description: "2-player wager mini-game",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "ui-sans-serif" }}>{children}</body>
    </html>
  );
}
