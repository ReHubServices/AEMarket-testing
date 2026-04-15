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

const CATEGORY_SUGGESTION_SEEDS: Record<GameFilterTarget, string[]> = {
  all: [
    "Fortnite",
    "Valorant",
    "Steam",
    "CS2",
    "Telegram",
    "Discord",
    "Instagram",
    "TikTok",
    "YouTube",
    "Facebook",
    "Verified",
    "High Level",
    "Stacked",
    "OG"
  ],
  fortnite: [
    "Galaxy",
    "Galaxy Scout",
    "Galaxy Grappler",
    "Skull Trooper",
    "Renegade Raider",
    "Black Knight",
    "Aerial Assault Trooper",
    "Ikonik",
    "Glow",
    "Honor Guard",
    "Travis Scott",
    "Leviathan Axe",
    "Mako",
    "Take the L",
    "OG",
    "Stacked",
    "Season 1",
    "Season 2",
    "Rare emotes",
    "Many skins",
    "FA account",
    "NFA account"
  ],
  valorant: [
    "Radiant",
    "Immortal",
    "Ascendant",
    "Diamond",
    "Platinum",
    "Champions",
    "Vandal skins",
    "Phantom skins",
    "Knife skins",
    "Prime Vandal",
    "RGX",
    "Reaver",
    "Oni",
    "Spectrum",
    "Many agents",
    "All agents",
    "Level 20+",
    "Premier ready"
  ],
  siege: [
    "Champion",
    "Diamond",
    "Emerald",
    "Ranked",
    "Elite skins",
    "Black Ice",
    "Year 1 operators",
    "All operators",
    "High level",
    "Rare skins",
    "R6 credits",
    "Ubisoft connect"
  ],
  media: [
    "Instagram",
    "TikTok",
    "Facebook",
    "YouTube",
    "Twitter",
    "Verified",
    "Blue check",
    "Monetized",
    "Followers",
    "High engagement",
    "OG username",
    "Aged account",
    "US audience",
    "EU audience",
    "Business page",
    "Creator account"
  ],
  telegram: [
    "Premium",
    "US",
    "EU",
    "Aged",
    "Old account",
    "Rare username",
    "Short username",
    "Channel owner",
    "2FA disabled",
    "Mail access",
    "Many dialogs"
  ],
  discord: [
    "Nitro",
    "Aged",
    "Verified",
    "Phone verified",
    "Rare username",
    "Old token",
    "Many friends",
    "Server owner",
    "Mail access",
    "No flags"
  ],
  steam: [
    "Prime",
    "VAC Clean",
    "Faceit",
    "CS2",
    "Dota",
    "Rust",
    "PUBG",
    "GTA V",
    "High level",
    "Many games",
    "Inventory",
    "Knife",
    "Gloves",
    "Medals",
    "Years of service",
    "Trusted"
  ],
  cs2: [
    "Prime",
    "Faceit level 10",
    "Global",
    "Supreme",
    "LEM",
    "Knife",
    "Gloves",
    "Inventory",
    "Medals",
    "Service medal",
    "VAC Clean",
    "Premier rating",
    "High trust"
  ],
  battlenet: [
    "EU",
    "NA",
    "Asia",
    "Overwatch",
    "COD",
    "Diablo",
    "WoW",
    "Rare skins",
    "High level",
    "Mail access"
  ]
};

const GLOBAL_SUGGESTION_POOL = [
  "Account",
  "Stacked",
  "OG",
  "Rare",
  "Ultra Rare",
  "Legendary",
  "Mythic",
  "Epic",
  "Full Access",
  "Mail Access",
  "First Owner",
  "Verified",
  "Aged",
  "Old Account",
  "High Level",
  "Premium",
  "Cheap",
  "Budget",
  "Instant Delivery",
  "Secure",
  "Fortnite",
  "Galaxy",
  "Glow",
  "Ikonik",
  "Black Knight",
  "Skull Trooper",
  "Renegade Raider",
  "Aerial Assault Trooper",
  "Travis Scott",
  "Mako",
  "Take the L",
  "OG Skins",
  "Season 1",
  "Season 2",
  "Save The World",
  "Valorant",
  "Radiant",
  "Immortal",
  "Ascendant",
  "Diamond",
  "Champions",
  "Prime Vandal",
  "Reaver",
  "Oni",
  "RGX",
  "Spectrum",
  "Knife Skins",
  "All Agents",
  "Steam",
  "Steam Level",
  "Many Games",
  "VAC Clean",
  "Prime Enabled",
  "CS2",
  "Counter Strike",
  "Faceit",
  "Global Elite",
  "Supreme",
  "Premier Rating",
  "Knife",
  "Gloves",
  "Medals",
  "Rust",
  "Dota 2",
  "PUBG",
  "GTA V",
  "R6",
  "Rainbow Six Siege",
  "Champion",
  "Elite Skins",
  "Black Ice",
  "All Operators",
  "Instagram",
  "TikTok",
  "YouTube",
  "Facebook",
  "Twitter",
  "Discord",
  "Telegram",
  "Followers",
  "Subscribers",
  "Engagement",
  "Creator",
  "Business",
  "Monetized",
  "Blue Check",
  "Nitro",
  "Phone Verified",
  "Server Owner",
  "Battle.net",
  "Overwatch",
  "Call of Duty",
  "Diablo",
  "World of Warcraft",
  "EU",
  "NA",
  "Asia",
  "US",
  "TR",
  "DE"
];

type RarityTone = {
  label: string;
  nameClass: string;
};

function normalizeSuggestionValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function isSubsequenceMatch(haystack: string, needle: string) {
  if (!needle) {
    return true;
  }
  let pointer = 0;
  for (const char of haystack) {
    if (char === needle[pointer]) {
      pointer += 1;
      if (pointer === needle.length) {
        return true;
      }
    }
  }
  return false;
}

function addTokenizedSuggestions(source: Set<string>, text: string) {
  const words = text
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && word.length <= 22);

  for (const word of words) {
    source.add(word);
  }

  for (let index = 0; index < words.length - 1; index += 1) {
    const pair = `${words[index]} ${words[index + 1]}`;
    if (pair.length >= 7 && pair.length <= 44) {
      source.add(pair);
    }
  }

  for (let index = 0; index < words.length - 2; index += 1) {
    const triple = `${words[index]} ${words[index + 1]} ${words[index + 2]}`;
    if (triple.length >= 10 && triple.length <= 58) {
      source.add(triple);
    }
  }
}

function inferRarityTone(listing: MarketListing): RarityTone {
  const text = `${listing.title} ${listing.description} ${listing.specs
    .map((spec) => `${spec.label} ${spec.value}`)
    .join(" ")}`.toLowerCase();

  if (text.includes("mythic")) {
    return { label: "Mythic", nameClass: "text-rose-300" };
  }
  if (text.includes("legendary")) {
    return { label: "Legendary", nameClass: "text-amber-300" };
  }
  if (text.includes("epic")) {
    return { label: "Epic", nameClass: "text-fuchsia-300" };
  }
  if (text.includes("rare")) {
    return { label: "Rare", nameClass: "text-sky-300" };
  }
  if (text.includes("uncommon")) {
    return { label: "Uncommon", nameClass: "text-emerald-300" };
  }
  if (text.includes("common")) {
    return { label: "Common", nameClass: "text-zinc-200" };
  }
  if (text.includes("icon")) {
    return { label: "Icon", nameClass: "text-cyan-300" };
  }
  return { label: "Standard", nameClass: "text-white" };
}

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
  const [searchFocused, setSearchFocused] = useState(false);
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
  const suggestions = useMemo(() => {
    const normalized = normalizeSuggestionValue(query);
    if (normalized.length < 1) {
      return [];
    }

    const source = new Set<string>(CATEGORY_SUGGESTION_SEEDS[selectedGame]);
    for (const generic of CATEGORY_SUGGESTION_SEEDS.all) {
      source.add(generic);
    }
    for (const global of GLOBAL_SUGGESTION_POOL) {
      source.add(global);
    }
    for (const listing of listings) {
      const title = listing.title.trim();
      if (title && title.length <= 96) {
        source.add(title);
      }
      addTokenizedSuggestions(source, title);
      addTokenizedSuggestions(source, listing.description);
      for (const spec of listing.specs) {
        const value = spec.value.trim();
        if (value.length >= 3 && value.length <= 88) {
          source.add(value);
        }
        const label = spec.label.trim();
        if (label.length >= 3 && label.length <= 44) {
          source.add(label);
        }
        addTokenizedSuggestions(source, `${label} ${value}`);
      }
    }

    const scored = Array.from(source)
      .map((value) => {
        const normalizedCandidate = normalizeSuggestionValue(value);
        if (!normalizedCandidate) {
          return null;
        }
        const queryWords = normalized.split(" ");
        const candidateWords = normalizedCandidate.split(" ");
        const starts = normalizedCandidate.startsWith(normalized);
        const contains = normalizedCandidate.includes(normalized);
        const wordStarts = candidateWords.some((word) =>
          queryWords.some((token) => token.length > 0 && word.startsWith(token))
        );
        const subsequence = isSubsequenceMatch(normalizedCandidate.replace(/\s+/g, ""), normalized.replace(/\s+/g, ""));

        if (!starts && !contains && !wordStarts && !subsequence) {
          return null;
        }

        const score = starts ? 0 : wordStarts ? 1 : contains ? 2 : 3;
        return { value, score };
      })
      .filter((entry): entry is { value: string; score: number } => Boolean(entry))
      .sort((a, b) => {
        if (a.score !== b.score) {
          return a.score - b.score;
        }
        const aNorm = normalizeSuggestionValue(a.value);
        const bNorm = normalizeSuggestionValue(b.value);
        if (aNorm.length !== bNorm.length) {
          return aNorm.length - bNorm.length;
        }
        return aNorm.localeCompare(bNorm);
      })
      .slice(0, 80)
      .map((entry) => entry.value);

    return scored;
  }, [query, selectedGame, listings]);
  const showSuggestions = searchFocused && suggestions.length > 0;

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
                onFocus={() => setSearchFocused(true)}
                onBlur={() => {
                  window.setTimeout(() => setSearchFocused(false), 120);
                }}
                className="pl-11"
                placeholder="Search by title, skin, rank, item"
              />
              {showSuggestions && (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-96 overflow-y-auto rounded-xl border border-white/15 bg-black/80 p-1 backdrop-blur">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setQuery(suggestion);
                        setSearchFocused(false);
                      }}
                      className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-white/10"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
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
          <div className="glass-panel col-span-full rounded-2xl p-6 text-center">
            <p className="text-base font-semibold text-white">Loading listings, please wait...</p>
            <div className="mt-3 inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-emerald-300 [animation-delay:-0.3s]" />
              <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-emerald-300/85 [animation-delay:-0.15s]" />
              <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-emerald-300/70" />
            </div>
          </div>
        )}

        {!loading &&
          listings.map((listing) => {
            const rarityTone = inferRarityTone(listing);
            return (
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
                    decoding="async"
                    referrerPolicy="no-referrer"
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
                    <h3
                      className={cn(
                        "max-h-[3.4rem] overflow-hidden font-[var(--font-space-grotesk)] text-lg font-semibold",
                        rarityTone.nameClass
                      )}
                    >
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
                      {rarityTone.label}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
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
