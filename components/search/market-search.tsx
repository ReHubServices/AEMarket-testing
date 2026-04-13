"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Sparkles, Star, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { MarketListing, PublicViewer } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProductDetailModal } from "@/components/search/product-detail-modal";

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

type ListingDetailResponse = {
  listing: MarketListing;
};

type MarketSearchProps = {
  viewer: PublicViewer | null;
};

export function MarketSearch({ viewer }: MarketSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"relevance" | "price_asc" | "price_desc" | "newest">(
    "relevance"
  );
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [activeListingId, setActiveListingId] = useState<string | null>(null);
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailListing, setDetailListing] = useState<MarketListing | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query);

  useEffect(() => {
    let cancelled = false;
    const normalized = debouncedQuery.trim();

    if (!normalized) {
      setListings([]);
      setLoading(false);
      setReady(true);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    async function runSearch() {
      setError(null);
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("q", normalized);
        params.set("sort", sort);
        if (minPrice.trim()) {
          params.set("minPrice", minPrice.trim());
        }
        if (maxPrice.trim()) {
          params.set("maxPrice", maxPrice.trim());
        }

        const response = await fetch(`/api/search?${params.toString()}`, {
          cache: "no-store"
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(payload.error || "Search failed");
        }
        const data: SearchResponse = await response.json();
        if (!cancelled) {
          setListings(Array.isArray(data.listings) ? data.listings : []);
        }
      } catch (searchError) {
        if (!cancelled) {
          setListings([]);
          const message =
            searchError instanceof Error ? searchError.message : "Unable to load listings";
          setError(message);
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
  }, [debouncedQuery, sort, minPrice, maxPrice]);

  useEffect(() => {
    const itemId = searchParams.get("item");
    if (itemId) {
      setActiveListingId(itemId);
    }
  }, [searchParams]);

  const activeListing = useMemo(
    () => listings.find((listing) => listing.id === activeListingId) ?? null,
    [activeListingId, listings]
  );
  const modalListing = detailListing ?? activeListing;

  useEffect(() => {
    let cancelled = false;
    const targetId = activeListingId ?? "";

    if (!targetId) {
      setDetailListing(null);
      setDetailLoading(false);
      setDetailError(null);
      return () => {
        cancelled = true;
      };
    }

    setDetailLoading(true);
    setDetailError(null);
    setDetailListing(null);

    async function fetchDetail() {
      try {
        const response = await fetch(`/api/listings/${encodeURIComponent(targetId)}`, {
          cache: "no-store"
        });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          listing?: MarketListing;
        };
        if (!response.ok) {
          throw new Error(payload.error || "Unable to load full details");
        }
        if (!cancelled && payload.listing) {
          setDetailListing(payload.listing);
        }
      } catch (detailFetchError) {
        if (!cancelled) {
          const message =
            detailFetchError instanceof Error
              ? detailFetchError.message
              : "Unable to load full details";
          setDetailError(message);
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    }

    fetchDetail();

    return () => {
      cancelled = true;
    };
  }, [activeListingId]);

  async function handleBuy(listingId: string) {
    if (!viewer) {
      router.push(`/login?next=${encodeURIComponent(`/?item=${listingId}`)}`);
      return;
    }

    setBuying(true);
    setError(null);
    try {
      const response = await fetch("/api/purchase", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          listingId
        })
      });

      const payload = (await response.json()) as { checkoutUrl?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to start purchase");
      }
      if (!payload.checkoutUrl) {
        throw new Error("Checkout URL missing");
      }
      window.location.assign(payload.checkoutUrl);
    } catch (purchaseError) {
      const message =
        purchaseError instanceof Error ? purchaseError.message : "Purchase failed";
      setError(message);
      setBuying(false);
    }
  }

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
                Welcome to AE EMPIRE
              </h1>
              <p className="max-w-2xl text-sm text-zinc-300 md:text-base">
                We offer Fortnite accounts and more for sale through AE Marketplace. All
                accounts are guaranteed to meet the advertised specifications at the time of
                purchase.
              </p>
            </div>
          </div>
          <div className="flex gap-3 text-xs text-zinc-300">
            <div className="glass-panel rounded-2xl px-4 py-3">
              <p className="font-semibold text-white">100%</p>
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
        <div className="flex flex-col gap-4">
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
                placeholder="Search by game, skin, rank, in-game item"
              />
            </div>
            {!viewer && (
              <Link href="/login">
                <Button className="min-w-[136px]">Sign In To Buy</Button>
              </Link>
            )}
            {viewer && (
              <div className="flex items-center gap-2">
                <div className="inline-flex h-12 min-w-[180px] items-center justify-center gap-2 rounded-xl border border-white/15 bg-black/35 px-4 text-sm text-zinc-200">
                  <Wallet size={16} />
                  Balance {formatPrice(viewer.balance, "USD")}
                </div>
                <a href="/wallet/add-funds">
                  <Button variant="ghost" className="h-12">
                    Add Funds
                  </Button>
                </a>
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-xs text-zinc-400">
              Sort
              <select
                value={sort}
                onChange={(event) =>
                  setSort(
                    event.target.value as
                      | "relevance"
                      | "price_asc"
                      | "price_desc"
                      | "newest"
                  )
                }
                className="h-11 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
              >
                <option value="relevance">Relevance</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="newest">Newest</option>
              </select>
            </label>

            <label className="space-y-1 text-xs text-zinc-400">
              Min Price
              <Input
                type="number"
                min={0}
                value={minPrice}
                onChange={(event) => setMinPrice(event.target.value)}
                placeholder="0"
              />
            </label>

            <label className="space-y-1 text-xs text-zinc-400">
              Max Price
              <Input
                type="number"
                min={0}
                value={maxPrice}
                onChange={(event) => setMaxPrice(event.target.value)}
                placeholder="No limit"
              />
            </label>
          </div>
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
                <div className="flex items-center justify-end text-xs text-zinc-300">
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

      {ready && !loading && !query.trim() && (
        <div className="glass-panel rounded-2xl p-10 text-center">
          <p className="font-[var(--font-space-grotesk)] text-xl font-semibold text-white">
            Most Popular Listings
          </p>
          <p className="mt-2 text-sm text-zinc-300">
            No featured data yet. Search any keyword to find matching accounts across all
            categories.
          </p>
        </div>
      )}

      {ready && !loading && query.trim() && listings.length === 0 && (
        <div className="glass-panel rounded-2xl p-10 text-center">
          <p className="font-[var(--font-space-grotesk)] text-xl font-semibold text-white">
            No listings found
          </p>
          <p className="mt-2 text-sm text-zinc-300">
            Try searching with a game title, rank keyword, or skin name.
          </p>
        </div>
      )}

      {error && (
        <div className="glass-panel rounded-2xl border border-red-300/20 bg-red-950/20 p-4 text-sm text-red-100">
          {error}
        </div>
      )}

      <ProductDetailModal
        listing={modalListing}
        viewer={viewer}
        onClose={() => setActiveListingId(null)}
        onBuy={handleBuy}
        buying={buying}
        descriptionLoading={detailLoading}
        descriptionError={detailError}
      />
    </main>
  );
}
