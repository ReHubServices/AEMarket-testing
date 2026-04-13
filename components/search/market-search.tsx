"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, ShieldCheck, Sparkles, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { MarketListing } from "@/lib/market";
import { cn } from "@/lib/utils";

function formatPrice(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(value);
}

function useDebouncedValue(value: string, delay = 260) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debounced;
}

type SearchResponse = {
  listings: MarketListing[];
};

export function MarketSearch() {
  const [query, setQuery] = useState("");
  const [activeListingId, setActiveListingId] = useState<string | null>(null);
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const debouncedQuery = useDebouncedValue(query);

  useEffect(() => {
    let cancelled = false;

    async function runSearch() {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}`, {
          cache: "no-store"
        });
        const data: SearchResponse = await response.json();
        if (!cancelled) {
          setListings(Array.isArray(data.listings) ? data.listings : []);
        }
      } catch {
        if (!cancelled) {
          setListings([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setReady(true);
        }
      }
    }

    runSearch();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const activeListing = useMemo(
    () => listings.find((listing) => listing.id === activeListingId) ?? null,
    [activeListingId, listings]
  );

  return (
    <main className="space-y-7 pt-3">
      <header className="glass-panel rounded-3xl px-6 py-7 md:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/8 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-zinc-300">
              <Sparkles size={13} />
              AE Empire Accounts
            </div>
            <div className="space-y-2">
              <h1 className="text-glow font-[var(--font-space-grotesk)] text-3xl font-bold leading-tight md:text-5xl">
                Buy Verified Game Accounts
              </h1>
              <p className="max-w-2xl text-sm text-zinc-300 md:text-base">
                Live listings from LZT.Market with instant checkout flow, automated delivery,
                and premium support.
              </p>
            </div>
          </div>
          <div className="flex gap-3 text-xs text-zinc-300">
            <div className="glass-panel rounded-2xl px-4 py-3">
              <p className="font-semibold text-white">1.4k+</p>
              <p>Daily Offers</p>
            </div>
            <div className="glass-panel rounded-2xl px-4 py-3">
              <p className="font-semibold text-white">99.2%</p>
              <p>Delivery Rate</p>
            </div>
            <div className="glass-panel rounded-2xl px-4 py-3">
              <p className="font-semibold text-white">24/7</p>
              <p>Monitoring</p>
            </div>
          </div>
        </div>
      </header>

      <section className="glass-panel rounded-3xl p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row">
          <div className="relative flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-11"
              placeholder="Search by game, skin, rank, or seller"
            />
          </div>
          <Button className="min-w-[136px]">Sign In To Buy</Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loading &&
          Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="glass-panel animate-pulseSoft rounded-2xl p-4"
            >
              <div className="h-40 rounded-xl bg-white/8" />
              <div className="mt-4 h-4 w-4/5 rounded bg-white/10" />
              <div className="mt-2 h-3 w-1/2 rounded bg-white/10" />
              <div className="mt-4 h-8 w-full rounded-lg bg-white/10" />
            </div>
          ))}

        {!loading &&
          listings.map((listing) => (
            <button
              key={listing.id}
              type="button"
              onClick={() => setActiveListingId(listing.id)}
              className={cn(
                "glass-panel overflow-hidden rounded-2xl text-left transition duration-200 hover:scale-[1.01] hover:border-white/25",
                activeListingId === listing.id && "border-white/35"
              )}
            >
              <div className="relative h-44 w-full overflow-hidden">
                <img
                  src={listing.imageUrl}
                  alt={listing.title}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                  <span className="rounded-full border border-white/25 bg-black/40 px-2.5 py-1 text-[11px] uppercase tracking-wider text-zinc-200">
                    {listing.game}
                  </span>
                  <span className="rounded-full border border-white/25 bg-black/40 px-2.5 py-1 text-[11px] text-zinc-200">
                    {listing.category}
                  </span>
                </div>
              </div>
              <div className="space-y-4 p-4">
                <div className="space-y-2">
                  <h3 className="max-h-[3.4rem] overflow-hidden font-[var(--font-space-grotesk)] text-lg font-semibold text-white">
                    {listing.title}
                  </h3>
                  <p className="max-h-10 overflow-hidden text-xs text-zinc-300">
                    {listing.description}
                  </p>
                </div>
                <div className="flex items-center justify-between text-xs text-zinc-300">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck size={13} />
                    {listing.seller}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Star size={12} className="fill-white text-white" />
                    {listing.rating.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="font-[var(--font-space-grotesk)] text-xl font-bold text-white">
                    {formatPrice(listing.price, listing.currency)}
                  </p>
                  <span className="rounded-lg border border-white/20 bg-white/10 px-2.5 py-1 text-xs text-zinc-200">
                    View
                  </span>
                </div>
              </div>
            </button>
          ))}
      </section>

      {ready && !loading && listings.length === 0 && (
        <div className="glass-panel rounded-2xl p-10 text-center">
          <p className="font-[var(--font-space-grotesk)] text-xl font-semibold text-white">
            No listings found
          </p>
          <p className="mt-2 text-sm text-zinc-300">
            Try searching with a game title, rank keyword, or skin name.
          </p>
        </div>
      )}

      {activeListing && (
        <div className="glass-panel fixed bottom-4 left-4 right-4 z-20 mx-auto max-w-5xl rounded-2xl p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Selected Offer</p>
              <p className="mt-1 font-[var(--font-space-grotesk)] text-lg font-semibold text-white">
                {activeListing.title}
              </p>
              <p className="text-sm text-zinc-300">
                {formatPrice(activeListing.price, activeListing.currency)} - {activeListing.seller}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setActiveListingId(null)}>
                Close
              </Button>
              <Button>Buy Now</Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
