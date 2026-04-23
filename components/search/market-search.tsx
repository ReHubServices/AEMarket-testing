"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Wallet, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { MarketListing, PublicViewer } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProductDetailModal } from "@/components/search/product-detail-modal";
import { getListingImageWithOptions, getPresetListingImage } from "@/lib/listing-images";

function formatPrice(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(value);
}

function isFortniteMarketGallerySource(url: string) {
  const normalized = String(url ?? "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    /(?:lzt\.market|lolz\.guru)\/(?:market\/)?\d+\/image\?(?:[^#\s]*)type=/.test(normalized) ||
    /^\/(?:market\/)?\d+\/image\?(?:[^#\s]*)type=/.test(normalized)
  );
}

function isDisplayImage(url: string) {
  const normalized = String(url ?? "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    normalized.includes("/listing-placeholder.svg") ||
    normalized.includes("/logo.png") ||
    normalized.includes("/logo.svg") ||
    normalized.includes("images.unsplash.com") ||
    normalized.includes("unsplash.com")
  ) {
    return false;
  }
  return true;
}

function mergeListingForModal(base: MarketListing | null, detail: MarketListing | null) {
  if (!base && !detail) {
    return null;
  }
  if (!detail) {
    return base;
  }
  if (!base) {
    return detail;
  }

  const baseImage = String(base.imageUrl ?? "").trim();
  const detailImage = String(detail.imageUrl ?? "").trim();
  const keepBaseImage =
    (isFortniteMarketGallerySource(baseImage) && !isFortniteMarketGallerySource(detailImage)) ||
    (isDisplayImage(baseImage) && !isDisplayImage(detailImage));

  return {
    ...base,
    ...detail,
    imageUrl: keepBaseImage ? baseImage : detailImage || baseImage,
    description: detail.description?.trim() ? detail.description : base.description,
    specs:
      Array.isArray(detail.specs) && detail.specs.length > 0
        ? detail.specs
        : base.specs
  };
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
  homeTitle?: string;
  homeSubtitle?: string;
  announcementEnabled?: boolean;
  announcementText?: string;
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
  fortnite: [],
  valorant: [],
  siege: [],
  media: [],
  telegram: [],
  discord: [],
  steam: [],
  cs2: [],
  battlenet: []
};

const CATEGORY_SUGGESTION_SEEDS: Record<GameFilterTarget, string[]> = {
  all: [
    "Fortnite",
    "Riot Client",
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
    "Ghoul Trooper",
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
  "Ghoul Trooper",
  "Renegade Raider",
  "Aerial Assault Trooper",
  "Travis Scott",
  "Mako",
  "Take the L",
  "OG Skins",
  "Season 1",
  "Season 2",
  "Save The World",
  "Riot Client",
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

type FortniteSelectorKey =
  | "fortnite_outfits"
  | "fortnite_pickaxes"
  | "fortnite_emotes"
  | "fortnite_gliders";

type FortniteSelectorConfig = {
  key: FortniteSelectorKey;
  title: string;
  placeholder: string;
  options: string[];
};

const FORTNITE_SELECTOR_CONFIG: FortniteSelectorConfig[] = [
  {
    key: "fortnite_outfits",
    title: "Select outfits",
    placeholder: "Select outfits",
    options: [
      "Galaxy",
      "Galaxy Scout",
      "Galaxy Grappler",
      "Renegade Raider",
      "Aerial Assault Trooper",
      "Black Knight",
      "Skull Trooper",
      "Ghoul Trooper",
      "Ikonik",
      "Glow",
      "Honor Guard",
      "Wonder",
      "Wildcat",
      "Travis Scott",
      "Astro Jack",
      "LeBron James",
      "The Reaper",
      "Omega",
      "Raven",
      "Peely",
      "Midas",
      "Aura",
      "Crystal"
    ]
  },
  {
    key: "fortnite_pickaxes",
    title: "Select pickaxes",
    placeholder: "Select pickaxes",
    options: [
      "Leviathan Axe",
      "Raider's Revenge",
      "Axe of Champions",
      "Reaper",
      "Driver",
      "Star Wand",
      "Minty Axe",
      "Vision",
      "Ice Breaker",
      "Crowbar",
      "Harley Hitter",
      "Ski Boot",
      "Psycho Buzz Axes",
      "Candy Axe",
      "Studded Axe",
      "Throwback Axe"
    ]
  },
  {
    key: "fortnite_emotes",
    title: "Select emotes",
    placeholder: "Select emotes",
    options: [
      "Take the L",
      "Floss",
      "Orange Justice",
      "Scenario",
      "Fresh",
      "Dance Moves",
      "Electro Shuffle",
      "Laugh It Up",
      "Poki",
      "Slick",
      "The Renegade",
      "Rollie",
      "Never Gonna",
      "Billy Bounce",
      "Jabba Switchway",
      "Go Mufasa"
    ]
  },
  {
    key: "fortnite_gliders",
    title: "Select gliders",
    placeholder: "Select gliders",
    options: [
      "Mako",
      "Snowflake",
      "Founder's Glider",
      "Umbrella",
      "One Shot",
      "Paper Plane",
      "Classified",
      "Conquest",
      "Wet Paint",
      "Get Down!",
      "Dragacorn",
      "Cloud Llama Board",
      "Palm Leaf",
      "Wings of Valor",
      "Arcana"
    ]
  }
];

const FORTNITE_SELECTOR_LABEL_HINTS: Record<FortniteSelectorKey, string[]> = {
  fortnite_outfits: ["outfit", "outfits", "skin", "skins"],
  fortnite_pickaxes: ["pickaxe", "pickaxes", "axe", "harvesting"],
  fortnite_emotes: ["emote", "emotes", "dance", "dances"],
  fortnite_gliders: ["glider", "gliders"]
};

function splitFortniteSelectorParts(value: string) {
  return value
    .replace(/\[[^\]]+]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .split(/(?:\s*\|\s*|,\s*|;\s*|\/\s*|\n+|•)+/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractFortniteSelectorListingOptions(
  listing: MarketListing,
  selectorKey: FortniteSelectorKey
) {
  const hintTokens = FORTNITE_SELECTOR_LABEL_HINTS[selectorKey] ?? [];
  const output = new Set<string>();
  const add = (raw: string) => {
    const normalized = normalizeSelectorTerm(raw);
    if (normalized.length < 2 || normalized.length > 64) {
      return;
    }
    if (/^\d+$/.test(normalized)) {
      return;
    }
    output.add(normalized);
  };

  for (const spec of listing.specs) {
    const normalizedLabel = normalizeSuggestionValue(spec.label);
    if (!hintTokens.some((hint) => normalizedLabel.includes(hint))) {
      continue;
    }
    for (const part of splitFortniteSelectorParts(spec.value)) {
      add(part);
    }
  }

  const patternBySelector: Record<FortniteSelectorKey, RegExp> = {
    fortnite_outfits: /\b(?:outfits?|skins?)\s*[:=-]\s*([^\n\r]{2,280})/gi,
    fortnite_pickaxes: /\b(?:pickaxes?|axes?)\s*[:=-]\s*([^\n\r]{2,280})/gi,
    fortnite_emotes: /\b(?:emotes?|dances?)\s*[:=-]\s*([^\n\r]{2,280})/gi,
    fortnite_gliders: /\b(?:gliders?)\s*[:=-]\s*([^\n\r]{2,280})/gi
  };

  const pattern = patternBySelector[selectorKey];
  for (const match of listing.description.matchAll(pattern)) {
    for (const part of splitFortniteSelectorParts(match[1] ?? "")) {
      add(part);
    }
  }

  if (selectorKey === "fortnite_outfits") {
    for (const part of splitFortniteSelectorParts(listing.title)) {
      add(part);
    }
  }

  return Array.from(output).slice(0, 42);
}

type FilterOption = {
  value: string;
  label: string;
};

type RangeFilterConfig = {
  label: string;
  minKey: string;
  maxKey: string;
  minPlaceholder: string;
  maxPlaceholder: string;
};

type TextFilterConfig = {
  label: string;
  key: string;
  placeholder: string;
};

type TriStateFilterConfig = {
  label: string;
  key: string;
  options: FilterOption[];
};

const ANY_YES_NO_OPTIONS: FilterOption[] = [
  { value: "", label: "No matter" },
  { value: "1", label: "Yes" },
  { value: "0", label: "No" }
];

const ANY_MAYBE_NO_OPTIONS: FilterOption[] = [
  { value: "", label: "No matter" },
  { value: "maybe", label: "Maybe" },
  { value: "0", label: "No" }
];

const FORTNITE_CORE_RANGE_FILTERS: RangeFilterConfig[] = [
  {
    label: "Outfits",
    minKey: "fortnite_skin_count_min",
    maxKey: "fortnite_skin_count_max",
    minPlaceholder: "Min outfits",
    maxPlaceholder: "up to"
  },
  {
    label: "Pickaxes",
    minKey: "fortnite_pickaxe_count_min",
    maxKey: "fortnite_pickaxe_count_max",
    minPlaceholder: "Pickaxes, from",
    maxPlaceholder: "up to"
  },
  {
    label: "Dances",
    minKey: "fortnite_emote_count_min",
    maxKey: "fortnite_emote_count_max",
    minPlaceholder: "Dances, from",
    maxPlaceholder: "up to"
  },
  {
    label: "Gliders",
    minKey: "fortnite_glider_count_min",
    maxKey: "fortnite_glider_count_max",
    minPlaceholder: "Gliders, from",
    maxPlaceholder: "up to"
  }
];

const FORTNITE_TRI_STATE_FILTERS: TriStateFilterConfig[] = [
  {
    label: "Changeable email",
    key: "fortnite_changeable_email",
    options: ANY_YES_NO_OPTIONS
  },
  {
    label: "XBOX linkable",
    key: "fortnite_xbox_linkable",
    options: ANY_MAYBE_NO_OPTIONS
  },
  {
    label: "PSN linkable",
    key: "fortnite_psn_linkable",
    options: ANY_MAYBE_NO_OPTIONS
  }
];

const RIOT_SHARED_TEXT_FILTERS: TextFilterConfig[] = [
  { label: "Account origin", key: "riot_account_origin", placeholder: "Any" },
  { label: "Exclude account origin", key: "riot_exclude_account_origin", placeholder: "Exclude" },
  { label: "Country", key: "riot_country", placeholder: "Any" },
  { label: "Exclude country", key: "riot_exclude_country", placeholder: "Exclude" },
  { label: "Email domain", key: "riot_email_domain", placeholder: "Any" },
  { label: "Exclude mail domain", key: "riot_exclude_mail_domain", placeholder: "Exclude" },
  { label: "Mail provider", key: "riot_mail_provider", placeholder: "Any" },
  { label: "Exclude mail provider", key: "riot_exclude_mail_provider", placeholder: "Exclude" }
];

const RIOT_SHARED_FLAGS: Array<{ key: string; label: string }> = [
  { key: "riot_not_sold_before", label: "Not sold before" },
  { key: "riot_sold_before", label: "Sold before" },
  { key: "riot_not_sold_before_by_me", label: "Not sold before by me" },
  { key: "riot_sold_before_by_me", label: "Sold before by me" }
];

const VALORANT_RANK_OPTIONS = [
  "",
  "iron",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
  "ascendant",
  "immortal",
  "radiant"
];

const LOL_RANK_OPTIONS = [
  "",
  "iron",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "emerald",
  "diamond",
  "master",
  "grandmaster",
  "challenger"
];

const VALORANT_RANGE_FILTERS: RangeFilterConfig[] = [
  {
    label: "Skins",
    minKey: "valorant_skin_count_min",
    maxKey: "valorant_skin_count_max",
    minPlaceholder: "Skins from",
    maxPlaceholder: "up to"
  },
  {
    label: "Knives",
    minKey: "valorant_knife_count_min",
    maxKey: "valorant_knife_count_max",
    minPlaceholder: "Knives from",
    maxPlaceholder: "up to"
  },
  {
    label: "Gunbuddies",
    minKey: "valorant_gunbuddies_count_min",
    maxKey: "valorant_gunbuddies_count_max",
    minPlaceholder: "Gunbuddies from",
    maxPlaceholder: "up to"
  },
  {
    label: "Agents",
    minKey: "valorant_agents_count_min",
    maxKey: "valorant_agents_count_max",
    minPlaceholder: "Agents from",
    maxPlaceholder: "up to"
  },
  {
    label: "Level",
    minKey: "valorant_level_min",
    maxKey: "valorant_level_max",
    minPlaceholder: "Level from",
    maxPlaceholder: "up to"
  },
  {
    label: "VP",
    minKey: "valorant_vp_min",
    maxKey: "valorant_vp_max",
    minPlaceholder: "VP from",
    maxPlaceholder: "up to"
  },
  {
    label: "Inventory value",
    minKey: "valorant_inventory_value_min",
    maxKey: "valorant_inventory_value_max",
    minPlaceholder: "from, VP",
    maxPlaceholder: "up to, VP"
  },
  {
    label: "RP",
    minKey: "valorant_rp_min",
    maxKey: "valorant_rp_max",
    minPlaceholder: "RP from",
    maxPlaceholder: "up to"
  },
  {
    label: "Free Agents",
    minKey: "valorant_free_agents_min",
    maxKey: "valorant_free_agents_max",
    minPlaceholder: "Free Agents from",
    maxPlaceholder: "up to"
  }
];

const LOL_RANGE_FILTERS: RangeFilterConfig[] = [
  {
    label: "Skins",
    minKey: "lol_skin_count_min",
    maxKey: "lol_skin_count_max",
    minPlaceholder: "Skins from",
    maxPlaceholder: "up to"
  },
  {
    label: "Champions",
    minKey: "lol_champions_count_min",
    maxKey: "lol_champions_count_max",
    minPlaceholder: "Champions from",
    maxPlaceholder: "up to"
  },
  {
    label: "Level",
    minKey: "lol_level_min",
    maxKey: "lol_level_max",
    minPlaceholder: "Level from",
    maxPlaceholder: "up to"
  },
  {
    label: "WinRate",
    minKey: "lol_winrate_min",
    maxKey: "lol_winrate_max",
    minPlaceholder: "WinRate from",
    maxPlaceholder: "up to"
  },
  {
    label: "Blue essence",
    minKey: "lol_blue_essence_min",
    maxKey: "lol_blue_essence_max",
    minPlaceholder: "Blue essence from",
    maxPlaceholder: "up to"
  },
  {
    label: "Orange essence",
    minKey: "lol_orange_essence_min",
    maxKey: "lol_orange_essence_max",
    minPlaceholder: "Orange essence from",
    maxPlaceholder: "up to"
  },
  {
    label: "Mythic essence",
    minKey: "lol_mythic_essence_min",
    maxKey: "lol_mythic_essence_max",
    minPlaceholder: "Mythic essence from",
    maxPlaceholder: "up to"
  },
  {
    label: "Riot Points",
    minKey: "lol_riot_points_min",
    maxKey: "lol_riot_points_max",
    minPlaceholder: "Riot Points from",
    maxPlaceholder: "up to"
  }
];

type LztSharedPrefix =
  | "siege"
  | "media"
  | "telegram"
  | "discord"
  | "steam"
  | "cs2"
  | "battlenet";

const LZT_SHARED_FLAGS: Array<{ suffix: string; label: string }> = [
  { suffix: "not_sold_before", label: "Not sold before" },
  { suffix: "sold_before", label: "Sold before" },
  { suffix: "not_sold_before_by_me", label: "Not sold before by me" },
  { suffix: "sold_before_by_me", label: "Sold before by me" }
];

function parseSelectedValues(raw: string | undefined) {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeSelectorTerm(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

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

export function MarketSearch({
  viewer,
  homeTitle = "Welcome to AE EMPIRE",
  homeSubtitle =
    "Premium digital account marketplace with secure balance payments and instant automated delivery.",
  announcementEnabled = false,
  announcementText = ""
}: MarketSearchProps) {
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
  const [fortniteSelectorOpen, setFortniteSelectorOpen] = useState<FortniteSelectorKey | null>(
    null
  );
  const [fortniteSelectorSearch, setFortniteSelectorSearch] = useState("");
  const [fortniteSelectorDraft, setFortniteSelectorDraft] = useState<string[]>([]);
  const [fortniteSelectorRemoteOptions, setFortniteSelectorRemoteOptions] = useState<string[]>([]);
  const [fortniteSelectorRemoteLoading, setFortniteSelectorRemoteLoading] = useState(false);
  const [fortniteTypingSuggestions, setFortniteTypingSuggestions] = useState<string[]>([]);
  const debouncedQuery = useDebouncedValue(query);
  const debouncedFortniteSelectorSearch = useDebouncedValue(fortniteSelectorSearch, 220);

  function changePage(nextPage: number) {
    const normalized = Math.max(1, nextPage);
    setCurrentPage(normalized);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  useEffect(() => {
    setGameFilters({});
    setFortniteSelectorOpen(null);
    setFortniteSelectorSearch("");
    setFortniteSelectorDraft([]);
    setFortniteSelectorRemoteOptions([]);
    setFortniteSelectorRemoteLoading(false);
    setFortniteTypingSuggestions([]);
  }, [selectedGame]);

  useEffect(() => {
    if (!fortniteSelectorOpen) {
      setFortniteSelectorRemoteOptions([]);
      setFortniteSelectorRemoteLoading(false);
      return;
    }

    const queryValue = debouncedFortniteSelectorSearch.trim();
    if (queryValue.length < 2) {
      setFortniteSelectorRemoteOptions([]);
      setFortniteSelectorRemoteLoading(false);
      return;
    }

    const controller = new AbortController();
    const run = async () => {
      setFortniteSelectorRemoteLoading(true);
      try {
        const params = new URLSearchParams({
          q: queryValue,
          selector: fortniteSelectorOpen
        });
        const response = await fetch(`/api/fortnite/cosmetics?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store"
        });
        if (!response.ok) {
          setFortniteSelectorRemoteOptions([]);
          return;
        }
        const payload = (await response.json()) as { options?: string[] };
        const options = Array.isArray(payload.options)
          ? payload.options
              .map((value) => normalizeSelectorTerm(String(value ?? "")))
              .filter((value) => value.length >= 2 && value.length <= 64)
          : [];
        setFortniteSelectorRemoteOptions(options);
      } catch {
        if (!controller.signal.aborted) {
          setFortniteSelectorRemoteOptions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setFortniteSelectorRemoteLoading(false);
        }
      }
    };

    run();
    return () => controller.abort();
  }, [fortniteSelectorOpen, debouncedFortniteSelectorSearch]);

  useEffect(() => {
    if (selectedGame !== "fortnite") {
      setFortniteTypingSuggestions([]);
      return;
    }
    const queryValue = debouncedQuery.trim();
    if (queryValue.length < 2) {
      setFortniteTypingSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const run = async () => {
      try {
        const params = new URLSearchParams({ q: queryValue });
        const response = await fetch(`/api/fortnite/cosmetics?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store"
        });
        if (!response.ok) {
          setFortniteTypingSuggestions([]);
          return;
        }
        const payload = (await response.json()) as { options?: string[] };
        const options = Array.isArray(payload.options)
          ? payload.options
              .map((value) => normalizeSelectorTerm(String(value ?? "")))
              .filter((value) => value.length >= 2 && value.length <= 64)
              .slice(0, 160)
          : [];
        setFortniteTypingSuggestions(options);
      } catch {
        if (!controller.signal.aborted) {
          setFortniteTypingSuggestions([]);
        }
      }
    };

    run();
    return () => controller.abort();
  }, [selectedGame, debouncedQuery]);

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
  const modalListing = useMemo(
    () => mergeListingForModal(activeListing, detailListing),
    [activeListing, detailListing]
  );

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
          setDetailListing(mergeListingForModal(activeListing, payload.listing));
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
  }, [activeListing, activeListingId]);

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

      const payload = (await response.json()) as { orderId?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to start purchase");
      }
      if (payload.orderId) {
        router.push(`/dashboard?order=${encodeURIComponent(payload.orderId)}`);
      } else {
        router.push("/dashboard");
      }
      router.refresh();
    } catch (purchaseError) {
      const message =
        purchaseError instanceof Error ? purchaseError.message : "Purchase failed";
      setError(message);
    } finally {
      setBuying(false);
    }
  }

  function resetAdvancedFilters() {
    setSelectedGame("all");
    setGameFilters({});
    setFortniteSelectorOpen(null);
    setFortniteSelectorSearch("");
    setFortniteSelectorDraft([]);
  }

  function setGameFilter(key: string, value: string) {
    setGameFilters((previous) => ({
      ...previous,
      [key]: value
    }));
  }

  function renderRangePair(
    minKey: string,
    maxKey: string,
    minPlaceholder: string,
    maxPlaceholder = "up to"
  ) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          min={0}
          value={gameFilters[minKey] ?? ""}
          onChange={(event) => setGameFilter(minKey, event.target.value)}
          placeholder={minPlaceholder}
          className="h-9"
        />
        <Input
          type="number"
          min={0}
          value={gameFilters[maxKey] ?? ""}
          onChange={(event) => setGameFilter(maxKey, event.target.value)}
          placeholder={maxPlaceholder}
          className="h-9"
        />
      </div>
    );
  }

  function renderLztSharedColumn(prefix: LztSharedPrefix) {
    const key = (suffix: string) => `${prefix}_${suffix}`;

    return (
      <div className="space-y-2">
        <Input
          value={gameFilters[key("account_origin")] ?? ""}
          onChange={(event) => setGameFilter(key("account_origin"), event.target.value)}
          placeholder="Account origin"
          className="h-9"
        />
        <Input
          value={gameFilters[key("exclude_account_origin")] ?? ""}
          onChange={(event) => setGameFilter(key("exclude_account_origin"), event.target.value)}
          placeholder="Exclude account origin"
          className="h-9"
        />
        <Input
          value={gameFilters[key("country")] ?? ""}
          onChange={(event) => setGameFilter(key("country"), event.target.value)}
          placeholder="Country"
          className="h-9"
        />
        <Input
          value={gameFilters[key("exclude_country")] ?? ""}
          onChange={(event) => setGameFilter(key("exclude_country"), event.target.value)}
          placeholder="Exclude country"
          className="h-9"
        />
        <Input
          type="number"
          min={0}
          value={gameFilters[key("last_activity_days_max")] ?? ""}
          onChange={(event) => setGameFilter(key("last_activity_days_max"), event.target.value)}
          placeholder="Last activity in days"
          className="h-9"
        />
        <label className="space-y-1 text-xs text-zinc-400">
          Access to email
          <select
            value={gameFilters.ma ?? ""}
            onChange={(event) => setGameFilter("ma", event.target.value)}
            className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
          >
            <option value="">No matter</option>
            <option value="1">Yes</option>
            <option value="0">No</option>
          </select>
        </label>
        <Input
          value={gameFilters[key("email_domain")] ?? ""}
          onChange={(event) => setGameFilter(key("email_domain"), event.target.value)}
          placeholder="Email domain"
          className="h-9"
        />
        <Input
          value={gameFilters[key("exclude_mail_domain")] ?? ""}
          onChange={(event) => setGameFilter(key("exclude_mail_domain"), event.target.value)}
          placeholder="Exclude mail domain"
          className="h-9"
        />
        <Input
          value={gameFilters[key("mail_provider")] ?? ""}
          onChange={(event) => setGameFilter(key("mail_provider"), event.target.value)}
          placeholder="Mail provider"
          className="h-9"
        />
        <Input
          value={gameFilters[key("exclude_mail_provider")] ?? ""}
          onChange={(event) => setGameFilter(key("exclude_mail_provider"), event.target.value)}
          placeholder="Exclude mail provider"
          className="h-9"
        />
        <div className="space-y-1.5 pt-1">
          {LZT_SHARED_FLAGS.map((flag) => (
            <label
              key={flag.suffix}
              className="inline-flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-zinc-200"
            >
              <input
                type="checkbox"
                checked={(gameFilters[key(flag.suffix)] ?? "") === "1"}
                onChange={(event) =>
                  setGameFilter(key(flag.suffix), event.target.checked ? "1" : "")
                }
                className="h-4 w-4"
              />
              {flag.label}
            </label>
          ))}
        </div>
      </div>
    );
  }

  function openFortniteSelector(key: FortniteSelectorKey) {
    setFortniteSelectorOpen(key);
    setFortniteSelectorSearch("");
    const unique = new Map<string, string>();
    for (const value of parseSelectedValues(gameFilters[key])) {
      const normalized = normalizeSelectorTerm(value);
      if (!normalized) {
        continue;
      }
      const signature = normalized.toLowerCase();
      if (!unique.has(signature)) {
        unique.set(signature, normalized);
      }
    }
    setFortniteSelectorDraft(Array.from(unique.values()));
  }

  function toggleFortniteSelectorValue(value: string) {
    const normalizedValue = normalizeSelectorTerm(value);
    if (!normalizedValue) {
      return;
    }
    setFortniteSelectorDraft((previous) =>
      previous.some((entry) => entry.toLowerCase() === normalizedValue.toLowerCase())
        ? previous.filter((entry) => entry.toLowerCase() !== normalizedValue.toLowerCase())
        : [...previous, normalizedValue]
    );
  }

  function applyFortniteSelector() {
    if (!fortniteSelectorOpen) {
      return;
    }
    const unique = new Map<string, string>();
    for (const value of fortniteSelectorDraft) {
      const normalized = normalizeSelectorTerm(value);
      if (!normalized) {
        continue;
      }
      const signature = normalized.toLowerCase();
      if (!unique.has(signature)) {
        unique.set(signature, normalized);
      }
    }
    setGameFilter(fortniteSelectorOpen, Array.from(unique.values()).join(","));
    setFortniteSelectorOpen(null);
    setFortniteSelectorSearch("");
  }

  function resetFortniteSelector() {
    setFortniteSelectorDraft([]);
  }

  function closeFortniteSelector() {
    setFortniteSelectorOpen(null);
    setFortniteSelectorSearch("");
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
    if (selectedGame === "fortnite") {
      for (const remote of fortniteTypingSuggestions) {
        source.add(remote);
      }
      for (const selector of FORTNITE_SELECTOR_CONFIG) {
        for (const option of selector.options) {
          source.add(option);
        }
        for (const selectedValue of parseSelectedValues(gameFilters[selector.key])) {
          const normalizedSelected = normalizeSelectorTerm(selectedValue);
          if (normalizedSelected) {
            source.add(normalizedSelected);
          }
        }
      }
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
      .slice(0, 140)
      .map((entry) => entry.value);

    return scored;
  }, [query, selectedGame, listings, gameFilters, fortniteTypingSuggestions]);
  const showSuggestions = searchFocused && suggestions.length > 0;
  const activeFortniteSelector = useMemo(
    () =>
      FORTNITE_SELECTOR_CONFIG.find((config) => config.key === fortniteSelectorOpen) ?? null,
    [fortniteSelectorOpen]
  );
  const fortniteSelectorBaseOptions = useMemo(() => {
    if (!activeFortniteSelector) {
      return [];
    }
    const source = new Map<string, string>();
    for (const option of activeFortniteSelector.options) {
      const normalized = normalizeSelectorTerm(option);
      if (!normalized) {
        continue;
      }
      const signature = normalized.toLowerCase();
      if (!source.has(signature)) {
        source.set(signature, normalized);
      }
    }
    for (const value of parseSelectedValues(gameFilters[activeFortniteSelector.key])) {
      const normalized = normalizeSelectorTerm(value);
      if (!normalized) {
        continue;
      }
      const signature = normalized.toLowerCase();
      if (!source.has(signature)) {
        source.set(signature, normalized);
      }
    }
    for (const value of fortniteSelectorDraft) {
      const normalized = normalizeSelectorTerm(value);
      if (!normalized) {
        continue;
      }
      const signature = normalized.toLowerCase();
      if (!source.has(signature)) {
        source.set(signature, normalized);
      }
    }
    if (selectedGame === "fortnite") {
      for (const listing of listings) {
        const extracted = extractFortniteSelectorListingOptions(
          listing,
          activeFortniteSelector.key
        );
        for (const value of extracted) {
          const normalized = normalizeSelectorTerm(value);
          if (!normalized) {
            continue;
          }
          const signature = normalized.toLowerCase();
          if (!source.has(signature)) {
            source.set(signature, normalized);
          }
        }
      }
    }
    for (const value of fortniteSelectorRemoteOptions) {
      const normalized = normalizeSelectorTerm(value);
      if (!normalized) {
        continue;
      }
      const signature = normalized.toLowerCase();
      if (!source.has(signature)) {
        source.set(signature, normalized);
      }
    }
    return Array.from(source.values());
  }, [
    activeFortniteSelector,
    gameFilters,
    fortniteSelectorDraft,
    fortniteSelectorRemoteOptions,
    selectedGame,
    listings
  ]);
  const fortniteSelectorOptions = useMemo(() => {
    if (!activeFortniteSelector) {
      return [];
    }
    const normalized = normalizeSuggestionValue(fortniteSelectorSearch);
    if (!normalized) {
      return fortniteSelectorBaseOptions.slice(0, 340);
    }
    const compactNormalized = normalized.replace(/\s+/g, "");
    return fortniteSelectorBaseOptions
      .map((option) => {
        const normalizedOption = normalizeSuggestionValue(option);
        if (!normalizedOption) {
          return null;
        }
        const compactOption = normalizedOption.replace(/\s+/g, "");
        const starts = normalizedOption.startsWith(normalized);
        const contains = normalizedOption.includes(normalized);
        const wordStarts = normalized
          .split(" ")
          .filter(Boolean)
          .every((queryToken) =>
            normalizedOption
              .split(" ")
              .filter(Boolean)
              .some((optionToken) => optionToken.startsWith(queryToken))
          );
        const subsequence = isSubsequenceMatch(compactOption, compactNormalized);
        if (!starts && !contains && !wordStarts && !subsequence) {
          return null;
        }
        const score = starts ? 0 : wordStarts ? 1 : contains ? 2 : 3;
        return { option, score };
      })
      .filter((entry): entry is { option: string; score: number } => Boolean(entry))
      .sort((a, b) => {
        if (a.score !== b.score) {
          return a.score - b.score;
        }
        const aNorm = normalizeSuggestionValue(a.option);
        const bNorm = normalizeSuggestionValue(b.option);
        if (aNorm.length !== bNorm.length) {
          return aNorm.length - bNorm.length;
        }
        return aNorm.localeCompare(bNorm);
      })
      .slice(0, 360)
      .map((entry) => entry.option);
  }, [activeFortniteSelector, fortniteSelectorSearch, fortniteSelectorBaseOptions]);
  const fortniteSelectorCustomCandidate = useMemo(() => {
    if (!activeFortniteSelector) {
      return "";
    }
    const candidate = normalizeSelectorTerm(fortniteSelectorSearch);
    if (candidate.length < 2 || candidate.length > 64) {
      return "";
    }
    const exists = fortniteSelectorBaseOptions.some(
      (option) => option.toLowerCase() === candidate.toLowerCase()
    );
    return exists ? "" : candidate;
  }, [activeFortniteSelector, fortniteSelectorSearch, fortniteSelectorBaseOptions]);

  function addCustomFortniteSelectorValue() {
    if (!fortniteSelectorCustomCandidate) {
      return;
    }
    toggleFortniteSelectorValue(fortniteSelectorCustomCandidate);
    setFortniteSelectorSearch("");
  }

  return (
    <main className="space-y-5 pt-1 sm:space-y-6 sm:pt-2 md:space-y-7 md:pt-3">
      <header className="glass-panel rounded-3xl px-4 py-5 sm:px-6 sm:py-7 md:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div className="space-y-4">
            <div className="space-y-2">
              <h1 className="text-glow font-[var(--font-space-grotesk)] text-2xl font-bold leading-tight sm:text-3xl md:text-5xl">
                {homeTitle}
              </h1>
              <p className="max-w-2xl text-sm text-zinc-300 md:text-base">
                {homeSubtitle}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs text-zinc-300">
            <div className="glass-panel rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3">
              <p className="font-semibold text-white">100%</p>
              <p>Delivery Rate</p>
            </div>
            <div className="glass-panel rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3">
              <p className="font-semibold text-white">24/7</p>
              <p>Monitoring</p>
            </div>
          </div>
        </div>
      </header>
      {announcementEnabled && announcementText.trim().length > 0 && (
        <section className="glass-panel rounded-2xl border border-emerald-300/20 bg-emerald-900/10 p-4 sm:p-5">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200/90">
            Announcement
          </p>
          <p className="whitespace-pre-wrap break-words text-sm text-emerald-100 sm:text-base">
            {announcementText}
          </p>
        </section>
      )}

      <section className="glass-panel rounded-3xl p-4 sm:p-5 md:p-6">
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
              <Link href="/login" className="w-full md:w-auto">
                <Button className="min-w-[136px] w-full md:w-auto">Sign In To Buy</Button>
              </Link>
            )}
            {viewer && (
              <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
                <div className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-black/35 px-4 text-sm text-zinc-200 sm:w-auto sm:min-w-[180px]">
                  <Wallet size={16} />
                  Balance {formatPrice(viewer.balance, "USD")}
                </div>
                <a href="/wallet/add-funds" className="w-full sm:w-auto">
                  <Button variant="ghost" className="h-12 w-full sm:w-auto">
                    Add Funds
                  </Button>
                </a>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-xs text-zinc-400">
              Category
              <select
                value={selectedGame}
                onChange={(event) => setSelectedGame(event.target.value as GameFilterTarget)}
                className="h-11 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
              >
                <option value="all">All Categories</option>
                <option value="fortnite">Fortnite</option>
                <option value="valorant">Riot Client</option>
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

          <div className="rounded-2xl border border-white/15 bg-black/25 p-3 sm:p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
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
              <Button type="button" variant="ghost" className="h-8 w-full px-3 sm:w-auto" onClick={resetAdvancedFilters}>
                Reset
              </Button>
            </div>

            {advancedOpen && (
              <div className="mt-3 grid max-h-[70dvh] gap-3 overflow-y-auto pr-1 md:max-h-[72dvh] xl:max-h-none xl:grid-cols-2">
                {selectedGame !== "all" && (
                  <div className="space-y-3 rounded-xl border border-white/10 bg-black/25 p-3 xl:col-span-2">
                    {selectedGameToggles.length > 0 && (
                      <>
                        <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                          Quick Flags
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
                      </>
                    )}

                    {selectedGame === "fortnite" && (
                      <div className="grid gap-3 xl:grid-cols-3">
                        <div className="space-y-2">
                          <label className="space-y-1 text-xs text-zinc-400">
                            Platform
                            <select
                              value={gameFilters.fortnite_platform ?? ""}
                              onChange={(event) =>
                                setGameFilter("fortnite_platform", event.target.value)
                              }
                              className="h-10 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                            >
                              <option value="">Any platform</option>
                              <option value="pc">PC</option>
                              <option value="xbox">Xbox</option>
                              <option value="psn">PlayStation</option>
                              <option value="switch">Nintendo Switch</option>
                              <option value="mobile">Mobile</option>
                            </select>
                          </label>

                          <label className="space-y-1 text-xs text-zinc-400">
                            Access to email
                            <select
                              value={gameFilters.ma ?? ""}
                              onChange={(event) => setGameFilter("ma", event.target.value)}
                              className="h-10 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                            >
                              <option value="">No matter</option>
                              <option value="1">Yes</option>
                              <option value="0">No</option>
                            </select>
                          </label>

                        </div>

                        <div className="space-y-2">
                          {FORTNITE_SELECTOR_CONFIG.map((selector) => {
                            const selectedValues = parseSelectedValues(gameFilters[selector.key]);
                            const selectedLabel =
                              selectedValues.length > 0
                                ? `${selector.placeholder} (${selectedValues.length})`
                                : selector.placeholder;
                            return (
                              <button
                                key={selector.key}
                                type="button"
                                onClick={() => openFortniteSelector(selector.key)}
                                className="h-10 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-left text-sm text-zinc-200 transition hover:border-white/30 hover:text-white"
                              >
                                {selectedLabel}
                              </button>
                            );
                          })}

                          <label className="space-y-1 text-xs text-zinc-400">
                            Guarantee length
                            <select
                              value={gameFilters.fortnite_guarantee_length ?? ""}
                              onChange={(event) =>
                                setGameFilter("fortnite_guarantee_length", event.target.value)
                              }
                              className="h-10 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                            >
                              <option value="">Any</option>
                              <option value="7">7 days</option>
                              <option value="14">14 days</option>
                              <option value="30">30 days</option>
                              <option value="90">90 days</option>
                            </select>
                          </label>

                          <label className="space-y-1 text-xs text-zinc-400">
                            Last activity in days
                            <Input
                              type="number"
                              min={0}
                              value={gameFilters.fortnite_last_activity_days_max ?? ""}
                              onChange={(event) =>
                                setGameFilter("fortnite_last_activity_days_max", event.target.value)
                              }
                              placeholder="x"
                              className="h-10"
                            />
                          </label>

                          {FORTNITE_TRI_STATE_FILTERS.slice(0, 3).map((field) => (
                            <div key={field.key} className="space-y-1 text-xs text-zinc-400">
                              <p>{field.label}</p>
                              <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/15 bg-black/35 p-1">
                                {field.options.map((option) => (
                                  <button
                                    key={`${field.key}_${option.value || "any"}`}
                                    type="button"
                                    onClick={() => setGameFilter(field.key, option.value)}
                                    className={cn(
                                      "h-8 rounded-lg px-2 text-xs transition",
                                      (gameFilters[field.key] ?? "") === option.value
                                        ? "bg-emerald-500/20 text-emerald-300"
                                        : "text-zinc-300 hover:bg-white/10"
                                    )}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}

                        </div>

                        <div className="space-y-2">
                          {FORTNITE_CORE_RANGE_FILTERS.map((field) => (
                            <div key={field.minKey} className="grid grid-cols-2 gap-2">
                              <Input
                                type="number"
                                min={0}
                                value={gameFilters[field.minKey] ?? ""}
                                onChange={(event) =>
                                  setGameFilter(field.minKey, event.target.value)
                                }
                                placeholder={field.minPlaceholder}
                                className="h-9"
                              />
                              <Input
                                type="number"
                                min={0}
                                value={gameFilters[field.maxKey] ?? ""}
                                onChange={(event) =>
                                  setGameFilter(field.maxKey, event.target.value)
                                }
                                placeholder={field.maxPlaceholder}
                                className="h-9"
                              />
                            </div>
                          ))}

                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              type="number"
                              min={0}
                              value={gameFilters.fortnite_vbucks_min ?? ""}
                              onChange={(event) =>
                                setGameFilter("fortnite_vbucks_min", event.target.value)
                              }
                              placeholder="Min V-Bucks"
                              className="h-9"
                            />
                            <Input
                              type="number"
                              min={0}
                              value={gameFilters.fortnite_vbucks_max ?? ""}
                              onChange={(event) =>
                                setGameFilter("fortnite_vbucks_max", event.target.value)
                              }
                              placeholder="up to"
                              className="h-9"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              type="number"
                              min={0}
                              value={gameFilters.fortnite_level_min ?? ""}
                              onChange={(event) =>
                                setGameFilter("fortnite_level_min", event.target.value)
                              }
                              placeholder="Level, from"
                              className="h-9"
                            />
                            <Input
                              type="number"
                              min={0}
                              value={gameFilters.fortnite_level_max ?? ""}
                              onChange={(event) =>
                                setGameFilter("fortnite_level_max", event.target.value)
                              }
                              placeholder="up to"
                              className="h-9"
                            />
                          </div>

                        </div>
                      </div>
                    )}

                    {selectedGame === "valorant" && (
                      <div className="grid gap-3 xl:grid-cols-3">
                        <div className="space-y-2">
                          {RIOT_SHARED_TEXT_FILTERS.slice(0, 4).map((field) => (
                            <label key={field.key} className="space-y-1 text-xs text-zinc-400">
                              {field.label}
                              <Input
                                value={gameFilters[field.key] ?? ""}
                                onChange={(event) => setGameFilter(field.key, event.target.value)}
                                placeholder={field.placeholder}
                                className="h-10"
                              />
                            </label>
                          ))}
                          <label className="space-y-1 text-xs text-zinc-400">
                            Last activity in days
                            <Input
                              type="number"
                              min={0}
                              value={gameFilters.riot_last_activity_days_max ?? ""}
                              onChange={(event) =>
                                setGameFilter("riot_last_activity_days_max", event.target.value)
                              }
                              placeholder="x"
                              className="h-10"
                            />
                          </label>
                          <div className="space-y-1 text-xs text-zinc-400">
                            <p>Email linked</p>
                            <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/15 bg-black/35 p-1">
                              {ANY_YES_NO_OPTIONS.map((option) => (
                                <button
                                  key={`riot_email_linked_${option.value || "any"}`}
                                  type="button"
                                  onClick={() => setGameFilter("riot_email_linked", option.value)}
                                  className={cn(
                                    "h-8 rounded-lg px-2 text-xs transition",
                                    (gameFilters.riot_email_linked ?? "") === option.value
                                      ? "bg-emerald-500/20 text-emerald-300"
                                      : "text-zinc-300 hover:bg-white/10"
                                  )}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-1 text-xs text-zinc-400">
                            <p>Phone linked</p>
                            <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/15 bg-black/35 p-1">
                              {ANY_YES_NO_OPTIONS.map((option) => (
                                <button
                                  key={`riot_phone_linked_${option.value || "any"}`}
                                  type="button"
                                  onClick={() => setGameFilter("riot_phone_linked", option.value)}
                                  className={cn(
                                    "h-8 rounded-lg px-2 text-xs transition",
                                    (gameFilters.riot_phone_linked ?? "") === option.value
                                      ? "bg-emerald-500/20 text-emerald-300"
                                      : "text-zinc-300 hover:bg-white/10"
                                  )}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <label className="space-y-1 text-xs text-zinc-400">
                            Access to email
                            <select
                              value={gameFilters.ma ?? ""}
                              onChange={(event) => setGameFilter("ma", event.target.value)}
                              className="h-10 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                            >
                              <option value="">No matter</option>
                              <option value="1">Yes</option>
                              <option value="0">No</option>
                            </select>
                          </label>
                          {RIOT_SHARED_TEXT_FILTERS.slice(4).map((field) => (
                            <label key={field.key} className="space-y-1 text-xs text-zinc-400">
                              {field.label}
                              <Input
                                value={gameFilters[field.key] ?? ""}
                                onChange={(event) => setGameFilter(field.key, event.target.value)}
                                placeholder={field.placeholder}
                                className="h-10"
                              />
                            </label>
                          ))}
                          <div className="space-y-1.5 pt-1">
                            {RIOT_SHARED_FLAGS.map((flag) => (
                              <label
                                key={flag.key}
                                className="inline-flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-zinc-200"
                              >
                                <input
                                  type="checkbox"
                                  checked={(gameFilters[flag.key] ?? "") === "1"}
                                  onChange={(event) =>
                                    setGameFilter(flag.key, event.target.checked ? "1" : "")
                                  }
                                  className="h-4 w-4"
                                />
                                {flag.label}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-zinc-200">Riot Client</p>
                          {VALORANT_RANGE_FILTERS.slice(0, 1).map((field) => (
                            <div key={field.minKey} className="grid grid-cols-2 gap-2">
                              <Input
                                type="number"
                                min={0}
                                value={gameFilters[field.minKey] ?? ""}
                                onChange={(event) => setGameFilter(field.minKey, event.target.value)}
                                placeholder={field.minPlaceholder}
                                className="h-9"
                              />
                              <Input
                                type="number"
                                min={0}
                                value={gameFilters[field.maxKey] ?? ""}
                                onChange={(event) => setGameFilter(field.maxKey, event.target.value)}
                                placeholder={field.maxPlaceholder}
                                className="h-9"
                              />
                            </div>
                          ))}
                          <label className="inline-flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-zinc-200">
                            <input
                              type="checkbox"
                              checked={(gameFilters.valorant_has_knife ?? "") === "1"}
                              onChange={(event) =>
                                setGameFilter("valorant_has_knife", event.target.checked ? "1" : "")
                              }
                              className="h-4 w-4"
                            />
                            Has any knife
                          </label>
                          {VALORANT_RANGE_FILTERS.slice(1, 4).map((field) => (
                            <div key={field.minKey} className="grid grid-cols-2 gap-2">
                              <Input
                                type="number"
                                min={0}
                                value={gameFilters[field.minKey] ?? ""}
                                onChange={(event) => setGameFilter(field.minKey, event.target.value)}
                                placeholder={field.minPlaceholder}
                                className="h-9"
                              />
                              <Input
                                type="number"
                                min={0}
                                value={gameFilters[field.maxKey] ?? ""}
                                onChange={(event) => setGameFilter(field.maxKey, event.target.value)}
                                placeholder={field.maxPlaceholder}
                                className="h-9"
                              />
                            </div>
                          ))}
                          <Input
                            value={gameFilters.valorant_region ?? ""}
                            onChange={(event) => setGameFilter("valorant_region", event.target.value)}
                            placeholder="Region"
                            className="h-9"
                          />
                          <Input
                            value={gameFilters.valorant_exclude_region ?? ""}
                            onChange={(event) =>
                              setGameFilter("valorant_exclude_region", event.target.value)
                            }
                            placeholder="Exclude region"
                            className="h-9"
                          />
                          <Input
                            value={gameFilters.valorant_rank ?? ""}
                            onChange={(event) => setGameFilter("valorant_rank", event.target.value)}
                            placeholder="Rank"
                            className="h-9"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={gameFilters.valorant_rank_min ?? ""}
                              onChange={(event) => setGameFilter("valorant_rank_min", event.target.value)}
                              className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                            >
                              {VALORANT_RANK_OPTIONS.map((rank) => (
                                <option key={`valorant_rank_min_${rank || "any"}`} value={rank}>
                                  {rank ? rank.toUpperCase() : "Rank from"}
                                </option>
                              ))}
                            </select>
                            <select
                              value={gameFilters.valorant_rank_max ?? ""}
                              onChange={(event) => setGameFilter("valorant_rank_max", event.target.value)}
                              className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                            >
                              {VALORANT_RANK_OPTIONS.map((rank) => (
                                <option key={`valorant_rank_max_${rank || "any"}`} value={rank}>
                                  {rank ? rank.toUpperCase() : "up to"}
                                </option>
                              ))}
                            </select>
                          </div>
                          <p className="text-xs font-medium text-zinc-300">Previous Season Rank</p>
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={gameFilters.valorant_previous_rank_min ?? ""}
                              onChange={(event) =>
                                setGameFilter("valorant_previous_rank_min", event.target.value)
                              }
                              className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                            >
                              {VALORANT_RANK_OPTIONS.map((rank) => (
                                <option key={`valorant_prev_min_${rank || "any"}`} value={rank}>
                                  {rank ? rank.toUpperCase() : "from"}
                                </option>
                              ))}
                            </select>
                            <select
                              value={gameFilters.valorant_previous_rank_max ?? ""}
                              onChange={(event) =>
                                setGameFilter("valorant_previous_rank_max", event.target.value)
                              }
                              className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                            >
                              {VALORANT_RANK_OPTIONS.map((rank) => (
                                <option key={`valorant_prev_max_${rank || "any"}`} value={rank}>
                                  {rank ? rank.toUpperCase() : "up to"}
                                </option>
                              ))}
                            </select>
                          </div>
                          <p className="text-xs font-medium text-zinc-300">Last Rank</p>
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={gameFilters.valorant_last_rank_min ?? ""}
                              onChange={(event) =>
                                setGameFilter("valorant_last_rank_min", event.target.value)
                              }
                              className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                            >
                              {VALORANT_RANK_OPTIONS.map((rank) => (
                                <option key={`valorant_last_min_${rank || "any"}`} value={rank}>
                                  {rank ? rank.toUpperCase() : "from"}
                                </option>
                              ))}
                            </select>
                            <select
                              value={gameFilters.valorant_last_rank_max ?? ""}
                              onChange={(event) =>
                                setGameFilter("valorant_last_rank_max", event.target.value)
                              }
                              className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                            >
                              {VALORANT_RANK_OPTIONS.map((rank) => (
                                <option key={`valorant_last_max_${rank || "any"}`} value={rank}>
                                  {rank ? rank.toUpperCase() : "up to"}
                                </option>
                              ))}
                            </select>
                          </div>
                          {VALORANT_RANGE_FILTERS.slice(4).map((field) => (
                            <div key={field.minKey} className="grid grid-cols-2 gap-2">
                              <Input
                                type="number"
                                min={0}
                                value={gameFilters[field.minKey] ?? ""}
                                onChange={(event) => setGameFilter(field.minKey, event.target.value)}
                                placeholder={field.minPlaceholder}
                                className="h-9"
                              />
                              <Input
                                type="number"
                                min={0}
                                value={gameFilters[field.maxKey] ?? ""}
                                onChange={(event) => setGameFilter(field.maxKey, event.target.value)}
                                placeholder={field.maxPlaceholder}
                                className="h-9"
                              />
                            </div>
                          ))}
                        </div>
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-zinc-200">League of Legends</p>
                          {LOL_RANGE_FILTERS.slice(0, 2).map((field) => (
                            <div key={field.minKey} className="grid grid-cols-2 gap-2">
                              <Input
                                type="number"
                                min={0}
                                value={gameFilters[field.minKey] ?? ""}
                                onChange={(event) => setGameFilter(field.minKey, event.target.value)}
                                placeholder={field.minPlaceholder}
                                className="h-9"
                              />
                              <Input
                                type="number"
                                min={0}
                                value={gameFilters[field.maxKey] ?? ""}
                                onChange={(event) => setGameFilter(field.maxKey, event.target.value)}
                                placeholder={field.maxPlaceholder}
                                className="h-9"
                              />
                            </div>
                          ))}
                          <Input
                            value={gameFilters.lol_region ?? ""}
                            onChange={(event) => setGameFilter("lol_region", event.target.value)}
                            placeholder="Region"
                            className="h-9"
                          />
                          <Input
                            value={gameFilters.lol_exclude_region ?? ""}
                            onChange={(event) => setGameFilter("lol_exclude_region", event.target.value)}
                            placeholder="Exclude region"
                            className="h-9"
                          />
                          <Input
                            value={gameFilters.lol_rank ?? ""}
                            onChange={(event) => setGameFilter("lol_rank", event.target.value)}
                            placeholder="Rank"
                            className="h-9"
                          />
                          {LOL_RANGE_FILTERS.slice(2).map((field) => (
                            <div key={field.minKey} className="grid grid-cols-2 gap-2">
                              <Input
                                type="number"
                                min={0}
                                value={gameFilters[field.minKey] ?? ""}
                                onChange={(event) => setGameFilter(field.minKey, event.target.value)}
                                placeholder={field.minPlaceholder}
                                className="h-9"
                              />
                              <Input
                                type="number"
                                min={0}
                                value={gameFilters[field.maxKey] ?? ""}
                                onChange={(event) => setGameFilter(field.maxKey, event.target.value)}
                                placeholder={field.maxPlaceholder}
                                className="h-9"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedGame === "siege" && (
                      <div className="grid gap-3 xl:grid-cols-3">
                        {renderLztSharedColumn("siege")}
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-zinc-200">Siege Accounts</p>
                          <select
                            value={gameFilters.siege_platform ?? ""}
                            onChange={(event) => setGameFilter("siege_platform", event.target.value)}
                            className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">Platform</option>
                            <option value="pc">PC</option>
                            <option value="xbox">Xbox</option>
                            <option value="psn">PlayStation</option>
                          </select>
                          <Input
                            value={gameFilters.siege_rank ?? ""}
                            onChange={(event) => setGameFilter("siege_rank", event.target.value)}
                            placeholder="Rank"
                            className="h-9"
                          />
                          {renderRangePair("siege_level_min", "siege_level_max", "Level from")}
                          {renderRangePair("siege_operators_min", "siege_operators_max", "Operators from")}
                          {renderRangePair("siege_skins_min", "siege_skins_max", "Skins from")}
                        </div>
                        <div className="space-y-2">
                          <Input
                            value={gameFilters.siege_region ?? ""}
                            onChange={(event) => setGameFilter("siege_region", event.target.value)}
                            placeholder="Region"
                            className="h-9"
                          />
                          <Input
                            value={gameFilters.siege_exclude_region ?? ""}
                            onChange={(event) => setGameFilter("siege_exclude_region", event.target.value)}
                            placeholder="Exclude region"
                            className="h-9"
                          />
                          {renderRangePair("siege_credits_min", "siege_credits_max", "R6 Credits from")}
                          {renderRangePair("siege_kd_min", "siege_kd_max", "KD from")}
                          {renderRangePair("siege_winrate_min", "siege_winrate_max", "WinRate from")}
                        </div>
                      </div>
                    )}

                    {selectedGame === "media" && (
                      <div className="grid gap-3 xl:grid-cols-3">
                        {renderLztSharedColumn("media")}
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-zinc-200">Media Accounts</p>
                          <select
                            value={gameFilters.media_platform ?? ""}
                            onChange={(event) => setGameFilter("media_platform", event.target.value)}
                            className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">Platform</option>
                            <option value="instagram">Instagram</option>
                            <option value="tiktok">TikTok</option>
                            <option value="facebook">Facebook</option>
                            <option value="telegram">Telegram</option>
                            <option value="discord">Discord</option>
                            <option value="youtube">YouTube</option>
                            <option value="twitter">X / Twitter</option>
                          </select>
                          {renderRangePair("media_followers_min", "media_followers_max", "Followers from")}
                          {renderRangePair("media_following_min", "media_following_max", "Following from")}
                          {renderRangePair("media_posts_min", "media_posts_max", "Posts from")}
                          {renderRangePair("media_age_days_min", "media_age_days_max", "Age in days from")}
                        </div>
                        <div className="space-y-2">
                          <select
                            value={gameFilters.media_verified ?? ""}
                            onChange={(event) => setGameFilter("media_verified", event.target.value)}
                            className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">Verified</option>
                            <option value="1">Only verified</option>
                            <option value="0">Not verified</option>
                          </select>
                          {renderRangePair("media_engagement_min", "media_engagement_max", "Engagement % from")}
                          <select
                            value={gameFilters.media_account_type ?? ""}
                            onChange={(event) => setGameFilter("media_account_type", event.target.value)}
                            className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">Account type</option>
                            <option value="personal">Personal</option>
                            <option value="business">Business</option>
                            <option value="creator">Creator</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {selectedGame === "telegram" && (
                      <div className="grid gap-3 xl:grid-cols-3">
                        {renderLztSharedColumn("telegram")}
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-zinc-200">Telegram Accounts</p>
                          <select
                            value={gameFilters.telegram_premium ?? ""}
                            onChange={(event) => setGameFilter("telegram_premium", event.target.value)}
                            className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">Premium</option>
                            <option value="1">Only premium</option>
                            <option value="0">Without premium</option>
                          </select>
                          {renderRangePair("telegram_dialogs_min", "telegram_dialogs_max", "Dialogs from")}
                          {renderRangePair("telegram_channels_min", "telegram_channels_max", "Channels from")}
                          {renderRangePair("telegram_groups_min", "telegram_groups_max", "Groups from")}
                        </div>
                        <div className="space-y-2">
                          {renderRangePair("telegram_sessions_min", "telegram_sessions_max", "Sessions from")}
                          {renderRangePair("telegram_stars_min", "telegram_stars_max", "Stars from")}
                          {renderRangePair("telegram_age_days_min", "telegram_age_days_max", "Age in days from")}
                        </div>
                      </div>
                    )}

                    {selectedGame === "discord" && (
                      <div className="grid gap-3 xl:grid-cols-3">
                        {renderLztSharedColumn("discord")}
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-zinc-200">Discord Accounts</p>
                          <select
                            value={gameFilters.discord_nitro ?? ""}
                            onChange={(event) => setGameFilter("discord_nitro", event.target.value)}
                            className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">Nitro</option>
                            <option value="1">Only nitro</option>
                            <option value="0">Without nitro</option>
                          </select>
                          {renderRangePair("discord_friends_min", "discord_friends_max", "Friends from")}
                          {renderRangePair("discord_servers_min", "discord_servers_max", "Servers from")}
                          {renderRangePair("discord_age_days_min", "discord_age_days_max", "Age in days from")}
                        </div>
                        <div className="space-y-2">
                          <select
                            value={gameFilters.discord_phone_verified ?? ""}
                            onChange={(event) =>
                              setGameFilter("discord_phone_verified", event.target.value)
                            }
                            className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">Phone verified</option>
                            <option value="1">Yes</option>
                            <option value="0">No</option>
                          </select>
                          <select
                            value={gameFilters.discord_email_verified ?? ""}
                            onChange={(event) =>
                              setGameFilter("discord_email_verified", event.target.value)
                            }
                            className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">Email verified</option>
                            <option value="1">Yes</option>
                            <option value="0">No</option>
                          </select>
                          {renderRangePair("discord_badges_min", "discord_badges_max", "Badges from")}
                        </div>
                      </div>
                    )}

                    {selectedGame === "steam" && (
                      <div className="grid gap-3 xl:grid-cols-3">
                        {renderLztSharedColumn("steam")}
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-zinc-200">Steam Accounts</p>
                          {renderRangePair("steam_game_count_min", "steam_game_count_max", "Games from")}
                          {renderRangePair("steam_level_min", "steam_level_max", "Level from")}
                          {renderRangePair(
                            "steam_inventory_value_min",
                            "steam_inventory_value_max",
                            "Inventory value from"
                          )}
                          {renderRangePair("steam_hours_min", "steam_hours_max", "Hours from")}
                        </div>
                        <div className="space-y-2">
                          <Input
                            value={gameFilters.steam_rank ?? ""}
                            onChange={(event) => setGameFilter("steam_rank", event.target.value)}
                            placeholder="Rank / status"
                            className="h-9"
                          />
                          <Input
                            value={gameFilters.steam_region ?? ""}
                            onChange={(event) => setGameFilter("steam_region", event.target.value)}
                            placeholder="Region"
                            className="h-9"
                          />
                          <Input
                            value={gameFilters.steam_exclude_region ?? ""}
                            onChange={(event) =>
                              setGameFilter("steam_exclude_region", event.target.value)
                            }
                            placeholder="Exclude region"
                            className="h-9"
                          />
                          <select
                            value={gameFilters.steam_vac ?? ""}
                            onChange={(event) => setGameFilter("steam_vac", event.target.value)}
                            className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">VAC status</option>
                            <option value="1">VAC clean</option>
                            <option value="0">Has VAC</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {selectedGame === "cs2" && (
                      <div className="grid gap-3 xl:grid-cols-3">
                        {renderLztSharedColumn("cs2")}
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-zinc-200">Counter-Strike 2</p>
                          <select
                            value={gameFilters.cs2_prime ?? ""}
                            onChange={(event) => setGameFilter("cs2_prime", event.target.value)}
                            className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">Prime status</option>
                            <option value="1">Prime only</option>
                            <option value="0">No prime</option>
                          </select>
                          <Input
                            value={gameFilters.cs2_rank ?? ""}
                            onChange={(event) => setGameFilter("cs2_rank", event.target.value)}
                            placeholder="Rank"
                            className="h-9"
                          />
                          {renderRangePair("cs2_faceit_level_min", "cs2_faceit_level_max", "Faceit level from")}
                          {renderRangePair(
                            "cs2_premier_rating_min",
                            "cs2_premier_rating_max",
                            "Premier rating from"
                          )}
                        </div>
                        <div className="space-y-2">
                          {renderRangePair("cs2_wins_min", "cs2_wins_max", "Wins from")}
                          {renderRangePair("cs2_hours_min", "cs2_hours_max", "Hours from")}
                          {renderRangePair(
                            "cs2_inventory_value_min",
                            "cs2_inventory_value_max",
                            "Inventory value from"
                          )}
                          <select
                            value={gameFilters.cs2_vac ?? ""}
                            onChange={(event) => setGameFilter("cs2_vac", event.target.value)}
                            className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">VAC status</option>
                            <option value="1">VAC clean</option>
                            <option value="0">Has VAC</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {selectedGame === "battlenet" && (
                      <div className="grid gap-3 xl:grid-cols-3">
                        {renderLztSharedColumn("battlenet")}
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-zinc-200">Battle.net Accounts</p>
                          <select
                            value={gameFilters.battlenet_region ?? ""}
                            onChange={(event) =>
                              setGameFilter("battlenet_region", event.target.value)
                            }
                            className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">Region</option>
                            <option value="EU">EU</option>
                            <option value="NA">NA</option>
                            <option value="ASIA">Asia</option>
                          </select>
                          {renderRangePair("battlenet_level_min", "battlenet_level_max", "Level from")}
                          {renderRangePair("battlenet_games_min", "battlenet_games_max", "Games from")}
                        </div>
                        <div className="space-y-2">
                          <Input
                            value={gameFilters.battlenet_rank ?? ""}
                            onChange={(event) => setGameFilter("battlenet_rank", event.target.value)}
                            placeholder="Rank / MMR"
                            className="h-9"
                          />
                          {renderRangePair("battlenet_cod_cp_min", "battlenet_cod_cp_max", "COD CP from")}
                          {renderRangePair("battlenet_wow_ilvl_min", "battlenet_wow_ilvl_max", "WoW iLvl from")}
                          <Input
                            value={gameFilters.battlenet_exclude_region ?? ""}
                            onChange={(event) =>
                              setGameFilter("battlenet_exclude_region", event.target.value)
                            }
                            placeholder="Exclude region"
                            className="h-9"
                          />
                        </div>
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
          <div className="glass-panel col-span-full rounded-2xl p-5 text-center md:p-6">
            <p className="text-base font-semibold text-white">Loading listings, please wait</p>
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
                    src={getListingImageWithOptions(listing, {
                      forceTheme: selectedGame === "fortnite" ? "fortnite" : undefined,
                      preferFortniteSkins: true
                    })}
                    alt={listing.title}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.src = getPresetListingImage(listing, {
                        forceTheme: selectedGame === "fortnite" ? "fortnite" : undefined
                      });
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
        <div className="flex items-center justify-start gap-2 overflow-x-auto px-1 sm:justify-center">
          <Button
            type="button"
            variant="ghost"
            className="h-9 shrink-0 px-3"
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
              className="h-9 min-w-9 shrink-0 px-3"
              onClick={() => changePage(pageNumber)}
            >
              {pageNumber}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            className="h-9 shrink-0 px-3"
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

      {activeFortniteSelector && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70 p-2 backdrop-blur-md md:items-center md:p-6">
          <div className="glass-panel mx-auto flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl md:rounded-3xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 md:px-5">
              <p className="font-[var(--font-space-grotesk)] text-lg font-semibold text-white">
                {activeFortniteSelector.title}
              </p>
              <button
                type="button"
                onClick={closeFortniteSelector}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/35 text-zinc-200 transition hover:bg-black/60"
              >
                <X size={15} />
              </button>
            </div>

            <div className="space-y-3 px-4 py-3 md:px-5">
              <Input
                value={fortniteSelectorSearch}
                onChange={(event) => setFortniteSelectorSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && fortniteSelectorCustomCandidate) {
                    event.preventDefault();
                    addCustomFortniteSelectorValue();
                  }
                }}
                placeholder="Search or add custom item"
                className="h-10"
              />
              {fortniteSelectorCustomCandidate && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 w-full justify-start text-zinc-200"
                  onClick={addCustomFortniteSelectorValue}
                >
                  Add "{fortniteSelectorCustomCandidate}"
                </Button>
              )}
              <p className="text-xs text-zinc-400">
                Selected: {fortniteSelectorDraft.length}
              </p>
              {fortniteSelectorRemoteLoading && (
                <p className="text-xs text-zinc-500">Loading more cosmetic names...</p>
              )}
            </div>

            <div className="min-h-[200px] flex-1 space-y-1 overflow-y-auto px-4 pb-2 md:px-5">
              {fortniteSelectorOptions.map((option) => {
                const checked = fortniteSelectorDraft.includes(option);
                return (
                  <label
                    key={option}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-zinc-200 transition hover:border-white/25"
                  >
                    <span>{option}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFortniteSelectorValue(option)}
                      className="h-4 w-4"
                    />
                  </label>
                );
              })}
              {fortniteSelectorOptions.length === 0 && (
                <p className="rounded-lg border border-white/10 bg-black/25 px-3 py-3 text-sm text-zinc-300">
                  No matching options.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-white/10 p-4 md:px-5">
              <Button type="button" variant="ghost" onClick={resetFortniteSelector}>
                Reset
              </Button>
              <Button type="button" onClick={applyFortniteSelector}>
                Apply
              </Button>
            </div>
          </div>
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
        imageTheme={selectedGame === "fortnite" ? "fortnite" : null}
      />
    </main>
  );
}
