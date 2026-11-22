import type { Metadata, Viewport } from "next";
import { Fredoka, Nunito } from "next/font/google";
import { GAME_NAME, TAGLINE } from "@/lib/brand";
import "./globals.css";

const fredoka = Fredoka({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-fredoka" });
const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-nunito" });

export const metadata: Metadata = {
  title: GAME_NAME,
  description: TAGLINE,
};

export const viewport: Viewport = {
  themeColor: "#0d0e0b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fredoka.variable} ${nunito.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
