"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Sparkles, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { MarketListing, PublicViewer } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProductDetailModal } from "@/components/search/product-detail-modal";
import { getListingImage, getPresetListingImage } from "@/lib/listing-images";

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
  pagination?: {
    page: number;
    pageSize: number;
    hasMore: boolean;
  };
};

type MarketSearchProps = {
  viewer: PublicViewer | null;
};

type GameFilterTarget =
  | "all"
  | "fortnite"
  | "valorant"
  | "siege"
  | "media"
  | "telegram"
  | "discord"
  | "steam"
  | "cs2"
  | "battlenet";

const GAME_SEARCH_PARAMS: Record<
  GameFilterTarget,
  { game?: string; category?: string }
> = {
  all: {},
  fortnite: { game: "fortnite", category: "fortnite" },
  valorant: { game: "valorant", category: "riot" },
  siege: { game: "siege", category: "rainbow-six-siege" },
  media: { game: "social", category: "media" },
  telegram: { game: "telegram", category: "telegram" },
  discord: { game: "discord", category: "discord" },
  steam: { game: "steam", category: "steam" },
  cs2: { game: "cs2", category: "steam" },
  battlenet: { game: "battlenet", category: "battlenet" }
};

const GAME_TOGGLE_FILTERS: Record<
  Exclude<GameFilterTarget, "all">,
  Array<{ key: string; label: string }>
> = {
  fortnite: [
    { key: "first_owner", label: "First Owner" },
    { key: "ma", label: "Mail Access" }
  ],
  valorant: [
    { key: "ma", label: "Mail Access" }
  ],
  siege: [
    { key: "ma", label: "Mail Access" }
  ],
  media: [
    { key: "ma", label: "Mail Access" }
  ],
  telegram: [
    { key: "ma", label: "Mail Access" },
    { key: "online", label: "Online Access" }
  ],
  discord: [
    { key: "ma", label: "Mail Access" },
    { key: "online", label: "Online Access" }
  ],
  steam: [
    { key: "first_owner", label: "First Owner" },
    { key: "ma", label: "Mail Access" },
    { key: "vac", label: "VAC Clean" }
  ],
  cs2: [
    { key: "first_owner", label: "First Owner" },
    { key: "ma", label: "Mail Access" },
    { key: "vac", label: "VAC Clean" }
  ],
  battlenet: [
    { key: "ma", label: "Mail Access" },
    { key: "online", label: "Online Access" }
  ]
};

export function MarketSearch({ viewer }: MarketSearchProps) {
  const PAGE_SIZE = 15;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"relevance" | "price_asc" | "price_desc" | "newest">(
    "relevance"
  );
  const [selectedGame, setSelectedGame] = useState<GameFilterTarget>("all");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [gameFilters, setGameFilters] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeListingId, setActiveListingId] = useState<string | null>(null);
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailListing, setDetailListing] = useState<MarketListing | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query);

  function changePage(nextPage: number) {
    const normalized = Math.max(1, nextPage);
    setCurrentPage(normalized);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  useEffect(() => {
    setGameFilters({});
  }, [selectedGame]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, sort, selectedGame, minPrice, maxPrice, gameFilters]);

  useEffect(() => {
    let cancelled = false;
    const normalized = debouncedQuery.trim();
    const hasSearchContext = Boolean(normalized) || selectedGame !== "all";

    if (!hasSearchContext) {
      setListings([]);
      setHasMore(false);
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
        if (normalized) {
          params.set("q", normalized);
        }
        params.set("page", String(currentPage));
        params.set("pageSize", String(PAGE_SIZE));
        params.set("sort", sort);
        const searchTarget = GAME_SEARCH_PARAMS[selectedGame];
        if (searchTarget.game) {
          params.set("game", searchTarget.game);
        }
        if (searchTarget.category) {
          params.set("category", searchTarget.category);
        }
        if (selectedGame === "media") {
          const mediaPlatform = (gameFilters.media_platform ?? "").trim();
          if (mediaPlatform) {
            params.set("category", mediaPlatform);
          }
        }
        if (minPrice.trim()) {
          params.set("minPrice", minPrice.trim());
        }
        if (maxPrice.trim()) {
          params.set("maxPrice", maxPrice.trim());
        }
        for (const [key, value] of Object.entries(gameFilters)) {
          const normalizedValue = value.trim();
          if (normalizedValue) {
            params.set(key, normalizedValue);
          }
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
          setHasMore(Boolean(data.pagination?.hasMore));
        }
      } catch (searchError) {
        if (!cancelled) {
          setListings([]);
          setHasMore(false);
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
  }, [
    debouncedQuery,
    sort,
    selectedGame,
    minPrice,
    maxPrice,
    gameFilters,
    currentPage,
  ]);

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

  function resetAdvancedFilters() {
    setSelectedGame("all");
    setGameFilters({});
  }

  function setGameFilter(key: string, value: string) {
    setGameFilters((previous) => ({
      ...previous,
      [key]: value
    }));
  }

  const activeAdvancedFiltersCount = [
    selectedGame !== "all",
    ...Object.values(gameFilters).map((value) => Boolean(value.trim()))
  ].filter(Boolean).length;
  const selectedGameToggles =
    selectedGame === "all" ? [] : GAME_TOGGLE_FILTERS[selectedGame];
  const hasSearchContext = Boolean(query.trim()) || selectedGame !== "all";
  const pageButtons = useMemo(() => {
    const numbers = new Set<number>([currentPage]);
    if (currentPage > 1) {
      numbers.add(currentPage - 1);
      numbers.add(1);
    }
    if (hasMore) {
      numbers.add(currentPage + 1);
    }
    return Array.from(numbers)
      .filter((value) => value > 0)
      .sort((a, b) => a - b);
  }, [currentPage, hasMore]);

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
                We offer Fortnite, Siege, media accounts, and more through AE Marketplace.
                All accounts are guaranteed to meet the advertised specifications at the time
                of purchase.
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
                placeholder="Search by title, skin, rank, item"
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

          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1 text-xs text-zinc-400">
              Category
              <select
                value={selectedGame}
                onChange={(event) => setSelectedGame(event.target.value as GameFilterTarget)}
                className="h-11 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
              >
                <option value="all">All Categories</option>
                <option value="fortnite">Fortnite</option>
                <option value="valorant">Valorant</option>
                <option value="siege">Rainbow Six Siege</option>
                <option value="media">Media Accounts</option>
                <option value="steam">Steam</option>
                <option value="cs2">Counter-Strike 2</option>
                <option value="telegram">Telegram</option>
                <option value="discord">Discord</option>
                <option value="battlenet">Battle.net</option>
              </select>
            </label>

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

          <div className="rounded-2xl border border-white/15 bg-black/25 p-4">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setAdvancedOpen((previous) => !previous)}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-xs uppercase tracking-[0.16em] text-zinc-200 transition hover:border-white/20 hover:text-white"
              >
                Advanced Filters
                {activeAdvancedFiltersCount > 0 && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] tracking-normal text-white">
                    {activeAdvancedFiltersCount}
                  </span>
                )}
                <span className="text-[11px] normal-case text-zinc-300">
                  {advancedOpen ? "Hide" : "Show"}
                </span>
              </button>
              <Button type="button" variant="ghost" className="h-8 px-3" onClick={resetAdvancedFilters}>
                Reset
              </Button>
            </div>

            {advancedOpen && (
              <div className="mt-3 grid gap-3 xl:grid-cols-2">
                {selectedGame !== "all" && (
                  <div className="space-y-3 rounded-xl border border-white/10 bg-black/25 p-3 xl:col-span-2">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                      Category Filters
                    </p>

                    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                      {selectedGameToggles.map((toggle) => (
                        <label
                          key={`${selectedGame}_${toggle.key}`}
                          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-zinc-200"
                        >
                          <input
                            type="checkbox"
                            checked={(gameFilters[toggle.key] ?? "") === "1"}
                            onChange={(event) =>
                              setGameFilter(toggle.key, event.target.checked ? "1" : "")
                            }
                            className="h-4 w-4"
                          />
                          {toggle.label}
                        </label>
                      ))}
                    </div>

                    {selectedGame === "fortnite" && (
                      <div className="grid gap-2 md:grid-cols-3">
                        <label className="space-y-1 text-xs text-zinc-400">
                          Skins From
                          <Input
                            type="number"
                            min={0}
                            value={gameFilters.fortnite_skin_count_min ?? ""}
                            onChange={(event) =>
                              setGameFilter("fortnite_skin_count_min", event.target.value)
                            }
                            placeholder="0"
                            className="h-10"
                          />
                        </label>
                        <label className="space-y-1 text-xs text-zinc-400">
                          Level From
                          <Input
                            type="number"
                            min={0}
                            value={gameFilters.fortnite_level_min ?? ""}
                            onChange={(event) =>
                              setGameFilter("fortnite_level_min", event.target.value)
                            }
                            placeholder="0"
                            className="h-10"
                          />
                        </label>
                        <label className="space-y-1 text-xs text-zinc-400">
                          Wins From
                          <Input
                            type="number"
                            min={0}
                            value={gameFilters.fortnite_lifetime_wins_min ?? ""}
                            onChange={(event) =>
                              setGameFilter("fortnite_lifetime_wins_min", event.target.value)
                            }
                            placeholder="0"
                            className="h-10"
                          />
                        </label>
                      </div>
                    )}

                    {selectedGame === "valorant" && (
                      <div className="grid gap-2 md:grid-cols-3">
                        <label className="space-y-1 text-xs text-zinc-400">
                          Rank
                          <Input
                            value={gameFilters.valorant_rank ?? ""}
                            onChange={(event) =>
                              setGameFilter("valorant_rank", event.target.value)
                            }
                            placeholder="Iron, Gold, Immortal..."
                            className="h-10"
                          />
                        </label>
                        <label className="space-y-1 text-xs text-zinc-400">
                          Skins From
                          <Input
                            type="number"
                            min={0}
                            value={gameFilters.valorant_skin_count_min ?? ""}
                            onChange={(event) =>
                              setGameFilter("valorant_skin_count_min", event.target.value)
                            }
                            placeholder="0"
                            className="h-10"
                          />
                        </label>
                        <label className="space-y-1 text-xs text-zinc-400">
                          Agents From
                          <Input
                            type="number"
                            min={0}
                            value={gameFilters.valorant_agents_count_min ?? ""}
                            onChange={(event) =>
                              setGameFilter("valorant_agents_count_min", event.target.value)
                            }
                            placeholder="0"
                            className="h-10"
                          />
                        </label>
                      </div>
                    )}

                    {selectedGame === "telegram" && (
                      <div className="grid gap-2 md:grid-cols-2">
                        <label className="space-y-1 text-xs text-zinc-400">
                          Country
                          <Input
                            value={gameFilters.telegram_country ?? ""}
                            onChange={(event) =>
                              setGameFilter("telegram_country", event.target.value)
                            }
                            placeholder="US, GB, DE..."
                            className="h-10"
                          />
                        </label>
                        <label className="space-y-1 text-xs text-zinc-400">
                          Premium
                          <select
                            value={gameFilters.telegram_premium ?? ""}
                            onChange={(event) =>
                              setGameFilter("telegram_premium", event.target.value)
                            }
                            className="h-10 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">Any</option>
                            <option value="1">Only Premium</option>
                            <option value="0">Without Premium</option>
                          </select>
                        </label>
                      </div>
                    )}

                    {selectedGame === "media" && (
                      <div className="grid gap-2 md:grid-cols-3">
                        <label className="space-y-1 text-xs text-zinc-400">
                          Platform
                          <select
                            value={gameFilters.media_platform ?? ""}
                            onChange={(event) =>
                              setGameFilter("media_platform", event.target.value)
                            }
                            className="h-10 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">All Media Platforms</option>
                            <option value="instagram">Instagram</option>
                            <option value="tiktok">TikTok</option>
                            <option value="facebook">Facebook</option>
                            <option value="telegram">Telegram</option>
                            <option value="discord">Discord</option>
                            <option value="youtube">YouTube</option>
                            <option value="twitter">X / Twitter</option>
                          </select>
                        </label>
                        <label className="space-y-1 text-xs text-zinc-400">
                          Min Followers
                          <Input
                            type="number"
                            min={0}
                            value={gameFilters.media_followers_min ?? ""}
                            onChange={(event) =>
                              setGameFilter("media_followers_min", event.target.value)
                            }
                            placeholder="0"
                            className="h-10"
                          />
                        </label>
                        <label className="space-y-1 text-xs text-zinc-400">
                          Verified
                          <select
                            value={gameFilters.media_verified ?? ""}
                            onChange={(event) =>
                              setGameFilter("media_verified", event.target.value)
                            }
                            className="h-10 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">Any</option>
                            <option value="1">Verified Only</option>
                            <option value="0">Not Verified</option>
                          </select>
                        </label>
                      </div>
                    )}

                    {selectedGame === "discord" && (
                      <div className="grid gap-2 md:grid-cols-1">
                        <label className="space-y-1 text-xs text-zinc-400">
                          Nitro
                          <select
                            value={gameFilters.discord_nitro ?? ""}
                            onChange={(event) => setGameFilter("discord_nitro", event.target.value)}
                            className="h-10 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">Any</option>
                            <option value="1">Only Nitro</option>
                            <option value="0">Without Nitro</option>
                          </select>
                        </label>
                      </div>
                    )}

                    {selectedGame === "steam" && (
                      <div className="grid gap-2 md:grid-cols-1">
                        <label className="space-y-1 text-xs text-zinc-400">
                          Games From
                          <Input
                            type="number"
                            min={0}
                            value={gameFilters.steam_game_count_min ?? ""}
                            onChange={(event) =>
                              setGameFilter("steam_game_count_min", event.target.value)
                            }
                            placeholder="0"
                            className="h-10"
                          />
                        </label>
                      </div>
                    )}

                    {selectedGame === "cs2" && (
                      <div className="grid gap-2 md:grid-cols-2">
                        <label className="space-y-1 text-xs text-zinc-400">
                          Prime
                          <select
                            value={gameFilters.cs2_prime ?? ""}
                            onChange={(event) => setGameFilter("cs2_prime", event.target.value)}
                            className="h-10 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">Any</option>
                            <option value="1">Prime Only</option>
                            <option value="0">No Prime</option>
                          </select>
                        </label>
                        <label className="space-y-1 text-xs text-zinc-400">
                          Rank
                          <Input
                            value={gameFilters.cs2_rank ?? ""}
                            onChange={(event) => setGameFilter("cs2_rank", event.target.value)}
                            placeholder="Global, Faceit, etc."
                            className="h-10"
                          />
                        </label>
                      </div>
                    )}

                    {selectedGame === "battlenet" && (
                      <div className="grid gap-2 md:grid-cols-1">
                        <label className="space-y-1 text-xs text-zinc-400">
                          Region
                          <select
                            value={gameFilters.battlenet_region ?? ""}
                            onChange={(event) =>
                              setGameFilter("battlenet_region", event.target.value)
                            }
                            className="h-10 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">Any</option>
                            <option value="EU">EU</option>
                            <option value="NA">NA</option>
                            <option value="ASIA">Asia</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {selectedGame === "all" && (
                  <div className="rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-zinc-300">
                    Select a category above to see its specific filters.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loading && (
          <div className="glass-panel col-span-full rounded-2xl p-4 md:p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">Searching marketplace...</p>
                <p className="mt-1 text-xs text-zinc-300">
                  {query.trim()
                    ? `Looking for matches for "${query.trim()}" across all categories`
                    : "Loading listings for selected category"}
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white/70" />
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white/50 [animation-delay:180ms]" />
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white/35 [animation-delay:360ms]" />
              </div>
            </div>
          </div>
        )}

        {loading &&
          Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="glass-panel animate-pulseSoft overflow-hidden rounded-2xl p-4"
            >
              <div className="relative h-44 overflow-hidden rounded-xl bg-white/8">
                <div className="absolute inset-0 animate-pulseSoft bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              </div>
              <div className="mt-4 h-4 w-4/5 rounded bg-white/10" />
              <div className="mt-2 h-3 w-3/5 rounded bg-white/10" />
              <div className="mt-5 flex items-center justify-between">
                <div className="h-6 w-24 rounded bg-white/10" />
                <div className="h-6 w-14 rounded bg-white/10" />
              </div>
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
                  src={getListingImage(listing)}
                  alt={listing.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.onerror = null;
                    event.currentTarget.src = getPresetListingImage(listing);
                  }}
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

      {ready && !loading && (listings.length > 0 || currentPage > 1 || hasMore) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-9 px-3"
            disabled={currentPage <= 1}
            onClick={() => changePage(currentPage - 1)}
          >
            Prev
          </Button>
          {pageButtons.map((pageNumber) => (
            <Button
              key={pageNumber}
              type="button"
              variant={currentPage === pageNumber ? "solid" : "ghost"}
              className="h-9 min-w-9 px-3"
              onClick={() => changePage(pageNumber)}
            >
              {pageNumber}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            className="h-9 px-3"
            disabled={!hasMore}
            onClick={() => changePage(currentPage + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {ready && !loading && !hasSearchContext && (
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

      {ready && !loading && hasSearchContext && listings.length === 0 && (
        <div className="glass-panel rounded-2xl p-10 text-center">
          <p className="font-[var(--font-space-grotesk)] text-xl font-semibold text-white">
            No listings found
          </p>
          <p className="mt-2 text-sm text-zinc-300">
            Try changing the selected category, filters, or search keywords.
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
