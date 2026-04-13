import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"]
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"]
});

export const metadata: Metadata = {
  title: "AE Empire Accounts",
  description: "Premium LZT.Market account and skin trading platform"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body
        className={cn(
          manrope.variable,
          spaceGrotesk.variable,
          "surface-noise relative min-h-screen overflow-x-hidden bg-grain font-[var(--font-manrope)] text-foreground"
        )}
      >
        <div className="absolute inset-0 -z-10 opacity-70">
          <div className="absolute -left-40 top-16 h-72 w-72 rounded-full bg-white/10 blur-[120px]" />
          <div className="absolute right-0 top-32 h-80 w-80 rounded-full bg-zinc-300/10 blur-[130px]" />
          <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-zinc-500/10 blur-[150px]" />
        </div>
        <div className="mx-auto w-full max-w-[1300px] px-4 pb-16 pt-6 md:px-8">
          {children}
        </div>
      </body>
    </html>
  );
}
