"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageCircle, Search, Wallet, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
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

type PopularSearchResponse = {
  listings?: MarketListing[];
};

type MarketSearchProps = {
  viewer: PublicViewer | null;
  homeTitle?: string;
  homeSubtitle?: string;
  announcementEnabled?: boolean;
  announcementText?: string;
};

type TourStepId =
  | "welcome"
  | "filters"
  | "listings"
  | "details"
  | "checkout"
  | "support"
  | "done";

type TourSpotlight = {
  selector: string;
  title: string;
  message: string;
};

const TOUR_STORAGE_KEY = "ae_market_tour_completed_v1";
const TOUR_STEPS: Array<{ id: TourStepId; spotlight?: TourSpotlight }> = [
  {
    id: "welcome"
  },
  {
    id: "filters",
    spotlight: {
      selector: "[data-tour='filters']",
      title: "Use Filters First",
      message: "Use filters to find the best accounts within your budget."
    }
  },
  {
    id: "listings",
    spotlight: {
      selector: "[data-tour='listings']",
      title: "Browse Listings",
      message: "Browse available accounts here. Click anywhere in the highlighted area to continue."
    }
  },
  {
    id: "details",
    spotlight: {
      selector: "[data-tour='product-modal-panel']",
      title: "Review Details",
      message: "Check all account details before purchasing."
    }
  },
  {
    id: "checkout",
    spotlight: {
      selector: "[data-tour='buy-button']",
      title: "Secure Checkout",
      message: "Secure checkout with instant delivery after purchase."
    }
  },
  {
    id: "support",
    spotlight: {
      selector: "[data-tour='support-button']",
      title: "Support Anytime",
      message: "Need help? Contact support anytime."
    }
  },
  {
    id: "done"
  }
];

type GameFilterTarget =
  | "all"
  | "fortnite"
  | "valorant"
  | "siege"
  | "roblox"
  | "supercell"
  | "tiktok"
  | "instagram"
  | "telegram"
  | "discord"
  | "steam"
  | "cs2"
  | "battlenet";

const SUPPORT_HREF = "/support";

const GAME_SEARCH_PARAMS: Record<
  GameFilterTarget,
  { game?: string; category?: string }
> = {
  all: {},
  fortnite: { game: "fortnite", category: "fortnite" },
  valorant: { game: "valorant", category: "riot" },
  siege: { game: "siege", category: "rainbow-six-siege" },
  roblox: { game: "roblox", category: "roblox" },
  supercell: { game: "supercell", category: "supercell" },
  tiktok: { game: "social", category: "tiktok" },
  instagram: { game: "social", category: "instagram" },
  telegram: { game: "telegram", category: "telegram" },
  discord: { game: "discord", category: "discord" },
  steam: { game: "steam", category: "steam" },
  cs2: { game: "cs2", category: "steam" },
  battlenet: { game: "battlenet", category: "battlenet" }
};

const MARKET_CATEGORY_TABS: Array<{
  value: GameFilterTarget;
  label: string;
  iconSrc?: string;
  iconText?: string;
}> = [
  { value: "all", label: "All Categories", iconText: "ALL" },
  {
    value: "fortnite",
    label: "Fortnite",
    iconSrc: "https://www.google.com/s2/favicons?domain=fortnite.com&sz=64"
  },
  {
    value: "valorant",
    label: "Riot Client",
    iconSrc: "https://www.google.com/s2/favicons?domain=riotgames.com&sz=64"
  },
  {
    value: "siege",
    label: "Siege Accounts",
    iconSrc: "https://www.google.com/s2/favicons?domain=rainbow6.com&sz=64"
  },
  {
    value: "roblox",
    label: "Roblox",
    iconSrc: "https://www.google.com/s2/favicons?domain=roblox.com&sz=64"
  },
  {
    value: "supercell",
    label: "Supercell",
    iconSrc: "https://www.google.com/s2/favicons?domain=supercell.com&sz=64"
  },
  {
    value: "tiktok",
    label: "TikTok",
    iconSrc: "https://www.google.com/s2/favicons?domain=tiktok.com&sz=64"
  },
  {
    value: "instagram",
    label: "Instagram",
    iconSrc: "https://www.google.com/s2/favicons?domain=instagram.com&sz=64"
  },
  {
    value: "steam",
    label: "Steam",
    iconSrc: "https://www.google.com/s2/favicons?domain=steampowered.com&sz=64"
  },
  {
    value: "cs2",
    label: "Counter-Strike 2",
    iconSrc: "https://www.google.com/s2/favicons?domain=counter-strike.net&sz=64"
  },
  {
    value: "telegram",
    label: "Telegram",
    iconSrc: "https://www.google.com/s2/favicons?domain=telegram.org&sz=64"
  },
  {
    value: "discord",
    label: "Discord",
    iconSrc: "https://www.google.com/s2/favicons?domain=discord.com&sz=64"
  },
  {
    value: "battlenet",
    label: "Battle.net",
    iconSrc: "https://www.google.com/s2/favicons?domain=battle.net&sz=64"
  }
];

const CATEGORY_PARAM_ALIASES: Record<string, GameFilterTarget> = {
  all: "all",
  fortnite: "fortnite",
  valorant: "valorant",
  riot: "valorant",
  "riot-client": "valorant",
  siege: "siege",
  "siege-accounts": "siege",
  "rainbow-six-siege": "siege",
  uplay: "siege",
  r6: "siege",
  roblox: "roblox",
  supercell: "supercell",
  tiktok: "tiktok",
  instagram: "instagram",
  steam: "steam",
  cs2: "cs2",
  "counter-strike-2": "cs2",
  telegram: "telegram",
  discord: "discord",
  battlenet: "battlenet",
  "battle.net": "battlenet"
};

const GAME_TOGGLE_FILTERS: Record<
  Exclude<GameFilterTarget, "all">,
  Array<{ key: string; label: string }>
> = {
  fortnite: [],
  valorant: [],
  siege: [],
  roblox: [],
  supercell: [],
  tiktok: [],
  instagram: [],
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
    "Supercell",
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
  roblox: [
    "Blox Fruits",
    "Murder Mystery 2",
    "Adopt Me",
    "Pet Simulator",
    "Robux",
    "Limiteds",
    "Headless",
    "Korblox",
    "Rare items",
    "High level",
    "Premium"
  ],
  supercell: [
    "Brawl Stars",
    "Clash of Clans",
    "Clash Royale",
    "Hay Day",
    "Squad Busters",
    "High trophies",
    "Many gems",
    "High level",
    "Rare brawlers",
    "Maxed account",
    "Legendary cards",
    "TH16"
  ],
  tiktok: [
    "TikTok",
    "Followers",
    "High engagement",
    "Monetized",
    "Aged account",
    "US audience",
    "EU audience",
    "Business page",
    "Creator account"
  ],
  instagram: [
    "Instagram",
    "Verified",
    "Blue check",
    "Followers",
    "High engagement",
    "OG username",
    "Aged account",
    "US audience",
    "EU audience",
    "Business page"
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
  "Supercell",
  "Brawl Stars",
  "Clash of Clans",
  "Clash Royale",
  "Hay Day",
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
      "Galaxia",
      "Dark Vertex",
      "Double Helix",
      "Eon",
      "Spider Knight",
      "Rogue Spider Knight",
      "Renegade Raider",
      "Aerial Assault Trooper",
      "Black Knight",
      "Blue Team Leader",
      "Royale Knight",
      "Sparkle Specialist",
      "Elite Agent",
      "Dark Voyager",
      "Carbide",
      "Omega",
      "Omega Knight",
      "The Reaper",
      "John Wick",
      "Skull Trooper",
      "Ghoul Trooper",
      "Purple Skull Trooper",
      "Pink Ghoul Trooper",
      "Ikonik",
      "Glow",
      "Honor Guard",
      "Wonder",
      "Wildcat",
      "Ninja",
      "Lachlan",
      "Loserfruit",
      "Bugha",
      "Ariana Grande",
      "Marshmello",
      "Travis Scott",
      "Astro Jack",
      "Psycho Bandit",
      "Kratos",
      "Master Chief",
      "Lara Croft",
      "Spider-Man",
      "Eddie Brock",
      "The Foundation",
      "Darth Vader",
      "Goku",
      "Vegeta",
      "Beerus",
      "Naruto Uzumaki",
      "Sasuke Uchiha",
      "Itachi Uchiha",
      "Kakashi Hatake",
      "Gojo Satoru",
      "Yuji Itadori",
      "Megumi Fushiguro",
      "Nobara Kugisaki",
      "Levi",
      "Mikasa Ackermann",
      "Eren Jaeger",
      "All Might",
      "Deku",
      "Bakugo",
      "Shoto Todoroki",
      "LeBron James",
      "Neymar Jr",
      "Harry Kane",
      "Marco Reus",
      "Raven",
      "Raptor",
      "Red Knight",
      "Frozen Red Knight",
      "Dark Bomber",
      "Brite Bomber",
      "Beach Bomber",
      "Peely",
      "Midas",
      "Aura",
      "Crystal",
      "Siren",
      "Nog Ops",
      "Yuletide Ranger",
      "Codename E.L.F.",
      "Mogul Master",
      "Recon Expert",
      "Surf Witch",
      "Haze",
      "Ruby",
      "Zadie",
      "Chaos Agent",
      "Joltara",
      "Backlash",
      "Polarity",
      "Holly Striker",
      "Hunter",
      "Replay Ranger",
      "Focus",
      "Monks",
      "Bunny Brawler",
      "Rabbit Raider",
      "Cuddle Team Leader",
      "P.A.N.D.A Team Leader",
      "Fireworks Team Leader",
      "Wukong",
      "Fate",
      "Omen",
      "Sanctum",
      "Hush",
      "Tricera Ops",
      "Dark Tricera Ops",
      "Vertex",
      "Oblivion",
      "Frozen Raven",
      "Love Ranger",
      "Dark Vanguard",
      "Valkyrie",
      "Rogue Agent",
      "Trailblazer",
      "Rust Lord",
      "Drift",
      "Catalyst",
      "Lynx",
      "Calamity",
      "Hybrid",
      "Zenith",
      "Dire",
      "Rox",
      "Vendetta",
      "Ultima Knight",
      "Fade",
      "8-Ball vs Scratch",
      "Cameo vs Chic",
      "Maya",
      "Meowscles",
      "Skye",
      "TNTina",
      "Brutus",
      "Agent Peely",
      "Jules",
      "Kit",
      "Ocean",
      "Siona",
      "Mancake",
      "Lexa",
      "Menace",
      "Tarana",
      "Raz",
      "Spire Assassin",
      "Agent Jones",
      "Sunny",
      "Zyg",
      "Doctor Slone",
      "Torin",
      "Charlotte",
      "Kor",
      "J.B. Chimpanski",
      "Cube Queen",
      "Harlowe",
      "The Origin",
      "Kiara K.O.",
      "Renzo the Destroyer",
      "Aphrodite",
      "Hades",
      "Montague",
      "Oscar",
      "Nisha",
      "Peter Griffin",
      "Solid Snake",
      "Cerberus",
      "Katt",
      "Hope",
      "Fishstick",
      "Raven Team Leader"
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

const FORTNITE_SELECTOR_BLOCKED_GENERIC_TOKENS = [
  "level",
  "wins",
  "last match",
  "last activity",
  "inactive",
  "days",
  "vbucks",
  "v bucks",
  "battle pass",
  "price",
  "mail access",
  "account",
  "cur",
  "current"
];

function looksLikeFortniteMachineCode(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    /^a_\d+_athena_/.test(normalized) ||
    /^\d+_athena_/.test(normalized) ||
    /^cid_[a-z0-9_]+$/.test(normalized) ||
    /^character_[a-z0-9_]+$/.test(normalized) ||
    /^pickaxe_[a-z0-9_]+$/.test(normalized) ||
    /^glider_[a-z0-9_]+$/.test(normalized) ||
    /^eid_[a-z0-9_]+$/.test(normalized) ||
    /^[a-z]{2,}_[a-z0-9_]{6,}$/.test(normalized)
  );
}

function isLikelyFortniteSelectorOption(value: string, selectorKey: FortniteSelectorKey) {
  const normalized = normalizeSuggestionValue(value);
  if (!normalized) {
    return false;
  }
  if (!/[a-z]/i.test(value)) {
    return false;
  }
  if (normalized.length < 2 || normalized.length > 64) {
    return false;
  }
  if (/^\d+$/.test(normalized)) {
    return false;
  }
  if (/:\s*\d/.test(value)) {
    return false;
  }
  if (/^\d+\s*(skins?|outfits?|pickaxes?|axes?|emotes?|dances?|gliders?)\b/i.test(value)) {
    return false;
  }
  if (looksLikeFortniteMachineCode(value)) {
    return false;
  }
  if (
    FORTNITE_SELECTOR_BLOCKED_GENERIC_TOKENS.some((token) =>
      normalized.includes(normalizeSuggestionValue(token))
    )
  ) {
    return false;
  }

  if (selectorKey !== "fortnite_outfits" && /\bskins?\b/i.test(value)) {
    return false;
  }
  if (selectorKey !== "fortnite_pickaxes" && /\bpickaxes?\b|\baxes?\b|\bharvesting\b/i.test(value)) {
    return false;
  }
  if (selectorKey !== "fortnite_emotes" && /\bemotes?\b|\bdances?\b/i.test(value)) {
    return false;
  }
  if (selectorKey !== "fortnite_gliders" && /\bgliders?\b/i.test(value)) {
    return false;
  }

  return true;
}

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
    if (!isLikelyFortniteSelectorOption(normalized, selectorKey)) {
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

const SIEGE_RANK_OPTIONS = [
  "",
  "copper",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "emerald",
  "diamond",
  "champion"
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

function levenshteinDistanceWithinLimit(left: string, right: string, limit = 2) {
  if (left === right) {
    return 0;
  }
  if (!left || !right) {
    return Math.max(left.length, right.length);
  }
  if (Math.abs(left.length - right.length) > limit) {
    return limit + 1;
  }

  const previous = new Array(right.length + 1);
  const current = new Array(right.length + 1);
  for (let index = 0; index <= right.length; index += 1) {
    previous[index] = index;
  }

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost
      );
      if (current[j] < rowMin) {
        rowMin = current[j];
      }
    }
    if (rowMin > limit) {
      return limit + 1;
    }
    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
}

function hasFuzzyWordMatch(queryTokens: string[], candidateTokens: string[]) {
  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return false;
  }
  return queryTokens.every((token) =>
    candidateTokens.some((candidateToken) => {
      if (!token || !candidateToken) {
        return false;
      }
      if (candidateToken.startsWith(token) || token.startsWith(candidateToken)) {
        return true;
      }
      const maxDistance = token.length >= 7 ? 2 : 1;
      return levenshteinDistanceWithinLimit(token, candidateToken, maxDistance) <= maxDistance;
    })
  );
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
  const [pendingPurchaseListingId, setPendingPurchaseListingId] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailListing, setDetailListing] = useState<MarketListing | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [purchaseCouponCode, setPurchaseCouponCode] = useState("");
  const [fortniteSelectorOpen, setFortniteSelectorOpen] = useState<FortniteSelectorKey | null>(
    null
  );
  const [fortniteSelectorSearch, setFortniteSelectorSearch] = useState("");
  const [fortniteSelectorDraft, setFortniteSelectorDraft] = useState<string[]>([]);
  const [fortniteSelectorRemoteOptions, setFortniteSelectorRemoteOptions] = useState<string[]>([]);
  const [fortniteSelectorRemoteLoading, setFortniteSelectorRemoteLoading] = useState(false);
  const [fortniteTypingSuggestions, setFortniteTypingSuggestions] = useState<string[]>([]);
  const [remoteTitleSuggestions, setRemoteTitleSuggestions] = useState<string[]>([]);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStepId, setTourStepId] = useState<TourStepId>("welcome");
  const [tourReady, setTourReady] = useState(false);
  const [tourBlockMessage, setTourBlockMessage] = useState<string | null>(null);
  const [tourSpotlightRect, setTourSpotlightRect] = useState<DOMRect | null>(null);
  const [tourTick, setTourTick] = useState(0);
  const tourCardRef = useRef<HTMLDivElement | null>(null);
  const debouncedQuery = useDebouncedValue(query);
  const debouncedFortniteSelectorSearch = useDebouncedValue(fortniteSelectorSearch, 220);
  const tourStepIndex = useMemo(
    () => TOUR_STEPS.findIndex((entry) => entry.id === tourStepId),
    [tourStepId]
  );
  const activeTourStep = TOUR_STEPS[tourStepIndex] ?? TOUR_STEPS[0];
  const activeSpotlight = activeTourStep.spotlight ?? null;

  function changePage(nextPage: number) {
    const normalized = Math.max(1, nextPage);
    setCurrentPage(normalized);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function completeTour() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TOUR_STORAGE_KEY, "1");
    }
    setTourOpen(false);
    setTourStepId("done");
    setTourBlockMessage(null);
  }

  function startTour() {
    setTourStepId("welcome");
    setTourOpen(true);
    setTourBlockMessage(null);
    setTourSpotlightRect(null);
    setTourTick((previous) => previous + 1);
  }

  function nextTourStep() {
    const nextIndex = Math.min(TOUR_STEPS.length - 1, tourStepIndex + 1);
    const next = TOUR_STEPS[nextIndex];
    if (!next) {
      completeTour();
      return;
    }
    setTourSpotlightRect(null);
    if (next.id === "details") {
      if (!activeListingId && listings.length > 0) {
        setActiveListingId(listings[0].id);
      }
      setTourStepId(next.id);
      setTourTick((previous) => previous + 1);
      return;
    }
    if (next.id === "support") {
      if (activeListingId) {
        setActiveListingId(null);
        window.setTimeout(() => {
          setTourStepId(next.id);
          setTourTick((previous) => previous + 1);
        }, 180);
        return;
      }
    }
    setTourStepId(next.id);
    setTourTick((previous) => previous + 1);
  }

  function previousTourStep() {
    const previousIndex = Math.max(0, tourStepIndex - 1);
    const previous = TOUR_STEPS[previousIndex];
    if (!previous) {
      return;
    }
    setTourSpotlightRect(null);
    setTourStepId(previous.id);
    setTourTick((previousTick) => previousTick + 1);
  }

  function skipCurrentTourStep() {
    setTourBlockMessage(null);
    nextTourStep();
  }

  function getSpotlightElement() {
    if (!activeSpotlight) {
      return null;
    }
    if (tourStepId === "listings") {
      const loadingElement = document.querySelector("[data-tour='listings-loading']") as HTMLElement | null;
      if (loadingElement) {
        return loadingElement;
      }
      const firstCard = document.querySelector("[data-tour='listing-card-primary']") as HTMLElement | null;
      if (firstCard) {
        return firstCard;
      }
    }
    return document.querySelector(activeSpotlight.selector) as HTMLElement | null;
  }

  function refreshTourSpotlightRect() {
    if (!tourOpen || !activeSpotlight) {
      setTourSpotlightRect(null);
      return;
    }
    const element = getSpotlightElement();
    if (!element) {
      setTourSpotlightRect(null);
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      setTourSpotlightRect(null);
      return;
    }
    setTourSpotlightRect(rect);
  }

  function isTourEventAllowed(target: EventTarget | null) {
    if (!(target instanceof Node)) {
      return false;
    }
    if (tourCardRef.current?.contains(target)) {
      return true;
    }
    if (!activeSpotlight) {
      return false;
    }
    const element = getSpotlightElement();
    if (!element) {
      return false;
    }
    return element.contains(target);
  }

  useEffect(() => {
    if (selectedGame === "tiktok" || selectedGame === "instagram") {
      setGameFilters({ media_platform: selectedGame });
    } else {
      setGameFilters({});
    }
    setFortniteSelectorOpen(null);
    setFortniteSelectorSearch("");
    setFortniteSelectorDraft([]);
    setFortniteSelectorRemoteOptions([]);
    setFortniteSelectorRemoteLoading(false);
    setFortniteTypingSuggestions([]);
  }, [selectedGame]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const completed = window.localStorage.getItem(TOUR_STORAGE_KEY) === "1";
    if (!completed) {
      setTourOpen(true);
      setTourStepId("welcome");
    }
    setTourReady(true);
  }, []);

  useEffect(() => {
    if (!tourOpen) {
      setTourSpotlightRect(null);
      return;
    }
    const element = getSpotlightElement();
    if (element) {
      element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    }
    refreshTourSpotlightRect();
    const sync = () => refreshTourSpotlightRect();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [tourOpen, activeSpotlight, tourStepId, tourTick, activeListingId]);

  useEffect(() => {
    if (!tourOpen) {
      setTourBlockMessage(null);
      return;
    }
    setTourBlockMessage(null);
  }, [tourOpen, tourStepId]);

  useEffect(() => {
    if (!tourOpen) {
      return;
    }
    const handler = (event: Event) => {
      if (
        tourStepId === "listings" &&
        isTourEventAllowed(event.target) &&
        !(event.target instanceof Node && tourCardRef.current?.contains(event.target))
      ) {
        window.setTimeout(() => {
          nextTourStep();
        }, 80);
        return;
      }
      if (isTourEventAllowed(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if ("stopImmediatePropagation" in event) {
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener("pointerdown", handler, true);
    document.addEventListener("click", handler, true);
    return () => {
      document.removeEventListener("pointerdown", handler, true);
      document.removeEventListener("click", handler, true);
    };
  }, [tourOpen, activeSpotlight, tourStepId, tourStepIndex]);

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
    const queryValue = debouncedQuery.trim();
    if (queryValue.length < 2) {
      setRemoteTitleSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const run = async () => {
      try {
        const payload: Record<string, unknown> = {
          q: queryValue,
          page: 1,
          pageSize: 24,
          sort: "relevance"
        };
        const searchTarget = GAME_SEARCH_PARAMS[selectedGame];
        if (searchTarget.game) {
          payload.game = searchTarget.game;
        }
        if (searchTarget.category) {
          payload.category = searchTarget.category;
        }
        if (selectedGame === "tiktok" || selectedGame === "instagram") {
          const mediaPlatform = (gameFilters.media_platform ?? "").trim();
          payload.category = mediaPlatform || selectedGame;
        }

        const response = await fetch("/api/search", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(payload),
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) {
          setRemoteTitleSuggestions([]);
          return;
        }

        const data = (await response.json()) as SearchResponse;
        const titles = new Map<string, string>();
        for (const listing of Array.isArray(data.listings) ? data.listings : []) {
          const title = listing.title.trim();
          if (!title || title.length > 120) {
            continue;
          }
          const signature = title.toLowerCase();
          if (!titles.has(signature)) {
            titles.set(signature, title);
          }
        }
        setRemoteTitleSuggestions(Array.from(titles.values()).slice(0, 60));
      } catch {
        if (!controller.signal.aborted) {
          setRemoteTitleSuggestions([]);
        }
      }
    };

    run();
    return () => controller.abort();
  }, [debouncedQuery, selectedGame, gameFilters.media_platform]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, sort, selectedGame, minPrice, maxPrice, gameFilters]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const normalized = debouncedQuery.trim();
    const hasSearchContext =
      Boolean(normalized) ||
      selectedGame !== "all" ||
      sort !== "relevance" ||
      Boolean(minPrice.trim()) ||
      Boolean(maxPrice.trim()) ||
      Object.values(gameFilters).some((value) => Boolean(value.trim()));

    if (!hasSearchContext) {
      const runPopularListings = async () => {
        setLoading(true);
        setError(null);
        try {
          const response = await fetch("/api/search/popular", {
            cache: "no-store",
            signal: controller.signal
          });
          if (!response.ok) {
            const payload = (await response.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(payload.error || "Unable to load popular listings");
          }
          const data = (await response.json()) as PopularSearchResponse;
          if (!cancelled) {
            setListings(Array.isArray(data.listings) ? data.listings : []);
            setHasMore(false);
          }
        } catch (searchError) {
          if (!cancelled && !(searchError instanceof DOMException && searchError.name === "AbortError")) {
            setListings([]);
            const message =
              searchError instanceof Error ? searchError.message : "Unable to load popular listings";
            setError(message);
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
            setReady(true);
          }
        }
      };
      runPopularListings();
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    async function runSearch() {
      setError(null);
      setLoading(true);
      try {
        const payload: Record<string, unknown> = {
          q: normalized,
          page: currentPage,
          pageSize: PAGE_SIZE,
          sort
        };
        const searchTarget = GAME_SEARCH_PARAMS[selectedGame];
        if (searchTarget.game) {
          payload.game = searchTarget.game;
        }
        if (searchTarget.category) {
          payload.category = searchTarget.category;
        }
        if (selectedGame === "tiktok" || selectedGame === "instagram") {
          const mediaPlatform = (gameFilters.media_platform ?? "").trim();
          payload.category = mediaPlatform || selectedGame;
        }
        if (minPrice.trim()) {
          payload.minPrice = minPrice.trim();
        }
        if (maxPrice.trim()) {
          payload.maxPrice = maxPrice.trim();
        }
        const supplierFilters: Record<string, string> = {};
        for (const [key, value] of Object.entries(gameFilters)) {
          const normalizedValue = value.trim();
          if (normalizedValue) {
            supplierFilters[key] = normalizedValue;
          }
        }
        payload.supplierFilters = supplierFilters;

        const response = await fetch("/api/search", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(payload),
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          const fallbackMessage = response.status >= 500 ? "Search timed out. Please retry." : "Search failed";
          throw new Error(payload.error || fallbackMessage);
        }
        const data: SearchResponse = await response.json();
        if (!cancelled) {
          setListings(Array.isArray(data.listings) ? data.listings : []);
          setHasMore(Boolean(data.pagination?.hasMore));
        }
      } catch (searchError) {
        if (!cancelled && !(searchError instanceof DOMException && searchError.name === "AbortError")) {
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
      controller.abort();
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

  useEffect(() => {
    const categoryParam = (
      searchParams.get("category") ??
      searchParams.get("game") ??
      ""
    )
      .toLowerCase()
      .trim();
    if (!categoryParam) {
      return;
    }
    const mapped = CATEGORY_PARAM_ALIASES[categoryParam];
    if (mapped && mapped !== selectedGame) {
      setSelectedGame(mapped);
    }
  }, [searchParams, selectedGame]);

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

  function requestBuy(listingId: string) {
    if (!viewer) {
      router.push(`/login?next=${encodeURIComponent(`/?item=${listingId}`)}`);
      return;
    }
    if (buying) {
      return;
    }
    setError(null);
    setPendingPurchaseListingId(listingId);
  }

  async function confirmBuy() {
    if (!viewer || !pendingPurchaseListingId) {
      setPendingPurchaseListingId(null);
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
          listingId: pendingPurchaseListingId,
          couponCode: purchaseCouponCode.trim() || null
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
      setPendingPurchaseListingId(null);
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

  function renderTriStateFilter(
    label: string,
    key: string,
    options: FilterOption[] = ANY_YES_NO_OPTIONS
  ) {
    return (
      <div className="space-y-1.5 rounded-xl border border-white/10 bg-black/20 p-2">
        <p className="text-xs font-semibold text-zinc-200">{label}</p>
        <div className="grid grid-cols-3 gap-1">
          {options.map((option) => (
            <button
              key={`${key}_${option.value || "any"}`}
              type="button"
              onClick={() => setGameFilter(key, option.value)}
              className={cn(
                "h-8 rounded-lg border text-xs transition",
                (gameFilters[key] ?? "") === option.value
                  ? "border-emerald-300/50 bg-emerald-300/15 text-emerald-100"
                  : "border-white/10 bg-black/25 text-zinc-300 hover:border-white/25 hover:text-white"
              )}
            >
              {option.label}
            </button>
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
  const hasSearchContext =
    Boolean(query.trim()) ||
    selectedGame !== "all" ||
    sort !== "relevance" ||
    Boolean(minPrice.trim()) ||
    Boolean(maxPrice.trim()) ||
    Object.values(gameFilters).some((value) => Boolean(value.trim()));
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
    for (const remoteTitle of remoteTitleSuggestions) {
      source.add(remoteTitle);
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
        const fuzzyWordMatch = hasFuzzyWordMatch(queryWords, candidateWords);

        if (!starts && !contains && !wordStarts && !subsequence && !fuzzyWordMatch) {
          return null;
        }

        const score = starts ? 0 : wordStarts ? 1 : contains ? 2 : fuzzyWordMatch ? 3 : 4;
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
  }, [query, selectedGame, listings, gameFilters, fortniteTypingSuggestions, remoteTitleSuggestions]);
  const showSuggestions = searchFocused && suggestions.length > 0;
  const canAdvanceTourStep = true;
  const spotlightFrame = useMemo(() => {
    if (!tourOpen || !tourSpotlightRect) {
      return null;
    }
    const padding = 4;
    const top = Math.max(8, tourSpotlightRect.top - padding);
    const left = Math.max(8, tourSpotlightRect.left - padding);
    const width = Math.max(24, tourSpotlightRect.width + padding * 2);
    const height = Math.max(24, tourSpotlightRect.height + padding * 2);
    return { top, left, width, height };
  }, [tourOpen, tourSpotlightRect]);
  const tourCardStyle = useMemo(() => {
    if (!tourOpen) {
      return undefined;
    }
    const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 720 : window.innerHeight;
    const cardWidth = Math.min(360, Math.max(260, viewportWidth - 24));
    const fallbackTop = Math.min(viewportHeight - 250, 16);
    const fallbackLeft = Math.max(12, (viewportWidth - cardWidth) / 2);
    if (!spotlightFrame) {
      return { top: `${fallbackTop}px`, left: `${fallbackLeft}px`, width: `${cardWidth}px` };
    }
    const gap = 12;
    const preferredTop = spotlightFrame.top + spotlightFrame.height + gap;
    const placeAbove = preferredTop + 220 > viewportHeight;
    const top = placeAbove
      ? Math.max(12, spotlightFrame.top - 220 - gap)
      : Math.min(viewportHeight - 232, preferredTop);
    const left = Math.min(
      Math.max(12, spotlightFrame.left),
      Math.max(12, viewportWidth - cardWidth - 12)
    );
    return { top: `${top}px`, left: `${left}px`, width: `${cardWidth}px` };
  }, [tourOpen, spotlightFrame]);
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
            <Link href={SUPPORT_HREF} className="w-full md:w-auto" data-tour="support-button">
              <Button variant="ghost" className="h-12 w-full gap-2 md:w-auto">
                <MessageCircle size={16} />
                Support
              </Button>
            </Link>
            <Button
              type="button"
              variant="ghost"
              className="h-12 w-full md:w-auto"
              onClick={startTour}
            >
              How it works
            </Button>
          </div>
          <div data-tour="filters" className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs text-zinc-400">Categories</p>
            <div className="flex flex-wrap gap-2">
              {MARKET_CATEGORY_TABS.map((category) => {
                const active = selectedGame === category.value;
                return (
                  <button
                    key={category.value}
                    type="button"
                    onClick={() => setSelectedGame(category.value)}
                    title={category.label}
                    className={cn(
                      "inline-flex h-12 w-12 items-center justify-center rounded-xl border text-xs font-medium transition",
                      active
                        ? "border-white/40 bg-white/15 text-white"
                        : "border-white/15 bg-black/35 text-zinc-300 hover:border-white/25 hover:text-white"
                    )}
                  >
                    {category.iconSrc ? (
                      <img
                        src={category.iconSrc}
                        alt={category.label}
                        className="h-7 w-7 rounded-sm object-contain"
                      />
                    ) : (
                      <span className="text-[10px] font-semibold tracking-wide">
                        {category.iconText ?? category.label.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">

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
                      <div className="grid gap-3 lg:grid-cols-2">
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
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-zinc-200">Rainbow Six Siege</p>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
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
                          {renderRangePair("siege_level_min", "siege_level_max", "Level from")}
                          {renderRangePair("siege_operators_min", "siege_operators_max", "Operators from")}
                          {renderRangePair("siege_skins_min", "siege_skins_max", "Skins from")}
                          <Input
                            value={gameFilters.siege_operators ?? ""}
                            onChange={(event) => setGameFilter("siege_operators", event.target.value)}
                            placeholder="Operators"
                            className="h-9"
                          />
                          <Input
                            value={gameFilters.siege_skins ?? ""}
                            onChange={(event) => setGameFilter("siege_skins", event.target.value)}
                            placeholder="Skins"
                            className="h-9"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={gameFilters.siege_rank_min ?? ""}
                              onChange={(event) => setGameFilter("siege_rank_min", event.target.value)}
                              className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                            >
                              {SIEGE_RANK_OPTIONS.map((rank) => (
                                <option key={`siege_rank_min_${rank || "any"}`} value={rank}>
                                  {rank ? rank.toUpperCase() : "Rank from"}
                                </option>
                              ))}
                            </select>
                            <select
                              value={gameFilters.siege_rank_max ?? ""}
                              onChange={(event) => setGameFilter("siege_rank_max", event.target.value)}
                              className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                            >
                              {SIEGE_RANK_OPTIONS.map((rank) => (
                                <option key={`siege_rank_max_${rank || "any"}`} value={rank}>
                                  {rank ? rank.toUpperCase() : "up to"}
                                </option>
                              ))}
                            </select>
                          </div>
                          {renderTriStateFilter("Has ban in game", "siege_banned")}
                          </div>
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
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
                      </div>
                    )}

                    {selectedGame === "roblox" && (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-zinc-200">Roblox Accounts</p>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                          {renderRangePair("roblox_friends_min", "roblox_friends_max", "Friends from")}
                          {renderRangePair("roblox_followers_min", "roblox_followers_max", "Followers from")}
                          {renderRangePair("roblox_level_min", "roblox_level_max", "Level from")}
                          {renderRangePair("roblox_robux_min", "roblox_robux_max", "Robux from")}
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              type="number"
                              min={0}
                              value={gameFilters.roblox_registered_earlier ?? ""}
                              onChange={(event) =>
                                setGameFilter("roblox_registered_earlier", event.target.value)
                              }
                              placeholder="Registered earlier"
                              className="h-9"
                            />
                            <select
                              value={gameFilters.roblox_registered_unit ?? "years"}
                              onChange={(event) =>
                                setGameFilter("roblox_registered_unit", event.target.value)
                              }
                              className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                            >
                              <option value="years">years ago</option>
                              <option value="months">months ago</option>
                              <option value="days">days ago</option>
                            </select>
                          </div>
                          <select
                            value={gameFilters.roblox_subscription_type ?? ""}
                            onChange={(event) =>
                              setGameFilter("roblox_subscription_type", event.target.value)
                            }
                            className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                          >
                            <option value="">Subscription type</option>
                            <option value="premium">Premium</option>
                            <option value="none">Without subscription</option>
                          </select>
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              type="number"
                              min={0}
                              value={gameFilters.roblox_validity_for ?? ""}
                              onChange={(event) => setGameFilter("roblox_validity_for", event.target.value)}
                              placeholder="Validity for"
                              className="h-9"
                            />
                            <select
                              value={gameFilters.roblox_validity_unit ?? "days"}
                              onChange={(event) => setGameFilter("roblox_validity_unit", event.target.value)}
                              className="h-9 w-full rounded-xl border border-white/15 bg-black/35 px-3 text-sm text-white focus-visible:outline-none focus-visible:shadow-focus"
                            >
                              <option value="days">Days</option>
                              <option value="months">Months</option>
                              <option value="years">Years</option>
                            </select>
                          </div>
                          {renderRangePair(
                            "roblox_transaction_robux_min",
                            "roblox_transaction_robux_max",
                            "Total robux from"
                          )}
                          {renderRangePair("roblox_gamepasses_min", "roblox_gamepasses_max", "Gamepasses from")}
                          </div>
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                          {renderRangePair(
                            "roblox_inventory_value_min",
                            "roblox_inventory_value_max",
                            "Inventory value from"
                          )}
                          {renderRangePair("roblox_limited_rap_min", "roblox_limited_rap_max", "Limited items RAP from")}
                          {renderRangePair("roblox_ugc_rap_min", "roblox_ugc_rap_max", "RAP UGC from")}
                          {renderRangePair("roblox_offsale_items_min", "roblox_offsale_items_max", "Offsale items from")}
                          {renderRangePair("roblox_credit_balance_min", "roblox_credit_balance_max", "Credit balance from")}
                          {renderRangePair(
                            "roblox_age_days_min",
                            "roblox_age_days_max",
                            "Age in days from"
                          )}
                          <Input
                            value={gameFilters.roblox_country ?? ""}
                            onChange={(event) => setGameFilter("roblox_country", event.target.value)}
                            placeholder="Country"
                            className="h-9"
                          />
                          <Input
                            value={gameFilters.roblox_exclude_country ?? ""}
                            onChange={(event) => setGameFilter("roblox_exclude_country", event.target.value)}
                            placeholder="Exclude country"
                            className="h-9"
                          />
                          <Input
                            value={gameFilters.roblox_age_group ?? ""}
                            onChange={(event) => setGameFilter("roblox_age_group", event.target.value)}
                            placeholder="Age group"
                            className="h-9"
                          />
                          <Input
                            value={gameFilters.roblox_exclude_age_group ?? ""}
                            onChange={(event) => setGameFilter("roblox_exclude_age_group", event.target.value)}
                            placeholder="Exclude age group"
                            className="h-9"
                          />
                          {renderTriStateFilter("Email is verified", "roblox_email_verified")}
                          {renderTriStateFilter("Xbox connected", "roblox_xbox_connected")}
                          {renderTriStateFilter("PSN connected", "roblox_psn_connected")}
                          {renderTriStateFilter("Only verified", "roblox_only_verified")}
                          {renderTriStateFilter("Age verified", "roblox_age_verified")}
                          {renderTriStateFilter(
                            "Auto renewal subscription",
                            "roblox_auto_renewal_subscription"
                          )}
                          {renderTriStateFilter(
                            "Donation in popular games",
                            "roblox_donation_popular_games"
                          )}
                          {renderTriStateFilter("Voice chat available", "roblox_voice_chat")}
                          <Input
                            value={gameFilters.roblox_selected_game ?? ""}
                            onChange={(event) =>
                              setGameFilter("roblox_selected_game", event.target.value)
                            }
                            placeholder="Select a game"
                            className="h-9"
                          />
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedGame === "supercell" && (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-zinc-200">Supercell Accounts</p>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                          <Input
                            value={gameFilters.supercell_game ?? ""}
                            onChange={(event) => setGameFilter("supercell_game", event.target.value)}
                            placeholder="Game (Brawl Stars / Clash of Clans / Clash Royale)"
                            className="h-9"
                          />
                          <Input
                            value={gameFilters.supercell_exclude_game ?? ""}
                            onChange={(event) =>
                              setGameFilter("supercell_exclude_game", event.target.value)
                            }
                            placeholder="Exclude game"
                            className="h-9"
                          />
                          {renderRangePair(
                            "supercell_trophies_min",
                            "supercell_trophies_max",
                            "Trophies from"
                          )}
                          {renderRangePair("supercell_gems_min", "supercell_gems_max", "Gems from")}
                          </div>
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                          {renderRangePair("supercell_level_min", "supercell_level_max", "Level from")}
                          </div>
                        </div>
                      </div>
                    )}

                    {(selectedGame === "tiktok" || selectedGame === "instagram") && (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-zinc-200">
                          {selectedGame === "tiktok" ? "TikTok Accounts" : "Instagram Accounts"}
                        </p>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                            {renderRangePair("media_followers_min", "media_followers_max", "Followers from")}
                            {renderRangePair("media_following_min", "media_following_max", "Following from")}
                            {renderRangePair("media_posts_min", "media_posts_max", "Posts from")}
                            {renderRangePair("media_age_days_min", "media_age_days_max", "Age in days from")}
                          </div>
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
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
                      </div>
                    )}

                    {selectedGame === "telegram" && (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-zinc-200">Telegram Accounts</p>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
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
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                          {renderRangePair("telegram_sessions_min", "telegram_sessions_max", "Sessions from")}
                          {renderRangePair("telegram_stars_min", "telegram_stars_max", "Stars from")}
                          {renderRangePair("telegram_age_days_min", "telegram_age_days_max", "Age in days from")}
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedGame === "discord" && (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-zinc-200">Discord Accounts</p>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
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
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
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
                      </div>
                    )}

                    {selectedGame === "steam" && (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-zinc-200">Steam Accounts</p>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                          {renderRangePair("steam_game_count_min", "steam_game_count_max", "Games from")}
                          {renderRangePair("steam_level_min", "steam_level_max", "Level from")}
                          {renderRangePair(
                            "steam_inventory_value_min",
                            "steam_inventory_value_max",
                            "Inventory value from"
                          )}
                          {renderRangePair("steam_hours_min", "steam_hours_max", "Hours from")}
                          </div>
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
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
                      </div>
                    )}

                    {selectedGame === "cs2" && (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-zinc-200">Counter-Strike 2</p>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
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
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
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
                      </div>
                    )}

                    {selectedGame === "battlenet" && (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-zinc-200">Battle.net Accounts</p>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
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
                          <div className="h-full space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
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
        </div>
      </section>

      <section data-tour="listings" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loading && (
          <div
            data-tour="listings-loading"
            className="glass-panel col-span-full rounded-2xl p-5 text-center md:p-6"
          >
            <p className="text-base font-semibold text-white">Loading listings, please wait</p>
            <div className="mt-3 inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-emerald-300 [animation-delay:-0.3s]" />
              <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-emerald-300/85 [animation-delay:-0.15s]" />
              <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-emerald-300/70" />
            </div>
          </div>
        )}

        {!loading &&
          listings.map((listing, index) => {
            const rarityTone = inferRarityTone(listing);
            return (
              <button
                key={listing.id}
                data-tour={index === 0 ? "listing-card-primary" : undefined}
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

      {ready && !loading && !hasSearchContext && listings.length === 0 && (
        <div className="glass-panel rounded-2xl p-10 text-center">
          <p className="font-[var(--font-space-grotesk)] text-xl font-semibold text-white">
            Most Popular Listings
          </p>
          <p className="mt-2 text-sm text-zinc-300">
            No featured data yet. Start searching to see listings.
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

      {tourReady && tourOpen && (
        <div className="pointer-events-none fixed inset-0 z-[70]">
          {!spotlightFrame && <div className="absolute inset-0 bg-black/84 backdrop-blur-[2px]" />}
          {spotlightFrame && (
            <>
              <div
                className="absolute left-0 right-0 top-0 bg-black/84 backdrop-blur-[2px]"
                style={{ height: `${Math.max(0, spotlightFrame.top)}px` }}
              />
              <div
                className="absolute left-0 bg-black/84 backdrop-blur-[2px]"
                style={{
                  top: `${spotlightFrame.top}px`,
                  width: `${Math.max(0, spotlightFrame.left)}px`,
                  height: `${spotlightFrame.height}px`
                }}
              />
              <div
                className="absolute right-0 bg-black/84 backdrop-blur-[2px]"
                style={{
                  top: `${spotlightFrame.top}px`,
                  left: `${spotlightFrame.left + spotlightFrame.width}px`,
                  height: `${spotlightFrame.height}px`
                }}
              />
              <div
                className="absolute bottom-0 left-0 right-0 bg-black/84 backdrop-blur-[2px]"
                style={{ top: `${spotlightFrame.top + spotlightFrame.height}px` }}
              />
              <div
                className="pointer-events-none absolute rounded-2xl border-2 border-white/85 transition-all duration-300"
                style={{
                  top: `${spotlightFrame.top}px`,
                  left: `${spotlightFrame.left}px`,
                  width: `${spotlightFrame.width}px`,
                  height: `${spotlightFrame.height}px`
                }}
              />
              <div
                className="pointer-events-none absolute rounded-2xl border border-sky-300/70 animate-pulse"
                style={{
                  top: `${spotlightFrame.top - 2}px`,
                  left: `${spotlightFrame.left - 2}px`,
                  width: `${spotlightFrame.width + 4}px`,
                  height: `${spotlightFrame.height + 4}px`
                }}
              />
            </>
          )}
          <div
            ref={tourCardRef}
            className="pointer-events-auto absolute rounded-2xl border border-white/25 bg-gradient-to-br from-zinc-900/95 via-zinc-950/95 to-slate-950/95 p-4 text-zinc-100 shadow-2xl sm:p-5"
            style={tourCardStyle}
          >
            {tourStepId === "welcome" ? (
              <>
                <p className="text-lg font-semibold text-white">Welcome to AE Marketplace</p>
                <p className="mt-2 text-sm text-zinc-300">
                  Lets quickly show you how everything works.
                </p>
                <div className="mt-4 flex gap-2">
                  <Button type="button" className="flex-1" onClick={nextTourStep}>
                    Start Tour
                  </Button>
                  <Button type="button" variant="ghost" className="flex-1" onClick={completeTour}>
                    Skip All
                  </Button>
                </div>
              </>
            ) : tourStepId === "done" ? (
              <>
                <p className="text-lg font-semibold text-white">Youre all set</p>
                <p className="mt-2 text-sm text-zinc-300">
                  Enjoy browsing and grab the best deals.
                </p>
                <div className="mt-4 flex gap-2">
                  <Button type="button" className="flex-1" onClick={completeTour}>
                    Done
                  </Button>
                  <Button type="button" variant="ghost" className="flex-1" onClick={startTour}>
                    Restart Tour
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold uppercase tracking-[0.14em] text-sky-300">
                    Step {Math.max(1, tourStepIndex)} / {Math.max(1, TOUR_STEPS.length - 1)}
                  </p>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-xs text-zinc-300 hover:bg-white/10 hover:text-white"
                    onClick={completeTour}
                  >
                    Skip All
                  </button>
                </div>
                <p className="mt-2 text-lg font-semibold text-white">
                  {activeSpotlight?.title ?? "Tour Step"}
                </p>
                <p className="mt-1 text-sm text-zinc-300">
                  {activeSpotlight?.message ?? "Youre all set. Enjoy browsing and grab the best deals."}
                </p>
                {tourBlockMessage && (
                  <p className="mt-3 rounded-xl border border-amber-300/25 bg-amber-950/35 px-3 py-2 text-xs text-amber-100">
                    {tourBlockMessage}
                  </p>
                )}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={tourStepIndex <= 0}
                    onClick={previousTourStep}
                  >
                    Back
                  </Button>
                  <Button type="button" variant="ghost" onClick={skipCurrentTourStep}>
                    Skip Step
                  </Button>
                  <Button
                    type="button"
                    className="col-span-2"
                    disabled={!canAdvanceTourStep}
                    onClick={nextTourStep}
                  >
                    {tourStepId === "support" ? "Finish Tour" : "Next"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ProductDetailModal
        listing={modalListing}
        viewer={viewer}
        onClose={() => setActiveListingId(null)}
        onBuy={requestBuy}
        couponCode={purchaseCouponCode}
        onCouponCodeChange={setPurchaseCouponCode}
        buying={buying}
        purchaseError={error}
        descriptionLoading={detailLoading}
        descriptionError={detailError}
        imageTheme={selectedGame === "fortnite" ? "fortnite" : null}
      />

      <ConfirmModal
        open={Boolean(pendingPurchaseListingId)}
        title="Confirm Purchase"
        description="Are you sure you want to buy this account? Funds will be deducted immediately."
        confirmLabel="Confirm Purchase"
        cancelLabel="Cancel"
        loading={buying}
        onConfirm={confirmBuy}
        onCancel={() => {
          if (!buying) {
            setPendingPurchaseListingId(null);
          }
        }}
      />
    </main>
  );
}
