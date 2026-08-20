import type { Metadata } from "next";
import { cookies } from "next/headers";
import { APPEARANCE_COOKIE, normalizeAppearance } from "@/lib/appearance";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChemTrack",
  description: "Chemical inventory system — every bottle accounted for.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const appearance = normalizeAppearance(cookieStore.get(APPEARANCE_COOKIE)?.value);

  return (
    <html lang="en" data-appearance={appearance}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
