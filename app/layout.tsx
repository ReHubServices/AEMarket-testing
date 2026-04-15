import type { Metadata } from "next";
import "./globals.css";
import { cn } from "@/lib/utils";
import { SiteHeader } from "@/components/layout/site-header";

export const metadata: Metadata = {
  title: "AE Empire Accounts",
  description: "Premium game account and skin marketplace",
  icons: {
    icon: "/Logo.png",
    shortcut: "/Logo.png",
    apple: "/Logo.png"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body
        className={cn(
          "surface-noise relative min-h-screen overflow-x-hidden bg-grain font-[var(--font-manrope)] text-foreground"
        )}
      >
        <div className="absolute inset-0 -z-10 opacity-70">
          <div className="absolute -left-40 top-16 h-72 w-72 rounded-full bg-white/10 blur-[120px]" />
          <div className="absolute right-0 top-32 h-80 w-80 rounded-full bg-zinc-300/10 blur-[130px]" />
          <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-zinc-500/10 blur-[150px]" />
        </div>
        <div className="mx-auto w-full max-w-[1300px] px-3 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-4 sm:px-4 sm:pt-5 md:px-8 md:pt-6">
          <SiteHeader />
          {children}
        </div>
      </body>
    </html>
  );
}
