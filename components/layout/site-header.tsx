import { existsSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { getViewerFromCookies } from "@/lib/viewer";
import { LogoutButton } from "@/components/layout/logout-button";
import { Button } from "@/components/ui/button";

export async function SiteHeader() {
  const viewer = await getViewerFromCookies();
  const logoExists = existsSync(path.join(process.cwd(), "public", "Logo.png"));

  return (
    <header className="glass-panel sticky top-4 z-30 mb-7 rounded-2xl px-4 py-3 md:px-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-3">
            {logoExists && (
              <img
                src="/Logo.png"
                alt="AE Empire Accounts"
                className="h-9 w-9 rounded-lg object-cover"
              />
            )}
            {!logoExists && (
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white text-sm font-bold text-black">
                AE
              </span>
            )}
            <span className="font-[var(--font-space-grotesk)] text-lg font-bold text-white">
              AE Empire Accounts
            </span>
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-zinc-300 md:flex">
            <Link href="/" className="transition hover:text-white">
              Marketplace
            </Link>
            {viewer && (
              <Link href="/dashboard" className="transition hover:text-white">
                Dashboard
              </Link>
            )}
            {viewer && (
              <a href="/wallet/add-funds" className="transition hover:text-white">
                Add Funds
              </a>
            )}
            {viewer?.isAdmin && (
              <Link href="/admin" className="transition hover:text-white">
                Admin
              </Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {!viewer && (
            <>
              <Link href="/login">
                <Button variant="ghost" className="h-10">
                  Login
                </Button>
              </Link>
              <Link href="/register">
                <Button className="h-10">Register</Button>
              </Link>
            </>
          )}
          {viewer && (
            <>
              <div className="hidden rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-right md:block">
                <p className="text-xs text-zinc-300">{viewer.username}</p>
                <p className="text-sm font-semibold text-white">
                  ${viewer.balance.toFixed(2)}
                </p>
              </div>
              <a href="/wallet/add-funds">
                <Button className="h-10">Add Funds</Button>
              </a>
              <LogoutButton className="h-10" />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
