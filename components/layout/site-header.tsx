import Link from "next/link";
import { getViewerFromCookies } from "@/lib/viewer";
import { LogoutButton } from "@/components/layout/logout-button";
import { Button } from "@/components/ui/button";

export async function SiteHeader() {
  const viewer = await getViewerFromCookies();

  return (
    <header className="glass-panel sticky top-3 z-30 mb-5 rounded-2xl px-2.5 py-2.5 sm:px-3 sm:py-3 md:top-4 md:mb-7 md:px-6">
      <div className="flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-8">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <img
              src="/Logo.png"
              alt="AE Empire Accounts"
              className="h-8 w-8 rounded-lg object-cover sm:h-9 sm:w-9"
            />
            <span className="hidden font-[var(--font-space-grotesk)] text-lg font-bold text-white sm:inline">
              AE Empire Accounts
            </span>
            <span className="truncate font-[var(--font-space-grotesk)] text-[15px] font-bold text-white sm:hidden">
              AE Empire
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
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {!viewer && (
            <>
              <Link href="/login">
                <Button variant="ghost" className="h-8 px-2.5 text-[11px] sm:h-10 sm:px-3 sm:text-sm">
                  Login
                </Button>
              </Link>
              <Link href="/register">
                <Button className="h-8 px-2.5 text-[11px] sm:h-10 sm:px-3 sm:text-sm">Register</Button>
              </Link>
            </>
          )}
          {viewer && (
            <>
              <div className="hidden rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-right lg:block">
                <p className="text-xs text-zinc-300">{viewer.username}</p>
                <p className="text-sm font-semibold text-white">
                  ${viewer.balance.toFixed(2)}
                </p>
              </div>
              <a href="/wallet/add-funds" className="hidden sm:block">
                <Button className="h-10 px-3 text-sm">Add Funds</Button>
              </a>
              <LogoutButton className="h-8 px-2.5 text-[11px] sm:h-10 sm:px-3 sm:text-sm" />
            </>
          )}
        </div>
      </div>

      <nav className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 text-xs text-zinc-200 md:hidden">
        <Link
          href="/"
          className="whitespace-nowrap rounded-lg border border-white/15 bg-black/35 px-3 py-1.5"
        >
          Marketplace
        </Link>
        {viewer && (
          <Link
            href="/dashboard"
            className="whitespace-nowrap rounded-lg border border-white/15 bg-black/35 px-3 py-1.5"
          >
            Dashboard
          </Link>
        )}
        {viewer && (
          <span className="whitespace-nowrap rounded-lg border border-white/15 bg-black/35 px-3 py-1.5 text-zinc-300">
            ${viewer.balance.toFixed(2)}
          </span>
        )}
        {viewer && (
          <a
            href="/wallet/add-funds"
            className="whitespace-nowrap rounded-lg border border-white/15 bg-black/35 px-3 py-1.5"
          >
            Add Funds
          </a>
        )}
        {viewer?.isAdmin && (
          <Link
            href="/admin"
            className="whitespace-nowrap rounded-lg border border-white/15 bg-black/35 px-3 py-1.5"
          >
            Admin
          </Link>
        )}
      </nav>
    </header>
  );
}
