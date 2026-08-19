import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChemTrack",
  description: "Chemical inventory system — every bottle accounted for.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
