import { fallbackListings } from "@/lib/market";
import { getLztAccessToken } from "@/lib/lzt-auth";
import { resolveFortniteSelectorFiltersWithMeta } from "@/lib/lzt-fortnite-selectors";
import { applyMarkup } from "@/lib/pricing";
import { readStore } from "@/lib/store";
import { MarketListing, MarketListingSpec } from "@/lib/types";

export type SearchSort = "relevance" | "price_asc" | "price_desc" | "newest";
export type SearchResult = {
  listings: MarketListing[];
  hasMore: boolean;
  page: number;
  pageSize: number;
};

export type SearchOptions = {
  sort?: SearchSort;
  minPrice?: number | null;
  maxPrice?: number | null;
  game?: string | null;
  category?: string | null;
  page?: number;
  pageSize?: number;
  hasImage?: boolean;
  hasDescription?: boolean;
  hasSpecs?: boolean;
  supplierFilters?: Record<string, string>;
  disableNativeFortniteSelectorParams?: boolean;
};

const translationCache = new Map<string, string>();
const fortniteCosmeticImageCache = new Map<string, { imageUrl: string; expiresAt: number }>();
const searchResultCache = new Map<string, { expiresAt: number; staleUntil: number; result: SearchResult }>();
const inFlightSearches = new Map<string, Promise<SearchResult>>();
const SEARCH_RESULT_CACHE_TTL_MS = Number(process.env.SEARCH_RESULT_CACHE_TTL_MS ?? 45_000);
const SEARCH_RESULT_STALE_TTL_MS = Number(
  process.env.SEARCH_RESULT_STALE_TTL_MS ?? 180_000
);
const RUB_TO_USD_RATE_RAW = Number(process.env.RUB_TO_USD_RATE ?? 0.013);
const EUR_TO_USD_RATE_RAW = Number(process.env.EUR_TO_USD_RATE ?? 1.08);
const DEFAULT_LZT_API_BASE_URL = "https://prod-api.lzt.market";
const SUPPLIER_FETCH_TIMEOUT_MS = 9000;
const SEARCH_EXECUTION_BUDGET_MS = 11_000;
const SUPPLIER_MAX_QUERY_VARIANTS = 8;
const SUPPLIER_MAX_PAGE_SPAN = 2;
const SUPPLIER_MAX_CATEGORY_ENDPOINTS = 4;
const SUPPLIER_MAX_LOGICAL_PAGES = 12;
const HEAVY_FILTER_MAX_QUERY_VARIANTS = 2;
const HEAVY_FILTER_MAX_PAGE_SPAN = 1;
const HEAVY_FILTER_MAX_CATEGORY_ENDPOINTS = 1;
const HEAVY_FILTER_MAX_LOGICAL_PAGES = 10;
const PRICE_FILTER_MAX_LOGICAL_PAGES = 60;
const DEFAULT_LISTING_IMAGE = "/listing-placeholder.svg";
const ENABLE_NATIVE_FORTNITE_SELECTOR_PARAMS = true;
const BLOCKED_MARKET_LINK_PATTERN =
  /(?:https?:\/\/|www\.)[^\s\]]*(?:lzt\.market|lolz\.guru)|\[url[^\]]*=(?:https?:\/\/)?(?:www\.)?(?:lzt\.market|lolz\.guru)[^\]]*\]|\b(?:lzt\.market|lolz\.guru)\b/i;
const ALLOWED_MARKET_IMAGE_LINK_PATTERN =
  /(?:https?:\/\/)?(?:www\.)?(?:lzt\.market|lolz\.guru)\/(?:market\/)?\d+\/image(?:\?[^ \]\n\r<>"']*)?/gi;
const SUPPLIER_CURRENCY = "usd";

function resolveRate(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min || value > max) {
    return fallback;
  }
  return value;
}

const RUB_TO_USD_RATE = resolveRate(RUB_TO_USD_RATE_RAW, 0.013, 0.005, 0.05);
const EUR_TO_USD_RATE = resolveRate(EUR_TO_USD_RATE_RAW, 1.08, 0.5, 2.5);

function normalizeSupplierBaseUrl(value: string) {
  const raw = value.trim();
  if (!raw) {
    return DEFAULT_LZT_API_BASE_URL;
  }

  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    const host = parsed.hostname.toLowerCase();
    if (
      host === "lzt.market" ||
      host === "www.lzt.market" ||
      host === "lolz.guru" ||
      host === "lolz.live" ||
      host === "www.lolz.guru" ||
      host === "www.lolz.live"
    ) {
      return DEFAULT_LZT_API_BASE_URL;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_LZT_API_BASE_URL;
  }
}

function getLztBaseUrl() {
  return normalizeSupplierBaseUrl(process.env.LZT_API_BASE_URL ?? DEFAULT_LZT_API_BASE_URL);
}

function buildSupplierFilterCacheKey(filters: Record<string, string> | undefined) {
  if (!filters) {
    return "";
  }
  const entries = Object.entries(filters)
    .map(([key, value]) => [key.trim(), value.trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return "";
  }
  return entries.map(([key, value]) => `${key}=${value}`).join("&");
}

function buildSearchResultCacheKey(
  query: string,
  options: SearchOptions,
  markupPercent: number
) {
  return JSON.stringify({
    q: query.trim().toLowerCase(),
    sort: options.sort ?? "relevance",
    minPrice: Number.isFinite(options.minPrice ?? NaN) ? Number(options.minPrice) : null,
    maxPrice: Number.isFinite(options.maxPrice ?? NaN) ? Number(options.maxPrice) : null,
    game: options.game?.trim().toLowerCase() ?? "",
    category: options.category?.trim().toLowerCase() ?? "",
    page: Number.isFinite(options.page ?? NaN) ? Number(options.page) : 1,
    pageSize: Number.isFinite(options.pageSize ?? NaN) ? Number(options.pageSize) : 15,
    hasImage: Boolean(options.hasImage),
    hasDescription: Boolean(options.hasDescription),
    hasSpecs: Boolean(options.hasSpecs),
    supplierFilters: buildSupplierFilterCacheKey(options.supplierFilters),
    disableNativeFortniteSelectorParams: Boolean(options.disableNativeFortniteSelectorParams),
    markupPercent
  });
}

function readSearchResultCache(cacheKey: string, allowStale = false): SearchResult | null {
  const cached = searchResultCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  const now = Date.now();
  if (now > cached.staleUntil) {
    searchResultCache.delete(cacheKey);
    return null;
  }
  if (!allowStale && now > cached.expiresAt) {
    return null;
  }
  return structuredClone(cached.result);
}

function writeSearchResultCache(cacheKey: string, result: SearchResult) {
  if (!cacheKey) {
    return;
  }
  searchResultCache.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_RESULT_CACHE_TTL_MS,
    staleUntil: Date.now() + SEARCH_RESULT_STALE_TTL_MS,
    result: structuredClone(result)
  });
}

function getSearchEndpoint() {
  const configured = (process.env.LZT_API_SEARCH_URL ?? "").trim();
  if (!configured) {
    return `${getLztBaseUrl()}/`;
  }
  const normalized = normalizeSupplierBaseUrl(configured);
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    const isOfficialLztHost =
      host === "prod-api.lzt.market" ||
      host.endsWith(".lzt.market") ||
      host === "lzt.market" ||
      host === "www.lzt.market" ||
      host === "lolz.guru" ||
      host === "www.lolz.guru" ||
      host === "lolz.live" ||
      host === "www.lolz.live";

    // For LZT hosts, search endpoints should always start from host root.
    // Path-scoped env values (e.g. .../fortnite) can accidentally produce
    // broken scoped URLs like /fortnite/fortnite and return empty results.
    if (isOfficialLztHost) {
      parsed.pathname = "/";
      parsed.search = "";
      parsed.hash = "";
      return normalizeEndpoint(parsed.toString());
    }
  } catch {
    // Fall back to normalized value below.
  }

  return normalizeEndpoint(normalized);
}

function getItemEndpointBase() {
  return process.env.LZT_API_ITEM_URL ?? getLztBaseUrl();
}

function getPurchaseEndpoint(listingId: string) {
  const encodedId = encodeURIComponent(listingId);
  const fallback = `${getLztBaseUrl()}/${encodedId}/fast-buy`;
  const configuredRaw = (process.env.LZT_API_PURCHASE_URL ?? "").trim();
  if (!configuredRaw) {
    return fallback;
  }

  const templated = configuredRaw
    .replace(/\{item_id\}/g, encodedId)
    .replace(/\{listing_id\}/g, encodedId)
    .replace(/\{listingId\}/g, encodedId);
  if (templated !== configuredRaw) {
    return templated;
  }

  try {
    const configuredUrl = new URL(configuredRaw);
    const baseUrl = new URL(getLztBaseUrl());
    const configuredPath = configuredUrl.pathname.replace(/\/+$/, "");
    const basePath = baseUrl.pathname.replace(/\/+$/, "");

    if (configuredUrl.origin === baseUrl.origin && configuredPath === basePath) {
      return fallback;
    }

    if (/\/fast-buy$/i.test(configuredPath) && !configuredPath.includes(`/${encodedId}/`)) {
      const prefix = configuredPath.replace(/\/fast-buy$/i, "");
      configuredUrl.pathname = `${prefix}/${encodedId}/fast-buy`;
      return configuredUrl.toString();
    }

    return configuredRaw;
  } catch {
    return fallback;
  }
}

function normalizeEndpoint(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function inferEndpointGameHint(endpoint: string) {
  const normalized = endpoint.trim();
  if (!normalized) {
    return "";
  }

  let token = "";
  try {
    const url = new URL(normalizeEndpoint(normalized));
    const segments = url.pathname
      .split("/")
      .map((segment) => toSlug(segment))
      .filter(Boolean);
    token = segments[segments.length - 1] ?? "";
  } catch {
    token = "";
  }

  if (!token) {
    return "";
  }

  const matches = (aliases: string[]) =>
    aliases.some((alias) => token === alias || token.includes(alias) || alias.includes(token));

  if (matches(["fortnite"])) {
    return "Fortnite";
  }
  if (matches(["epicgames", "epic-games", "epic"])) {
    return "Epic Games";
  }
  if (matches(["riot", "valorant", "league-of-legends", "leagueoflegends"])) {
    return "Riot Client";
  }
  if (matches(["rainbow-six-siege", "rainbowsixsiege", "siege", "r6"])) {
    return "Rainbow Six Siege";
  }
  if (matches(["roblox", "rbx", "blox"])) {
    return "Roblox";
  }
  if (matches(["steam", "cs2", "counter-strike", "counterstrike", "csgo"])) {
    return "Steam";
  }
  if (matches(["battlenet", "battle-net", "blizzard"])) {
    return "Battle.net";
  }
  if (matches(["instagram"])) {
    return "Instagram";
  }
  if (matches(["tiktok"])) {
    return "TikTok";
  }
  if (matches(["facebook"])) {
    return "Facebook";
  }
  if (matches(["twitter", "x-com"])) {
    return "Twitter/X";
  }
  if (matches(["youtube"])) {
    return "YouTube";
  }
  if (matches(["telegram"])) {
    return "Telegram";
  }
  if (matches(["discord"])) {
    return "Discord";
  }
  if (matches(["snapchat"])) {
    return "Snapchat";
  }
  if (matches(["social", "media"])) {
    return "Social Media";
  }

  return "";
}

function extractText(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const extracted = extractText(entry, "");
      if (extracted) {
        return extracted;
      }
    }
    return fallback;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = [
      "title",
      "name",
      "description",
      "description_en",
      "description_html",
      "descriptionHtml",
      "ru",
      "en",
      "username",
      "user_name",
      "login",
      "message",
      "body",
      "content",
      "post",
      "first_post",
      "value",
      "label",
      "text",
      "text_html",
      "url",
      "path"
    ];
    for (const key of keys) {
      if (key in record) {
        const extracted = extractText(record[key], "");
        if (extracted) {
          return extracted;
        }
      }
    }
  }
  return fallback;
}

function findTextDeep(
  value: unknown,
  keys: string[],
  maxDepth = 4
): string {
  const targetKeys = new Set(keys.map((key) => key.toLowerCase()));
  const visited = new Set<unknown>();

  function walk(node: unknown, depth: number): string {
    if (!node || depth > maxDepth) {
      return "";
    }
    if (typeof node !== "object") {
      return "";
    }
    if (visited.has(node)) {
      return "";
    }
    visited.add(node);

    if (Array.isArray(node)) {
      for (const entry of node) {
        const hit = walk(entry, depth + 1);
        if (hit) {
          return hit;
        }
      }
      return "";
    }

    const record = node as Record<string, unknown>;
    for (const [key, field] of Object.entries(record)) {
      if (targetKeys.has(key.toLowerCase())) {
        const extracted = extractText(field, "");
        if (extracted) {
          return extracted;
        }
      }
    }
    for (const field of Object.values(record)) {
      if (!field || typeof field !== "object") {
        continue;
      }
      const hit = walk(field, depth + 1);
      if (hit) {
        return hit;
      }
    }
    return "";
  }

  return walk(value, 0);
}

function parseMoneyToken(rawToken: string) {
  const compact = rawToken
    .trim()
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .replace(/'/g, "")
    .replace(/[^\d,.-]/g, "");

  if (!compact) {
    return 0;
  }

  const isNegative = compact.startsWith("-");
  const unsigned = compact.replace(/-/g, "");
  const commaCount = (unsigned.match(/,/g) ?? []).length;
  const dotCount = (unsigned.match(/\./g) ?? []).length;
  const lastComma = unsigned.lastIndexOf(",");
  const lastDot = unsigned.lastIndexOf(".");
  const lastSeparator = Math.max(lastComma, lastDot);

  let normalized = "";
  if (lastSeparator >= 0) {
    const fractionalLength = unsigned.length - lastSeparator - 1;
    const treatAsDecimal =
      fractionalLength > 0 &&
      fractionalLength <= 2 &&
      (commaCount > 1 || dotCount > 1 || commaCount + dotCount >= 1);

    if (treatAsDecimal) {
      const integerPart = unsigned.slice(0, lastSeparator).replace(/[.,]/g, "");
      const fractionalPart = unsigned.slice(lastSeparator + 1).replace(/[.,]/g, "");
      normalized = `${integerPart}.${fractionalPart}`;
    } else {
      normalized = unsigned.replace(/[.,]/g, "");
    }
  } else {
    normalized = unsigned;
  }

  if (!normalized || normalized === ".") {
    return 0;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const result = isNegative ? -parsed : parsed;
  if (result <= 0 || result > 100_000_000) {
    return 0;
  }
  return result;
}

function extractMoneyCandidatesFromString(raw: string) {
  const text = raw.trim();
  if (!text) {
    return [];
  }
  const tokens =
    text.match(/-?\d{1,3}(?:[.,'\s]\d{3})*(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?/g) ?? [];

  const values = tokens
    .map((token) => parseMoneyToken(token))
    .filter((value) => value > 0);

  if (values.length === 0) {
    return [];
  }

  const lowered = text.toLowerCase();
  if (/(discount|sale|now|final|old|before|after|скид|до|после|старая|новая)/.test(lowered)) {
    return [...values].sort((a, b) => a - b);
  }

  return values;
}

function extractNumber(value: unknown, depth = 0, seen = new Set<unknown>()): number {
  if (depth > 4 || value == null) {
    return 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  if (typeof value === "string") {
    const candidates = extractMoneyCandidatesFromString(value);
    return candidates[0] ?? 0;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = extractNumber(entry, depth + 1, seen);
      if (parsed > 0) {
        return parsed;
      }
    }
    return 0;
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return 0;
    }
    seen.add(value);

    const record = value as Record<string, unknown>;
    const orderedKeys = [
      "final_price",
      "sale_price",
      "current_price",
      "price",
      "amount",
      "value",
      "sum",
      "cost",
      "price_rub",
      "currency_price",
      "display_price"
    ];

    for (const key of orderedKeys) {
      if (!(key in record)) {
        continue;
      }
      const parsed = extractNumber(record[key], depth + 1, seen);
      if (parsed > 0) {
        return parsed;
      }
    }

    for (const [key, raw] of Object.entries(record)) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey.includes("price") ||
        normalizedKey.includes("amount") ||
        normalizedKey.includes("cost") ||
        normalizedKey.includes("sum")
      ) {
        const parsed = extractNumber(raw, depth + 1, seen);
        if (parsed > 0) {
          return parsed;
        }
      }
    }
  }
  return 0;
}

function resolveListingBasePrice(source: Record<string, unknown>) {
  const hasNonSalePriceHint = (value: unknown) => {
    const text = extractText(value, "").toLowerCase();
    if (!text) {
      return false;
    }
    return (
      text.includes("v-buck") ||
      text.includes("vbucks") ||
      text.includes(" v-b ") ||
      text.includes("vp") ||
      text.includes("riot points") ||
      text.includes("blue essence") ||
      text.includes("orange essence") ||
      text.includes("mythic essence") ||
      text.includes("inventory value") ||
      text.includes("locker value") ||
      text.includes("skins value")
    );
  };
  const parsePriceCandidate = (value: unknown, depth = 0): number => {
    if (value == null || depth > 2) {
      return 0;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) && value > 0 ? value : 0;
    }
    if (typeof value === "string") {
      if (hasNonSalePriceHint(value)) {
        return 0;
      }
      const parsed = extractNumber(value);
      return parsed > 0 ? parsed : 0;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const parsed = parsePriceCandidate(entry, depth + 1);
        if (parsed > 0) {
          return parsed;
        }
      }
      return 0;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      const keys = [
        "final_price",
        "sale_price",
        "current_price",
        "price",
        "amount",
        "cost",
        "price_rub",
        "sum",
        "display_price",
        "currency_price"
      ];
      for (const key of keys) {
        if (!(key in record)) {
          continue;
        }
        const parsed = parsePriceCandidate(record[key], depth + 1);
        if (parsed > 0) {
          return parsed;
        }
      }
    }
    return 0;
  };

  const normalizeParsedPrice = (raw: number) => {
    if (!(raw > 0)) {
      return 0;
    }
    return Math.round(raw * 100) / 100;
  };

  const parsedPrice = parsePriceCandidate(source.price);
  const parsedCurrencyPrice = parsePriceCandidate(source.currency_price);
  const parsedPriceRub = parsePriceCandidate(
    source.price_rub ?? source.currency_rub ?? source.rub_price ?? source.priceRub
  );
  if (parsedPriceRub > 0) {
    return normalizeParsedPrice(parsedPriceRub);
  }
  if (parsedCurrencyPrice > 0 && parsedPrice > 0 && parsedPrice < 1 && parsedCurrencyPrice >= 10) {
    return normalizeParsedPrice(parsedCurrencyPrice);
  }
  if (parsedPrice > 0 && parsedCurrencyPrice > 0) {
    const ratio = parsedPrice / parsedCurrencyPrice;
    if (ratio >= 95 && ratio <= 105) {
      return normalizeParsedPrice(parsedCurrencyPrice);
    }
    if (ratio >= 9500 && ratio <= 10500) {
      return normalizeParsedPrice(parsedPrice / 100);
    }
  }
  if (parsedCurrencyPrice > 0 && parsedPrice > 0 && parsedCurrencyPrice >= parsedPrice * 10) {
    return normalizeParsedPrice(parsedCurrencyPrice);
  }

  const directCandidates = [
    source.price_rub,
    source.currency_rub,
    source.rub_price,
    source.priceRub,
    source.currency_price,
    source.final_price,
    source.sale_price,
    source.current_price,
    source.price,
    source.amount,
    source.cost,
    source.sum,
    source.display_price
  ];

  for (const candidate of directCandidates) {
    const parsed = parsePriceCandidate(candidate);
    if (parsed > 0) {
      return normalizeParsedPrice(parsed);
    }
  }

  return 0;
}

function normalizePriceToUsd(amount: number, currency: string) {
  if (!(amount > 0)) {
    return 0;
  }
  const normalizedCurrency = currency.trim().toUpperCase();
  if (normalizedCurrency === "RUB" || normalizedCurrency === "RUR") {
    const rate = Number.isFinite(RUB_TO_USD_RATE) && RUB_TO_USD_RATE > 0 ? RUB_TO_USD_RATE : 0.013;
    return Math.round(amount * rate * 100) / 100;
  }
  if (normalizedCurrency === "EUR") {
    const rate = Number.isFinite(EUR_TO_USD_RATE) && EUR_TO_USD_RATE > 0 ? EUR_TO_USD_RATE : 1.08;
    return Math.round(amount * rate * 100) / 100;
  }
  if (normalizedCurrency === "USD") {
    const looksLikeMinorUnits = Number.isInteger(amount) && amount >= 100;
    const normalized = looksLikeMinorUnits ? amount / 100 : amount;
    return Math.round(normalized * 100) / 100;
  }
  return Math.round(amount * 100) / 100;
}

function extractItems(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data as Record<string, unknown>[];
  }
  if (!data || typeof data !== "object") {
    return [];
  }

  const record = data as Record<string, unknown>;
  const candidates = [record.items, record.accounts, record.results, record.data, record.list];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate as Record<string, unknown>[];
    }
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      if (Array.isArray(nested.items)) {
        return nested.items as Record<string, unknown>[];
      }
      if (Array.isArray(nested.accounts)) {
        return nested.accounts as Record<string, unknown>[];
      }
      if (Array.isArray(nested.list)) {
        return nested.list as Record<string, unknown>[];
      }
      if (Array.isArray(nested.results)) {
        return nested.results as Record<string, unknown>[];
      }
    }
  }

  return [];
}

function extractMarketListingIdFromText(value: string, allowPlainNumeric = false) {
  const text = value.trim();
  if (!text) {
    return "";
  }
  if (allowPlainNumeric && /^\d{5,}$/.test(text)) {
    return text;
  }
  const marketHostMatch = text.match(
    /(?:https?:\/\/)?(?:www\.)?(?:lzt\.market|lolz\.guru)\/(?:market\/)?(\d{5,})(?:[/?#]|$)/i
  );
  if (marketHostMatch?.[1]) {
    return marketHostMatch[1];
  }
  const marketPathMatch = text.match(/^\/(?:market\/)?(\d{5,})(?:[/?#]|$)/i);
  if (marketPathMatch?.[1]) {
    return marketPathMatch[1];
  }
  const imagePathMatch = text.match(/^\/(?:market\/)?(\d{5,})\/image(?:[/?#]|$)/i);
  if (imagePathMatch?.[1]) {
    return imagePathMatch[1];
  }
  const inlineMarketMatch = text.match(/(?:^|[^\d])market\/(\d{5,})(?:[/?#]|$)/i);
  if (inlineMarketMatch?.[1]) {
    return inlineMarketMatch[1];
  }
  const inlineImageMatch = text.match(/(?:^|[^\d])(\d{5,})\/image(?:[/?#]|$)/i);
  if (inlineImageMatch?.[1]) {
    return inlineImageMatch[1];
  }
  return "";
}

function extractMarketListingIdDeep(
  value: unknown,
  depth = 0,
  visited = new Set<unknown>()
): string {
  if (depth > 5 || value == null) {
    return "";
  }
  if (typeof value === "string") {
    return extractMarketListingIdFromText(value);
  }
  if (typeof value !== "object") {
    return "";
  }
  if (visited.has(value)) {
    return "";
  }
  visited.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const hit = extractMarketListingIdDeep(entry, depth + 1, visited);
      if (hit) {
        return hit;
      }
    }
    return "";
  }

  const record = value as Record<string, unknown>;
  const prioritizedKeys = [
    "url",
    "link",
    "href",
    "permalink",
    "item_url",
    "listing_url",
    "market_url",
    "image",
    "image_url",
    "imageUrl",
    "preview",
    "preview_url",
    "id",
    "item_id",
    "listing_id",
    "market_item_id"
  ];

  for (const key of prioritizedKeys) {
    if (!(key in record)) {
      continue;
    }
    const hit = extractMarketListingIdDeep(record[key], depth + 1, visited);
    if (hit) {
      return hit;
    }
  }

  for (const entry of Object.values(record)) {
    const hit = extractMarketListingIdDeep(entry, depth + 1, visited);
    if (hit) {
      return hit;
    }
  }
  return "";
}

function resolveListingId(source: Record<string, unknown>, fallbackIdSource: string) {
  const explicitIdCandidates = [
    source.item_id ??
      source.itemId ??
      source.listing_id ??
      source.listingId ??
      source.offer_id ??
      source.offerId ??
      source.thread_id ??
      source.threadId ??
      source.post_id ??
      source.postId ??
      source.market_item_id ??
      source.marketItemId
  ];
  for (const candidate of explicitIdCandidates) {
    const directIdRaw = extractText(candidate, "").trim();
    if (!directIdRaw) {
      continue;
    }
    const marketId = extractMarketListingIdFromText(directIdRaw, true);
    if (marketId) {
      return marketId;
    }
    if (!/[\/\s]/.test(directIdRaw) && /[a-z]/i.test(directIdRaw) && directIdRaw.length >= 6) {
      return directIdRaw;
    }
  }

  const urlCandidates = [
    extractText(source.url, ""),
    extractText(source.link, ""),
    extractText(source.href, ""),
    extractText(source.permalink, ""),
    extractText(source.item_url, ""),
    extractText(source.listing_url, ""),
    extractText(source.market_url, ""),
    extractText(source.image, ""),
    extractText(source.image_url, ""),
    extractText(source.imageUrl, ""),
    extractText(source.preview, ""),
    extractText(source.preview_url, "")
  ];

  for (const candidate of urlCandidates) {
    const marketId = extractMarketListingIdFromText(candidate, false);
    if (marketId) {
      return marketId;
    }
  }

  const genericIdRaw = extractText(source.id ?? source.uuid ?? source.slug, "").trim();
  if (genericIdRaw) {
    const marketId = extractMarketListingIdFromText(genericIdRaw, false);
    if (marketId) {
      return marketId;
    }
    if (
      !/^\d+$/.test(genericIdRaw) &&
      !/[\/\s]/.test(genericIdRaw) &&
      /[a-z]/i.test(genericIdRaw) &&
      genericIdRaw.length >= 6
    ) {
      return genericIdRaw;
    }
  }

  const deepMarketId = extractMarketListingIdDeep(source);
  if (deepMarketId) {
    return deepMarketId;
  }

  return `gen_${Buffer.from(fallbackIdSource).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 52)}`;
}

function mapRawListing(
  item: Record<string, unknown>,
  endpointGameHint = "",
  endpointCurrencyHint = ""
): MarketListing {
  const source = buildListingSource(item);
  const sourceCurrency = extractCurrency(source, endpointCurrencyHint);
  const rawBasePrice = resolveListingBasePrice(source);
  const basePrice = normalizePriceToUsd(rawBasePrice, sourceCurrency);
  const title = extractText(
    source.title_en ?? source.title ?? source.item_title ?? source.name ?? source.heading,
    "Untitled listing"
  );
  const imageUrl = extractImageUrl(source);
  let game = resolveGameLabel(source);
  if (
    endpointGameHint &&
    (isGenericCategory(game) || normalizeLabel(game) === "gaming" || normalizeLabel(game) === "social media")
  ) {
    game = endpointGameHint;
  }
  const category = resolveCategoryLabel(source, game);
  const specs = extractSpecs(source);
  const description = extractDescription(source) || buildDescriptionFallback(source, specs);
  const fallbackIdSource = [
    extractText(source.url ?? source.link ?? source.href ?? source.permalink, ""),
    extractText(source.slug ?? source.code ?? source.uuid, ""),
    extractText(source.post_id ?? source.thread_id ?? source.offer_id ?? source.listing_id, ""),
    title,
    String(basePrice || 0),
    imageUrl,
    description.slice(0, 180),
    JSON.stringify(source).slice(0, 1200)
  ]
    .join("|")
    .trim();
  const id = resolveListingId(source, fallbackIdSource);

  return {
    id,
    title,
    imageUrl,
    price: basePrice,
    basePrice,
    currency: "USD",
    game,
    category,
    description,
    specs
  };
}

function buildListingSource(item: Record<string, unknown>) {
  const nestedCandidates = [
    item.item,
    item.account,
    item.listing,
    item.data,
    item.result
  ];
  for (const candidate of nestedCandidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const nested = candidate as Record<string, unknown>;
      const inheritedKeys = [
        "id",
        "item_id",
        "listing_id",
        "post_id",
        "thread_id",
        "offer_id",
        "url",
        "link",
        "href",
        "permalink",
        "item_url",
        "listing_url",
        "market_url",
        "slug",
        "uuid",
        "code"
      ];
      const inherited: Record<string, unknown> = {};
      for (const key of inheritedKeys) {
        if (nested[key] != null) {
          continue;
        }
        if (item[key] != null) {
          inherited[key] = item[key];
        }
      }
      return {
        ...inherited,
        ...nested
      };
    }
  }
  return item;
}

function normalizeLabel(value: string) {
  return value.trim().toLowerCase();
}

function inferVertical(source: Record<string, unknown>) {
  const text = [
    extractText(source.game, ""),
    extractText(source.category, ""),
    extractText(source.category_name, ""),
    extractText(source.platform, ""),
    extractText(source.title, ""),
    extractText(source.description, "")
  ]
    .join(" ")
    .toLowerCase();

  const socialKeywords = [
    "instagram",
    "tiktok",
    "telegram",
    "discord",
    "youtube",
    "facebook",
    "twitter",
    "social",
    "snapchat",
    "x.com",
    "инстаграм",
    "тикток",
    "телеграм",
    "дискорд",
    "ютуб",
    "фейсбук",
    "твиттер",
    "соц",
    "снапчат"
  ];

  for (const keyword of socialKeywords) {
    if (text.includes(keyword)) {
      return "social";
    }
  }

  return "gaming";
}

function isGenericCategory(value: string) {
  const normalized = normalizeLabel(value);
  return (
    !normalized ||
    normalized === "account" ||
    normalized === "accounts" ||
    normalized === "game account" ||
    normalized === "listing" ||
    normalized === "item"
  );
}

function resolveGameLabel(source: Record<string, unknown>) {
  const raw = extractText(source.game ?? source.category_name ?? source.platform ?? source.category, "");
  if (!isGenericCategory(raw)) {
    return raw;
  }
  return inferVertical(source) === "social" ? "Social Media" : "Gaming";
}

function resolveCategoryLabel(source: Record<string, unknown>, game: string) {
  const raw = extractText(source.category ?? source.platform ?? source.category_name, "");
  if (!isGenericCategory(raw)) {
    return raw;
  }
  if (normalizeLabel(game) === "social media") {
    return "Social Account";
  }
  if (normalizeLabel(game) === "gaming") {
    return "Game Account";
  }
  return "Digital Account";
}

function normalizeImageUrl(value: string) {
  const raw = value.trim();
  if (!raw) {
    return "";
  }
  if (raw.startsWith("data:image/")) {
    return raw;
  }
  if (raw.startsWith("//")) {
    return `https:${raw}`;
  }
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.startsWith("http://") ? `https://${raw.slice(7)}` : raw;
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(raw)) {
    return `https://${raw}`;
  }
  if (raw.startsWith("/")) {
    if (/^\/\d+\/image(?:\?|$)/i.test(raw) || /^\/market\/\d+\/image(?:\?|$)/i.test(raw)) {
      return `https://lzt.market${raw}`;
    }
    return `${getLztBaseUrl()}${raw}`;
  }
  return "";
}

function isLikelyImageUrl(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.startsWith("data:image/")) {
    return true;
  }
  if (/\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?|#|$)/i.test(normalized)) {
    return true;
  }
  const likelyByPathHint = (
    normalized.includes("/image") ||
    normalized.includes("/images/") ||
    normalized.includes("/photo") ||
    normalized.includes("/thumb") ||
    normalized.includes("/preview") ||
    normalized.includes("/attachment") ||
    normalized.includes("nztcdn.com/files/")
  );
  if (likelyByPathHint) {
    return true;
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (host.includes("nztcdn.com") || host.includes("lztcdn.com")) {
      return true;
    }
    if (path.includes("/attachments/") || path.includes("/uploads/")) {
      return true;
    }
    if (
      (host.includes("cdn") || host.includes("img") || host.includes("image") || host.includes("media")) &&
      !/\.(html?|php|asp|aspx|jsp)$/i.test(path)
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function extractImageUrlFromPostText(value: unknown, depth = 0): string {
  if (depth > 3 || value == null) {
    return "";
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found: string = extractImageUrlFromPostText(entry, depth + 1);
      if (found) {
        return found;
      }
    }
    return "";
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const textKeys = [
      "message",
      "text",
      "text_html",
      "body",
      "content",
      "post",
      "first_post",
      "description",
      "description_html"
    ];
    for (const key of textKeys) {
      if (!(key in record)) {
        continue;
      }
      const found: string = extractImageUrlFromPostText(record[key], depth + 1);
      if (found) {
        return found;
      }
    }
    for (const entry of Object.values(record)) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const found: string = extractImageUrlFromPostText(entry, depth + 1);
      if (found) {
        return found;
      }
    }
    return "";
  }

  if (typeof value !== "string") {
    return "";
  }

  const text = value.trim();
  if (!text) {
    return "";
  }

  const bbCodeMatch = text.match(/\[img(?:=[^\]]*)?\]\s*([^\s\]]+)\s*\[\/img\]/i);
  if (bbCodeMatch?.[1]) {
    const normalized = normalizeImageUrl(bbCodeMatch[1]);
    if (normalized && isLikelyImageUrl(normalized)) {
      return normalized;
    }
  }

  const markdownMatch = text.match(/!\[[^\]]*]\(([^)\s]+)\)/i);
  if (markdownMatch?.[1]) {
    const normalized = normalizeImageUrl(markdownMatch[1]);
    if (normalized && isLikelyImageUrl(normalized)) {
      return normalized;
    }
  }

  const urlMatches = text.match(/(?:https?:\/\/|\/\/)[^\s"'<>)\]]+/gi) ?? [];
  for (const url of urlMatches) {
    const normalized = normalizeImageUrl(url);
    if (normalized && isLikelyImageUrl(normalized)) {
      return normalized;
    }
  }
  const bareUrlMatches =
    text.match(/\b(?:lzt\.market|lolz\.guru|lztcdn\.com|nztcdn\.com)\/[^\s"'<>)\]]+/gi) ?? [];
  for (const url of bareUrlMatches) {
    const normalized = normalizeImageUrl(url);
    if (normalized && isLikelyImageUrl(normalized)) {
      return normalized;
    }
  }

  return "";
}

function pickImageFromUnknown(value: unknown, permissive = false): string {
  if (typeof value === "string") {
    const normalized = normalizeImageUrl(value);
    if (!normalized) {
      return "";
    }
    if (isLikelyImageUrl(normalized)) {
      return normalized;
    }
    return permissive ? "" : "";
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = pickImageFromUnknown(entry, permissive);
      if (found) {
        return found;
      }
    }
    return "";
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const directKeys = [
    "url",
    "src",
    "image",
    "image_url",
    "imageUrl",
    "preview",
    "preview_url",
    "thumbnail",
    "thumbnail_url",
    "photo",
    "avatar",
    "cover",
    "original",
    "file",
    "path",
    "link"
  ];

  for (const key of directKeys) {
    if (key in record) {
      const found = pickImageFromUnknown(record[key], true);
      if (found) {
        return found;
      }
    }
  }

  for (const [key, entry] of Object.entries(record)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("avatar") ||
      lower.includes("seller") ||
      lower.includes("profile") ||
      lower.includes("user") ||
      lower.includes("logo")
    ) {
      continue;
    }
    if (
      lower.includes("image") ||
      lower.includes("img") ||
      lower.includes("photo") ||
      lower.includes("preview") ||
      lower.includes("cover") ||
      lower.includes("thumb") ||
      lower.includes("attachment") ||
      lower.includes("media") ||
      lower.includes("gallery")
    ) {
      const found = pickImageFromUnknown(entry, true);
      if (found) {
        return found;
      }
    }
  }

  for (const entry of Object.values(record)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const found = pickImageFromUnknown(entry, permissive);
    if (found) {
      return found;
    }
  }

  return "";
}

function extractImageUrl(item: Record<string, unknown>) {
  const directCandidates = [
    item.image,
    item.image_url,
    item.imageUrl,
    item.preview,
    item.preview_url,
    item.thumbnail,
    item.thumbnail_url,
    item.cover,
    item.cover_url,
    item.photo,
    item.img
  ];
  for (const candidate of directCandidates) {
    const found = pickImageFromUnknown(candidate);
    if (found) {
      return found;
    }
  }

  const arrayCandidates = [
    item.photos,
    item.images,
    item.media,
    item.gallery,
    item.attachments
  ];
  for (const candidate of arrayCandidates) {
    const found = pickImageFromUnknown(candidate);
    if (found) {
      return found;
    }
  }

  const objectCandidates = [
    item.first_post,
    item.firstPost,
    item.post,
    item.post_body,
    item.postBody,
    item.listing,
    item.item,
    item.account,
    item.result,
    item.data,
    item.offer,
    item.product
  ];
  for (const candidate of objectCandidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const found = pickImageFromUnknown(candidate);
    if (found) {
      return found;
    }
  }

  const postTextCandidates = [
    item.first_post,
    item.firstPost,
    item.post,
    item.post_body,
    item.postBody,
    item.first_post_message,
    item.firstPostMessage
  ];
  for (const candidate of postTextCandidates) {
    const found = extractImageUrlFromPostText(candidate);
    if (found) {
      return found;
    }
  }

  return DEFAULT_LISTING_IMAGE;
}

function collectStrings(value: unknown, target: string[], depth = 0) {
  if (depth > 4 || value == null) {
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      target.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStrings(entry, target, depth + 1);
    }
    return;
  }
  if (typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectStrings(entry, target, depth + 1);
    }
  }
}

function hasBlockedMarketplaceLink(item: Record<string, unknown>) {
  const texts: string[] = [];
  const candidates = [
    item.description,
    item.short_description,
    item.item_description,
    item.full_description,
    item.description_html,
    item.descriptionHtml,
    item.post,
    item.post_body,
    item.postBody,
    item.first_post,
    item.firstPost,
    item.content,
    item.body,
    item.message,
    item.text_html,
    item.text,
    item.about,
    item.note,
    item.params,
    item.parameters,
    item.attributes,
    item.props,
    item.characteristics,
    item.details,
    item.extra,
    item.fields
  ];
  for (const candidate of candidates) {
    collectStrings(candidate, texts);
  }

  return texts.some((text) => {
    const scrubbed = text.replace(ALLOWED_MARKET_IMAGE_LINK_PATTERN, " ");
    return BLOCKED_MARKET_LINK_PATTERN.test(scrubbed);
  });
}

function extractCurrency(item: Record<string, unknown>, supplierCurrencyHint = "") {
  const forced = supplierCurrencyHint.trim().toUpperCase();
  if (/^(RUB|RUR|USD|EUR|UAH|KZT|BYN|GBP|CNY|TRY|JPY|BRL)$/.test(forced)) {
    return forced === "RUR" ? "RUB" : forced;
  }
  const deepCurrencyRaw = findTextDeep(item, [
    "currency",
    "currency_code",
    "curr",
    "price_currency",
    "priceCurrency"
  ]);
  const currencyRaw = extractText(
    item.currency ?? item.currency_code ?? item.curr ?? deepCurrencyRaw,
    ""
  );
  const direct = currencyRaw.toLowerCase();
  if (direct.includes("₽") || direct === "rub" || direct.includes("rur")) {
    return "RUB";
  }
  if (direct.includes("$") || direct === "usd") {
    return "USD";
  }
  if (direct.includes("€") || direct === "eur") {
    return "EUR";
  }
  if (direct === "cny" || direct === "uah" || direct === "kzt" || direct === "byn" || direct === "gbp") {
    return currencyRaw.toUpperCase();
  }
  if (
    item.price_rub != null ||
    item.currency_rub != null ||
    item.priceRub != null ||
    item.rub_price != null
  ) {
    return "RUB";
  }

  const priceTextCandidates = [
    extractText(item.price, ""),
    extractText(item.amount, ""),
    extractText(item.currency_price, ""),
    extractText(item.price_rub, ""),
    extractText(item.currency_rub, ""),
    extractText(item.cost, "")
  ]
    .join(" ")
    .toLowerCase();

  if (
    priceTextCandidates.includes("₽") ||
    priceTextCandidates.includes(" rub") ||
    priceTextCandidates.includes("руб")
  ) {
    return "RUB";
  }
  if (priceTextCandidates.includes("$") || priceTextCandidates.includes(" usd")) {
    return "USD";
  }
  if (priceTextCandidates.includes("€") || priceTextCandidates.includes(" eur")) {
    return "EUR";
  }

  const resolvedBasePrice = resolveListingBasePrice(item);
  if (resolvedBasePrice >= 800) {
    return "RUB";
  }

  return "USD";
}

function cleanSpecText(value: string) {
  return stripHtml(value).replace(/\s+/g, " ").trim();
}

function buildSpec(label: string, value: string): MarketListingSpec | null {
  const cleanLabel = cleanSpecText(label).replace(/[:\-\s]+$/, "");
  const cleanValue = cleanSpecText(value);
  if (!cleanValue) {
    return null;
  }

  const normalizedLabel = cleanLabel || "Detail";
  const blockedLabels = new Set(["description", "text", "message", "note"]);
  if (blockedLabels.has(normalizedLabel.toLowerCase())) {
    return null;
  }
  const normalizedLabelLower = normalizedLabel.toLowerCase();
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const uuidMatches = cleanValue.match(uuidPattern) ?? [];
  const isUuidArrayLike =
    cleanValue.startsWith("[") &&
    cleanValue.endsWith("]") &&
    uuidMatches.length >= 2 &&
    cleanValue.includes(",") &&
    cleanValue.includes('"');
  const likelyCosmeticIdDump =
    normalizedLabelLower.includes("skin") ||
    normalizedLabelLower.includes("outfit") ||
    normalizedLabelLower.includes("operator") ||
    normalizedLabelLower.includes("r6");
  if (isUuidArrayLike && likelyCosmeticIdDump) {
    return null;
  }

  return {
    label: normalizedLabel.slice(0, 72),
    value: cleanValue.slice(0, 260)
  };
}

function parseInlineSpec(value: string): MarketListingSpec | null {
  const text = cleanSpecText(value);
  if (!text) {
    return null;
  }
  const parts = text.split(":");
  if (parts.length < 2) {
    return null;
  }
  const label = parts.shift() ?? "";
  const rest = parts.join(":");
  return buildSpec(label, rest);
}

function pushSpec(target: MarketListingSpec[], spec: MarketListingSpec | null) {
  if (!spec) {
    return;
  }
  const key = `${spec.label.toLowerCase()}::${spec.value.toLowerCase()}`;
  const exists = target.some(
    (entry) => `${entry.label.toLowerCase()}::${entry.value.toLowerCase()}` === key
  );
  if (!exists) {
    target.push(spec);
  }
}

const FORTNITE_SELECTOR_HINTS = [
  "outfit",
  "skin",
  "pickaxe",
  "harvest",
  "axe",
  "emote",
  "dance",
  "glider",
  "cosmetic",
  "locker",
  "скин",
  "облик",
  "кирк",
  "эмоц",
  "танц",
  "глайдер",
  "дельтаплан"
];

function collectNestedSelectorSpecs(
  source: unknown,
  output: MarketListingSpec[],
  path: string[] = [],
  depth = 0
) {
  if (source == null || depth > 5 || output.length >= 1200) {
    return;
  }

  if (Array.isArray(source)) {
    for (const entry of source.slice(0, 1200)) {
      collectNestedSelectorSpecs(entry, output, path, depth + 1);
      if (output.length >= 1200) {
        break;
      }
    }
    return;
  }

  if (typeof source === "object") {
    const record = source as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (value == null) {
        continue;
      }
      collectNestedSelectorSpecs(
        value,
        output,
        [...path, key.replace(/_/g, " ").trim()],
        depth + 1
      );
      if (output.length >= 1200) {
        break;
      }
    }
    return;
  }

  const text = extractText(source, "");
  if (!text) {
    return;
  }
  const normalizedPath = path.join(" ").toLowerCase();
  if (!normalizedPath) {
    return;
  }
  const hasSelectorHint = FORTNITE_SELECTOR_HINTS.some((hint) => normalizedPath.includes(hint));
  if (!hasSelectorHint) {
    return;
  }
  const label = path[path.length - 1] || "detail";
  pushSpec(output, buildSpec(label, text));
}

function extractSpecsFromObject(source: Record<string, unknown>, output: MarketListingSpec[]) {
  const label = extractText(
    source.title ?? source.name ?? source.label ?? source.key ?? source.param,
    ""
  );
  const value = extractText(
    source.value ??
      source.text ??
      source.description ??
      source.display_value ??
      source.displayValue ??
      source.val ??
      source.amount,
    ""
  );

  if (label || value) {
    if (!label && value.includes(":")) {
      pushSpec(output, parseInlineSpec(value));
    } else {
      pushSpec(output, buildSpec(label, value));
    }
    return;
  }

  collectNestedSelectorSpecs(source, output);

  for (const [key, raw] of Object.entries(source)) {
    if (raw == null || typeof raw === "object") {
      continue;
    }
    const text = extractText(raw, "");
    if (!text) {
      continue;
    }
    pushSpec(output, buildSpec(key, text));
  }
}

function extractSpecs(item: Record<string, unknown>) {
  const specs: MarketListingSpec[] = [];

  const candidates = [
    item.params,
    item.parameters,
    item.attributes,
    item.props,
    item.characteristics,
    item.details,
    item.extra,
    item.fields,
    item.features,
    item.fortniteSkins,
    item.fortniteOutfits,
    item.fortnitePickaxes,
    item.fortniteDances,
    item.fortniteEmotes,
    item.fortniteGliders
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          extractSpecsFromObject(entry as Record<string, unknown>, specs);
        } else {
          const raw = extractText(entry, "");
          if (raw) {
            pushSpec(specs, parseInlineSpec(raw));
          }
        }
      }
      continue;
    }

    if (typeof candidate === "object") {
      extractSpecsFromObject(candidate as Record<string, unknown>, specs);
      const record = candidate as Record<string, unknown>;
      for (const [key, value] of Object.entries(record)) {
        if (value == null || typeof value === "object") {
          continue;
        }
        const text = extractText(value, "");
        if (!text) {
          continue;
        }
        pushSpec(specs, buildSpec(key, text));
      }
    }
  }

  const directSpecKeys = [
    "rank",
    "level",
    "agents",
    "gun_buddies",
    "gunbuddies",
    "buddies",
    "skins",
    "inventory",
    "wins",
    "hours",
    "followers",
    "friends",
    "fortnite_skin_count",
    "fortnite_pickaxe_count",
    "fortnite_dance_count",
    "fortnite_emote_count",
    "fortnite_glider_count",
    "fortnite_paid_skin_count",
    "fortnite_paid_pickaxe_count",
    "fortnite_paid_emote_count",
    "fortnite_paid_glider_count"
  ];

  for (const key of directSpecKeys) {
    if (!(key in item)) {
      continue;
    }
    const value = extractText(item[key], "");
    if (!value) {
      continue;
    }
    pushSpec(specs, buildSpec(key.replace(/_/g, " "), value));
  }

  const metricKeyMatchers = [
    "skin",
    "outfit",
    "pickaxe",
    "axe",
    "harvest",
    "emote",
    "dance",
    "glider",
    "скин",
    "облик",
    "кирк",
    "эмоц",
    "танц",
    "глайдер",
    "дельтаплан"
  ];
  const metricKeyBlockers = [
    "price",
    "cost",
    "value",
    "vbucks",
    "v_bucks",
    "v-bucks",
    "usd",
    "eur",
    "rub",
    "currency"
  ];

  for (const [key, rawValue] of Object.entries(item)) {
    const normalizedKey = key.toLowerCase();
    if (!metricKeyMatchers.some((entry) => normalizedKey.includes(entry))) {
      continue;
    }
    if (metricKeyBlockers.some((entry) => normalizedKey.includes(entry))) {
      continue;
    }
    if (rawValue == null || typeof rawValue === "object") {
      continue;
    }
    const text = extractText(rawValue, "");
    if (!text) {
      continue;
    }
    if (!/\d/.test(text)) {
      continue;
    }
    pushSpec(specs, buildSpec(key.replace(/_/g, " "), text));
  }

  return specs.slice(0, 1200);
}

function toReadableDate(value: unknown) {
  const numeric = extractNumber(value);
  if (!numeric || numeric <= 0) {
    return "";
  }

  const timestamp = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function buildDescriptionFallback(
  item: Record<string, unknown>,
  specs: MarketListingSpec[]
) {
  const facts: string[] = [];
  const candidates: Array<[string, unknown]> = [
    ["Skins", item.fortnite_skin_count ?? item.skin_count ?? item.skins],
    ["Level", item.fortnite_level ?? item.level],
    ["Wins", item.fortnite_lifetime_wins ?? item.wins],
    ["Pickaxes", item.fortnite_pickaxe_count],
    ["Emotes", item.fortnite_dance_count ?? item.emote_count],
    ["Agents", item.valorant_agents_count ?? item.agents],
    ["Gun Buddies", item.valorant_gun_buddies_count ?? item.gun_buddies],
    ["Hours", item.hours],
    ["Followers", item.followers]
  ];

  for (const [label, rawValue] of candidates) {
    const value = extractText(rawValue, "");
    if (!value) {
      continue;
    }
    facts.push(`${label}: ${value}`);
  }

  const lastActivity = toReadableDate(item.fortnite_last_activity ?? item.last_activity);
  if (lastActivity) {
    facts.push(`Last Activity: ${lastActivity}`);
  }

  if (facts.length > 0) {
    return facts.slice(0, 5).join(" | ").slice(0, 320);
  }

  if (specs.length > 0) {
    return specs
      .slice(0, 4)
      .map((spec) => `${spec.label}: ${spec.value}`)
      .join(" | ")
      .slice(0, 320);
  }

  return "Account details available in listing";
}

function extractDescription(item: Record<string, unknown>) {
  const direct = extractText(
    item.description_en ??
      item.description ??
      item.short_description ??
      item.item_description ??
      item.full_description ??
      item.description_html ??
      item.descriptionHtml ??
      item.message_html ??
      item.post ??
      item.post_body ??
      item.postBody ??
      item.first_post ??
      item.firstPost ??
      item.first_post_message ??
      item.firstPostMessage ??
      item.body ??
      item.content ??
      item.message ??
      item.text_html ??
      item.text ??
      item.about ??
      item.note,
    ""
  );
  if (direct) {
    return stripHtml(direct);
  }

  const attributeCandidates = [
    item.params,
    item.parameters,
    item.attributes,
    item.props,
    item.characteristics,
    item.details,
    item.extra,
    item.fields
  ];

  for (const candidate of attributeCandidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      const lines: string[] = [];
      for (const entry of candidate.slice(0, 6)) {
        if (entry && typeof entry === "object") {
          const record = entry as Record<string, unknown>;
          const key = extractText(record.title ?? record.name ?? record.label, "");
          const value = extractText(record.value ?? record.text ?? record.description, "");
          if (key && value) {
            lines.push(`${key}: ${value}`);
          } else if (value) {
            lines.push(value);
          } else if (key) {
            lines.push(key);
          }
        } else {
          const value = extractText(entry, "");
          if (value) {
            lines.push(value);
          }
        }
      }
      if (lines.length > 0) {
        return lines.join(" | ");
      }
    }
  }

  const deep = findTextDeep(item, [
    "description",
    "full_description",
    "item_description",
    "description_html",
    "post",
    "content",
    "body",
    "about",
    "note",
    "text",
    "message",
    "first_post"
  ]);
  if (deep) {
    return stripHtml(deep);
  }

  return "";
}

function stripHtml(value: string) {
  return value
    .replace(/\[img(?:=[^\]]*)?\][\s\S]*?\[\/img\]/gi, " ")
    .replace(/\[url(?:=[^\]]*)?\]([\s\S]*?)\[\/url\]/gi, "$1")
    .replace(/\[[a-z*\/][^\]]*]/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/:[a-z0-9_+-]+:/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveSupplierSort(sort: SearchSort | undefined) {
  if (sort === "price_asc") {
    return "price_to_up";
  }
  if (sort === "price_desc") {
    return "price_to_down";
  }
  if (sort === "newest") {
    return "pdate_to_down";
  }
  return "pdate_to_down";
}

function resolveScopedCategoryId(options: SearchOptions) {
  const slug = toSlug(options.category ?? options.game ?? "");
  const categoryIdsBySlug: Record<string, number> = {
    steam: 1,
    ea: 3,
    battlenet: 11,
    epicgames: 12,
    riot: 13,
    supercell: 15,
    tiktok: 20,
    discord: 22,
    telegram: 24,
    roblox: 31,
    fortnite: 9,
    valorant: 13,
    siege: 5,
    uplay: 5,
    "rainbow-six-siege": 5,
    instagram: 10,
    cs2: 1
  };
  return categoryIdsBySlug[slug] ?? null;
}

function buildSearchUrl(endpoint: string, query: string, options: SearchOptions) {
  const url = new URL(normalizeEndpoint(endpoint));
  const endpointSegments = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const isPathScopedEndpoint = endpointSegments.length > 0;
  const normalizedQuery = query.trim();
  const supplierFilters = options.supplierFilters ?? {};
  const hasFortniteSelectorFilters = [
    "fortnite_outfits",
    "fortnite_pickaxes",
    "fortnite_emotes",
    "fortnite_gliders"
  ].some((key) => String(supplierFilters[key] ?? "").trim().length > 0);
  const useNativeFortniteSelectorParams =
    hasFortniteSelectorFilters && !Boolean(options.disableNativeFortniteSelectorParams);
  const scopeText = `${options.game ?? ""} ${options.category ?? ""}`.toLowerCase();
  const isFortniteScope = scopeText.includes("fortnite");
  const localOnlySupplierKeys = new Set([
    "ma",
    "online",
    "vac",
    "first_owner",
    "fortnite_outfits",
    "fortnite_pickaxes",
    "fortnite_emotes",
    "fortnite_gliders",
    "fortnite_skin_count_min",
    "fortnite_skin_count_max",
    "fortnite_pickaxe_count_min",
    "fortnite_pickaxe_count_max",
    "fortnite_emote_count_min",
    "fortnite_emote_count_max",
    "fortnite_glider_count_min",
    "fortnite_glider_count_max",
    "fortnite_level_min",
    "fortnite_level_max",
    "fortnite_vbucks_min",
    "fortnite_vbucks_max",
    "media_followers_min",
    "media_verified",
    "media_platform"
  ]);
  const appendMultiValueParam = (rawValue: string | undefined, targetKey: string) => {
    const values = (rawValue ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const value of values) {
      url.searchParams.append(`${targetKey}[]`, value);
    }
  };
  const appendNumericParam = (rawValue: string | undefined, targetKey: string) => {
    const value = Number(rawValue ?? NaN);
    if (Number.isFinite(value) && value >= 0) {
      url.searchParams.set(targetKey, String(Math.trunc(value)));
    }
  };
  if (normalizedQuery) {
    url.searchParams.set("title", normalizedQuery);
    url.searchParams.set("q", normalizedQuery);
    url.searchParams.set("query", normalizedQuery);
    url.searchParams.set("search", normalizedQuery);
  }
  // For Fortnite selector filters:
  // - Keep newest mode for relevance/newest.
  // - For explicit price sorting, request supplier-side price order to avoid
  //   returning a tiny non-cheapest subset.
  const supplierOrderBy =
    useNativeFortniteSelectorParams &&
    options.sort !== "price_asc" &&
    options.sort !== "price_desc"
      ? "pdate_to_down"
      : resolveSupplierSort(options.sort);
  url.searchParams.set("order_by", supplierOrderBy);
  const page = Number.isFinite(options.page ?? NaN) ? Math.max(1, Number(options.page)) : 1;
  const pageSize = Number.isFinite(options.pageSize ?? NaN)
    ? Math.min(60, Math.max(1, Number(options.pageSize)))
    : 15;
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(pageSize));
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("count", String(pageSize));
  if (/^(rub|usd|eur|uah|kzt|byn|gbp|cny|try|jpy|brl)$/.test(SUPPLIER_CURRENCY)) {
    url.searchParams.set("currency", SUPPLIER_CURRENCY);
  }
  const toSupplierCurrencyPrice = (usdPrice: number) => {
    if (!(usdPrice > 0)) {
      return 0;
    }
    const currency = SUPPLIER_CURRENCY.toUpperCase();
    if (currency === "RUB" || currency === "RUR") {
      const rate = Number.isFinite(RUB_TO_USD_RATE) && RUB_TO_USD_RATE > 0 ? RUB_TO_USD_RATE : 0.013;
      return Math.round((usdPrice / rate) * 100) / 100;
    }
    if (currency === "EUR") {
      const rate = Number.isFinite(EUR_TO_USD_RATE) && EUR_TO_USD_RATE > 0 ? EUR_TO_USD_RATE : 1.08;
      return Math.round((usdPrice / rate) * 100) / 100;
    }
    return Math.round(usdPrice * 100) / 100;
  };

  const shouldUseSupplierPriceParams = !(normalizedQuery && isFortniteScope);
  if (shouldUseSupplierPriceParams) {
    if (Number.isFinite(options.minPrice ?? NaN)) {
      const min = toSupplierCurrencyPrice(Number(options.minPrice));
      if (min > 0) {
        url.searchParams.set("price_from", String(min));
        url.searchParams.set("pmin", String(min));
      }
    }
    if (Number.isFinite(options.maxPrice ?? NaN)) {
      const max = toSupplierCurrencyPrice(Number(options.maxPrice));
      if (max > 0) {
        url.searchParams.set("price_to", String(max));
        url.searchParams.set("pmax", String(max));
      }
    }
  }

  const scopedCategoryId = resolveScopedCategoryId(options);
  if (scopedCategoryId && !isPathScopedEndpoint && !url.searchParams.has("category_id")) {
    url.searchParams.set("category_id", String(scopedCategoryId));
  }

  if (!options.disableNativeFortniteSelectorParams && ENABLE_NATIVE_FORTNITE_SELECTOR_PARAMS) {
    // Native LZT Fortnite filters (per docs) for accurate + faster matching.
    appendMultiValueParam(supplierFilters.fortnite_outfits, "skin");
    appendMultiValueParam(supplierFilters.fortnite_pickaxes, "pickaxe");
    appendMultiValueParam(supplierFilters.fortnite_emotes, "dance");
    appendMultiValueParam(supplierFilters.fortnite_gliders, "glider");
    appendNumericParam(supplierFilters.fortnite_skin_count_min, "smin");
    appendNumericParam(supplierFilters.fortnite_skin_count_max, "smax");
    appendNumericParam(supplierFilters.fortnite_pickaxe_count_min, "pickaxe_min");
    appendNumericParam(supplierFilters.fortnite_pickaxe_count_max, "pickaxe_max");
    appendNumericParam(supplierFilters.fortnite_emote_count_min, "dmin");
    appendNumericParam(supplierFilters.fortnite_emote_count_max, "dmax");
    appendNumericParam(supplierFilters.fortnite_glider_count_min, "gmin");
    appendNumericParam(supplierFilters.fortnite_glider_count_max, "gmax");
    appendNumericParam(supplierFilters.fortnite_level_min, "lmin");
    appendNumericParam(supplierFilters.fortnite_level_max, "lmax");
    appendNumericParam(supplierFilters.fortnite_vbucks_min, "vbmin");
    appendNumericParam(supplierFilters.fortnite_vbucks_max, "vbmax");
  }

  if (options.supplierFilters) {
    for (const [key, value] of Object.entries(options.supplierFilters)) {
      const normalizedKey = key.trim();
      const normalizedValue = value.trim();
      if (!normalizedKey || !normalizedValue) {
        continue;
      }
      if (
        localOnlySupplierKeys.has(normalizedKey)
      ) {
        continue;
      }
      url.searchParams.set(normalizedKey, normalizedValue);
    }
  }

  return url.toString();
}

async function fetchListingsFromEndpoint(input: {
  endpoint: string;
  token: string;
  query: string;
  options: SearchOptions;
}) {
  const endpointGameHint = inferEndpointGameHint(input.endpoint);
  const response = await fetch(buildSearchUrl(input.endpoint, input.query, input.options), {
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: "application/json"
    },
    cache: "no-store",
    signal: AbortSignal.timeout(SUPPLIER_FETCH_TIMEOUT_MS)
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("LZT_AUTH_FAILED");
  }
  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as unknown;
  return extractItems(data)
    .map((entry) =>
      mapRawListing(entry, endpointGameHint, SUPPLIER_CURRENCY.toUpperCase())
    )
    .filter(
      (listing) =>
        Boolean(listing.id) &&
        listing.basePrice > 0
    );
}

async function fetchListingDetailFromApi(listingId: string, token: string) {
  const endpoint = getItemEndpointBase().replace(/\/+$/, "");
  const encodedId = encodeURIComponent(listingId);
  const detailUrls = endpoint.includes("{item_id}")
    ? [endpoint.replace("{item_id}", encodedId)]
    : Array.from(
        new Set([
          `${endpoint}/${encodedId}`,
          `${endpoint}/item/${encodedId}`,
          `${endpoint}/items/${encodedId}`,
          `${endpoint}/market/${encodedId}`
        ])
      );

  try {
    for (const url of detailUrls) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        },
        cache: "no-store"
      });
      if (!response.ok) {
        continue;
      }

      const raw = (await response.json()) as Record<string, unknown>;
      const fromArray = extractItems(raw);
      const source = fromArray[0]
        ? {
            ...raw,
            ...fromArray[0]
          }
        : raw;
      const mapped = mapRawListing(
        source,
        inferEndpointGameHint(url),
        SUPPLIER_CURRENCY.toUpperCase()
      );
      if (!mapped.id) {
        mapped.id = listingId;
      }
      return mapped;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function toSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const QUERY_INTENT_ALIASES: Record<string, string[]> = {
  fortnite: [
    "fortnite",
    "fortntie",
    "fornite",
    "fortinte",
    "forntite",
    "fort nit",
    "fort-nite",
    "vbucks",
    "v-bucks",
    "epic games",
    "epicgames",
    "galaxy",
    "galaxy scout",
    "galaxy grappler",
    "skull trooper",
    "ghoul trooper",
    "renegade raider",
    "black knight",
    "aerial assault trooper",
    "ikonik",
    "glow",
    "mako",
    "travis scott",
    "leviathan axe",
    "take the l"
  ],
  valorant: ["valorant", "riot", "riot client"],
  siege: ["siege", "rainbow six", "rainbow-six-siege", "r6"],
  roblox: ["roblox", "rbx", "limited", "korblox", "headless"],
  supercell: [
    "supercell",
    "brawl stars",
    "brawlstars",
    "clash of clans",
    "clashofclans",
    "clash royale",
    "clashroyale",
    "hay day",
    "hayday",
    "squad busters"
  ],
  steam: ["steam", "valve"],
  cs2: ["cs2", "counter strike", "counter-strike", "csgo"],
  battlenet: ["battlenet", "battle net", "battle.net", "blizzard"],
  telegram: ["telegram", "tg"],
  discord: ["discord", "nitro"],
  media: ["social media", "social account", "instagram", "tiktok", "youtube", "facebook"]
};

function normalizeIntentToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function hasSmallEditDistance(source: string, target: string, maxDistance: number) {
  if (!source || !target) {
    return false;
  }
  if (Math.abs(source.length - target.length) > maxDistance) {
    return false;
  }

  const rows = source.length + 1;
  const cols = target.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    matrix[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (let col = 1; col < cols; col += 1) {
      const cost = source[row - 1] === target[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost
      );
      rowMin = Math.min(rowMin, matrix[row][col]);
    }
    if (rowMin > maxDistance) {
      return false;
    }
  }

  return matrix[source.length][target.length] <= maxDistance;
}

function detectQueryIntent(query: string) {
  const normalized = query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  const tokens = normalized.split(" ").filter((token) => token.length >= 2);
  const compact = normalizeIntentToken(normalized);
  const priorities = [
    "fortnite",
    "valorant",
    "siege",
    "roblox",
    "supercell",
    "cs2",
    "steam",
    "battlenet",
    "telegram",
    "discord",
    "media"
  ];

  for (const canonical of priorities) {
    const aliases = Array.from(
      new Set([canonical, ...(QUERY_INTENT_ALIASES[canonical] ?? [])].map(normalizeIntentToken))
    ).filter(Boolean);

    for (const alias of aliases) {
      if (alias.length >= 3 && compact.includes(alias)) {
        return canonical;
      }
      for (const token of tokens) {
        const tokenCompact = normalizeIntentToken(token);
        if (!tokenCompact) {
          continue;
        }
        if (tokenCompact === alias) {
          return canonical;
        }
        if (
          tokenCompact.length >= 5 &&
          alias.length >= 5 &&
          (tokenCompact.includes(alias) || alias.includes(tokenCompact))
        ) {
          return canonical;
        }
        if (
          tokenCompact.length >= 6 &&
          alias.length >= 6 &&
          hasSmallEditDistance(tokenCompact, alias, 2)
        ) {
          return canonical;
        }
      }
    }
  }

  return "";
}

function buildCategoryEndpoints(baseEndpoint: string, options: SearchOptions) {
  const custom = (process.env.LZT_CATEGORY_ENDPOINTS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const defaults = [
    "steam",
    "fortnite",
    "rainbow-six-siege",
    "mihoyo",
    "riot",
    "telegram",
    "supercell",
    "ea",
    "world-of-tanks",
    "wot-blitz",
    "epicgames",
    "gifts",
    "minecraft",
    "escape-from-tarkov",
    "socialclub",
    "uplay",
    "discord",
    "tiktok",
    "instagram",
    "facebook",
    "twitter",
    "youtube",
    "chatgpt",
    "battlenet",
    "vpn",
    "roblox",
    "warface",
    "hytale"
  ];

  const categories = custom.length > 0 ? custom : defaults;
  const requestedCategory = options.category ? toSlug(options.category) : "";
  const requestedGame = options.game ? toSlug(options.game) : "";
  const requested = requestedCategory || requestedGame;
  const strictScopedCategorySlugMap: Record<string, string[]> = {
    fortnite: ["fortnite"],
    valorant: ["riot"],
    riot: ["riot"],
    siege: ["rainbow-six-siege", "uplay"],
    "rainbow-six-siege": ["rainbow-six-siege", "uplay"],
    uplay: ["uplay", "rainbow-six-siege"],
    roblox: ["roblox"],
    supercell: ["supercell"],
    tiktok: ["tiktok"],
    instagram: ["instagram"],
    telegram: ["telegram"],
    discord: ["discord"],
    steam: ["steam"],
    cs2: ["steam"],
    battlenet: ["battlenet"],
    epicgames: ["epicgames"],
    ea: ["ea"]
  };
  const requestedAliases: Record<string, string[]> = {
    fortnite: ["fortnite"],
    valorant: ["valorant", "riot"],
    siege: ["siege", "rainbow-six-siege", "rainbow6", "r6", "uplay", "ubisoft"],
    uplay: ["siege", "rainbow-six-siege", "rainbow6", "r6", "uplay", "ubisoft"],
    "rainbow-six-siege": ["siege", "rainbow-six-siege", "rainbow6", "r6", "uplay", "ubisoft"],
    roblox: ["roblox", "rbx", "limited", "korblox", "headless"],
    supercell: [
      "supercell",
      "brawl-stars",
      "brawlstars",
      "clash-of-clans",
      "clashofclans",
      "clash-royale",
      "clashroyale",
      "hay-day",
      "hayday",
      "squad-busters"
    ],
    steam: ["steam", "cs2", "counter-strike", "counter-strike-2"],
    cs2: ["cs2", "steam", "counter-strike", "counter-strike-2", "csgo"],
    battlenet: ["battlenet", "battle-net", "blizzard"],
    media: [
      "instagram",
      "tiktok",
      "telegram",
      "discord",
      "facebook",
      "twitter",
      "youtube",
      "snapchat"
    ],
    social: [
      "instagram",
      "tiktok",
      "telegram",
      "discord",
      "facebook",
      "twitter",
      "youtube",
      "snapchat"
    ]
  };
  const requestedTokens =
    requested.length > 0
      ? Array.from(new Set([requested, ...(requestedAliases[requested] ?? [])]))
      : [];
  const root = normalizeEndpoint(baseEndpoint);

  // Strict scoped mode: when a category/game is selected, use its dedicated endpoint path
  // (same shape as direct LZT category pages like /roblox, /fortnite, /tiktok, ...).
  if (requested.length > 0) {
    const strictSlugs = strictScopedCategorySlugMap[requested] ?? [requested];
    const strictTargets = strictSlugs.map((slug) => {
      const preferred = categories.find((item) => toSlug(item) === slug) ?? slug;
      return preferred.startsWith("http://") || preferred.startsWith("https://")
        ? preferred
        : `${root}${preferred}`;
    });
    return Array.from(new Set([...strictTargets, root]));
  }

  const narrowedCategories =
    requested.length > 0
      ? categories.filter((item) => {
          const slug = toSlug(item);
          if (!slug) {
            return false;
          }
          if (
            requestedTokens.some(
              (token) => slug === token || slug.includes(token) || token.includes(slug)
            )
          ) {
            return true;
          }
          return false;
        })
      : categories;

  const selectedCategories =
    requested.length > 0
      ? narrowedCategories.length > 0
        ? narrowedCategories
        : requestedTokens
      : categories;

  return Array.from(
    new Set(
      selectedCategories.map((category) =>
        category.startsWith("http://") || category.startsWith("https://")
          ? category
          : `${root}${category}`
      )
    )
  );
}

function mergeUnique(listings: MarketListing[]) {
  const byId = new Map<string, MarketListing>();
  for (const listing of listings) {
    const normalizedId = listing.id.trim().toLowerCase();
    if (!normalizedId) {
      continue;
    }
    if (!byId.has(normalizedId)) {
      byId.set(normalizedId, listing);
    }
  }
  return Array.from(byId.values());
}

function normalizeMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function hasRealDescription(value: string) {
  const text = value.trim();
  return text.length >= 12;
}

function hasRealImage(url: string) {
  const normalizedSource = normalizeImageUrl(url);
  const normalized = normalizedSource.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    normalized === "/logo.png" ||
    normalized === "/listing-placeholder.svg" ||
    normalized.includes("images.unsplash.com")
  ) {
    return false;
  }
  return isLikelyImageUrl(normalizedSource);
}

const IMAGE_KEYWORD_STOPWORDS = new Set([
  "account",
  "accounts",
  "acc",
  "game",
  "games",
  "gaming",
  "item",
  "items",
  "digital",
  "offer",
  "listing",
  "service",
  "with",
  "without",
  "the",
  "and",
  "for",
  "from",
  "your",
  "this",
  "that",
  "steam",
  "fortnite",
  "valorant",
  "social",
  "media",
  "bundle",
  "premium",
  "ranked",
  "rank",
  "skins",
  "skin"
]);

function normalizeKeywordText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeImageKeywords(value: string) {
  return normalizeKeywordText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 3 &&
        !IMAGE_KEYWORD_STOPWORDS.has(token) &&
        !/^\d+$/.test(token)
    );
}

function listingImageKeywords(listing: MarketListing) {
  const text = `${listing.title} ${listing.game} ${listing.category} ${listing.specs
    .map((spec) => `${spec.label} ${spec.value}`)
    .join(" ")}`;
  return Array.from(new Set(tokenizeImageKeywords(text))).slice(0, 30);
}

function applySharedImageFallback(listings: MarketListing[], queryTerm: string) {
  if (listings.length <= 1) {
    return listings;
  }

  const tokenToImages = new Map<string, string[]>();
  const queryTokenSet = new Set(tokenizeImageKeywords(queryTerm));

  for (const listing of listings) {
    if (!hasRealImage(listing.imageUrl)) {
      continue;
    }

    const image = normalizeImageUrl(listing.imageUrl);
    if (!image) {
      continue;
    }

    for (const token of listingImageKeywords(listing)) {
      const bucket = tokenToImages.get(token) ?? [];
      if (!bucket.includes(image)) {
        bucket.push(image);
      }
      tokenToImages.set(token, bucket.slice(0, 6));
    }
  }

  return listings.map((listing) => {
    if (hasRealImage(listing.imageUrl)) {
      return listing;
    }
    if (isFortniteListing(listing)) {
      return listing;
    }

    const scores = new Map<string, number>();
    for (const token of listingImageKeywords(listing)) {
      const images = tokenToImages.get(token);
      if (!images || images.length === 0) {
        continue;
      }
      const weight = queryTokenSet.has(token) ? 3 : 1;
      for (const image of images) {
        scores.set(image, (scores.get(image) ?? 0) + weight);
      }
    }

    let bestImage = "";
    let bestScore = 0;
    for (const [image, score] of scores) {
      if (score > bestScore) {
        bestImage = image;
        bestScore = score;
      }
    }

    if (bestImage && bestScore >= 2) {
      return {
        ...listing,
        imageUrl: bestImage
      };
    }

    return listing;
  });
}

function mergeListing(base: MarketListing, detail: MarketListing | null) {
  if (!detail) {
    return base;
  }

  return {
    ...base,
    title:
      base.title.toLowerCase() === "untitled listing" && detail.title
        ? detail.title
        : base.title,
    imageUrl: hasRealImage(detail.imageUrl) ? detail.imageUrl : base.imageUrl,
    description: hasRealDescription(detail.description)
      ? detail.description
      : base.description,
    specs: detail.specs.length > 0 ? detail.specs : base.specs,
    game: detail.game || base.game,
    category: detail.category || base.category,
    currency: detail.currency || base.currency,
    basePrice: base.basePrice,
    price: base.price
  };
}

function isFortniteApiImageUrl(url: string) {
  const normalized = normalizeImageUrl(url);
  if (!normalized) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    return parsed.hostname.toLowerCase().includes("fortnite-api.com");
  } catch {
    return false;
  }
}

function withFortniteImageDiversity(listings: MarketListing[]) {
  const usage = new Map<string, number>();
  return listings.map((listing) => {
    const image = normalizeImageUrl(listing.imageUrl);
    if (!image || !isFortniteApiImageUrl(image)) {
      return listing;
    }
    const count = usage.get(image) ?? 0;
    usage.set(image, count + 1);
    if (count === 0) {
      return listing;
    }
    const numericId = String(listing.id ?? "").trim();
    if (/^\d{5,}$/.test(numericId)) {
      return {
        ...listing,
        imageUrl: `https://lzt.market/${numericId}/image?type=skins`
      };
    }
    return {
      ...listing,
      imageUrl: DEFAULT_LISTING_IMAGE
    };
  });
}

async function enrichListingsWithDetails(
  listings: MarketListing[],
  token: string,
  maxEnrichment = 24,
  forceEnrichAll = false
) {
  const output = listings.slice();
  const candidates = forceEnrichAll
    ? output.slice(0, maxEnrichment)
    : output
        .slice(0, maxEnrichment)
        .filter(
          (listing) =>
            !hasRealDescription(listing.description) || !hasRealImage(listing.imageUrl)
        );

  if (candidates.length === 0) {
    return output;
  }

  const detailStates = await Promise.all(
    candidates.map(async (listing) => {
      try {
        const detail = await fetchListingDetailFromApi(listing.id, token);
        return {
          id: listing.id,
          detail
        };
      } catch (error) {
        return {
          id: listing.id,
          detail: null
        };
      }
    })
  );

  const detailById = new Map<string, MarketListing>();
  for (const state of detailStates) {
    if (state.detail?.id) {
      detailById.set(state.detail.id, state.detail);
    }
  }

  return output.map((listing) => mergeListing(listing, detailById.get(listing.id) ?? null));
}

function applyLocalFilters(
  listings: MarketListing[],
  options: SearchOptions,
  queryTerm: string,
  phase: "pre" | "final" = "pre"
) {
  let output = listings.slice();
  const selectedGameFilter = options.game?.trim().toLowerCase() ?? "";
  const selectedCategoryFilter = options.category?.trim().toLowerCase() ?? "";
  const inferredQueryGameFilter =
    !selectedGameFilter && !selectedCategoryFilter ? detectQueryIntent(queryTerm) : "";
  const hasExplicitScope = Boolean(selectedGameFilter || selectedCategoryFilter);
  const trustSupplierScopedEndpoint = hasExplicitScope;
  const gameFilter = selectedGameFilter || inferredQueryGameFilter;
  const categoryFilter = selectedCategoryFilter;
  const hasKeywordQuery = Boolean(queryTerm.trim());
  const mediaFollowersMin = Number(options.supplierFilters?.media_followers_min ?? NaN);
  const mediaVerified = options.supplierFilters?.media_verified?.trim() ?? "";
  const mediaPlatform = (options.supplierFilters?.media_platform ?? "").trim().toLowerCase();
  const fortniteSkinCountMin = Number(options.supplierFilters?.fortnite_skin_count_min ?? NaN);
  const fortniteSkinCountMax = Number(options.supplierFilters?.fortnite_skin_count_max ?? NaN);
  const fortnitePickaxeCountMin = Number(options.supplierFilters?.fortnite_pickaxe_count_min ?? NaN);
  const fortnitePickaxeCountMax = Number(options.supplierFilters?.fortnite_pickaxe_count_max ?? NaN);
  const fortniteEmoteCountMin = Number(options.supplierFilters?.fortnite_emote_count_min ?? NaN);
  const fortniteEmoteCountMax = Number(options.supplierFilters?.fortnite_emote_count_max ?? NaN);
  const fortniteGliderCountMin = Number(options.supplierFilters?.fortnite_glider_count_min ?? NaN);
  const fortniteGliderCountMax = Number(options.supplierFilters?.fortnite_glider_count_max ?? NaN);
  const fortniteLevelMin = Number(options.supplierFilters?.fortnite_level_min ?? NaN);
  const fortniteLevelMax = Number(options.supplierFilters?.fortnite_level_max ?? NaN);
  const fortniteLifetimeWinsMin = Number(
    options.supplierFilters?.fortnite_lifetime_wins_min ?? NaN
  );
  const fortniteLifetimeWinsMax = Number(
    options.supplierFilters?.fortnite_lifetime_wins_max ?? NaN
  );
  const fortniteVbucksMin = Number(options.supplierFilters?.fortnite_vbucks_min ?? NaN);
  const fortniteVbucksMax = Number(options.supplierFilters?.fortnite_vbucks_max ?? NaN);
  const fortnitePaidSkinCountMin = Number(options.supplierFilters?.fortnite_paid_skin_count_min ?? NaN);
  const fortnitePaidSkinCountMax = Number(options.supplierFilters?.fortnite_paid_skin_count_max ?? NaN);
  const fortnitePaidPickaxeCountMin = Number(
    options.supplierFilters?.fortnite_paid_pickaxe_count_min ?? NaN
  );
  const fortnitePaidPickaxeCountMax = Number(
    options.supplierFilters?.fortnite_paid_pickaxe_count_max ?? NaN
  );
  const fortnitePaidEmoteCountMin = Number(options.supplierFilters?.fortnite_paid_emote_count_min ?? NaN);
  const fortnitePaidEmoteCountMax = Number(options.supplierFilters?.fortnite_paid_emote_count_max ?? NaN);
  const fortnitePaidGliderCountMin = Number(options.supplierFilters?.fortnite_paid_glider_count_min ?? NaN);
  const fortnitePaidGliderCountMax = Number(options.supplierFilters?.fortnite_paid_glider_count_max ?? NaN);
  const fortniteBattlePassLevelMin = Number(
    options.supplierFilters?.fortnite_battle_pass_level_min ?? NaN
  );
  const fortniteBattlePassLevelMax = Number(
    options.supplierFilters?.fortnite_battle_pass_level_max ?? NaN
  );
  const fortniteLastActivityDaysMax = Number(
    options.supplierFilters?.fortnite_last_activity_days_max ?? NaN
  );
  const fortniteLastTransactionYearsMin = Number(
    options.supplierFilters?.fortnite_last_transaction_years_min ?? NaN
  );
  const fortniteRegisteredYearsMin = Number(
    options.supplierFilters?.fortnite_registered_years_min ?? NaN
  );
  const fortniteBattlePass = options.supplierFilters?.fortnite_battle_pass?.trim() ?? "";
  const fortniteNoTransactions = options.supplierFilters?.fortnite_no_transactions?.trim() ?? "";
  const fortniteAccountOriginRaw = options.supplierFilters?.fortnite_account_origin ?? "";
  const fortniteExcludeAccountOriginRaw =
    options.supplierFilters?.fortnite_exclude_account_origin ?? "";
  const fortniteAccountLoginRaw = options.supplierFilters?.fortnite_account_login ?? "";
  const fortniteEmailDomainRaw = options.supplierFilters?.fortnite_email_domain ?? "";
  const fortniteExcludeMailDomainRaw = options.supplierFilters?.fortnite_exclude_mail_domain ?? "";
  const fortniteMailProviderRaw = options.supplierFilters?.fortnite_mail_provider ?? "";
  const fortniteExcludeMailProviderRaw =
    options.supplierFilters?.fortnite_exclude_mail_provider ?? "";
  const fortniteCountryRaw = options.supplierFilters?.fortnite_country ?? "";
  const fortniteExcludeCountryRaw = options.supplierFilters?.fortnite_exclude_country ?? "";
  const fortniteStwEditionRaw = options.supplierFilters?.fortnite_stw_edition ?? "";
  const fortniteExcludeStwEditionRaw = options.supplierFilters?.fortnite_exclude_stw_edition ?? "";
  const riotAccountOriginRaw = options.supplierFilters?.riot_account_origin ?? "";
  const riotExcludeAccountOriginRaw = options.supplierFilters?.riot_exclude_account_origin ?? "";
  const riotCountryRaw = options.supplierFilters?.riot_country ?? "";
  const riotExcludeCountryRaw = options.supplierFilters?.riot_exclude_country ?? "";
  const riotEmailDomainRaw = options.supplierFilters?.riot_email_domain ?? "";
  const riotExcludeMailDomainRaw = options.supplierFilters?.riot_exclude_mail_domain ?? "";
  const riotMailProviderRaw = options.supplierFilters?.riot_mail_provider ?? "";
  const riotExcludeMailProviderRaw = options.supplierFilters?.riot_exclude_mail_provider ?? "";
  const riotLastActivityDaysMax = Number(options.supplierFilters?.riot_last_activity_days_max ?? NaN);
  const riotEmailLinked = options.supplierFilters?.riot_email_linked?.trim() ?? "";
  const riotPhoneLinked = options.supplierFilters?.riot_phone_linked?.trim() ?? "";
  const riotNotSoldBefore = options.supplierFilters?.riot_not_sold_before?.trim() ?? "";
  const riotSoldBefore = options.supplierFilters?.riot_sold_before?.trim() ?? "";
  const riotNotSoldBeforeByMe = options.supplierFilters?.riot_not_sold_before_by_me?.trim() ?? "";
  const riotSoldBeforeByMe = options.supplierFilters?.riot_sold_before_by_me?.trim() ?? "";
  const valorantSkinCountMin = Number(options.supplierFilters?.valorant_skin_count_min ?? NaN);
  const valorantSkinCountMax = Number(options.supplierFilters?.valorant_skin_count_max ?? NaN);
  const valorantAgentsCountMin = Number(options.supplierFilters?.valorant_agents_count_min ?? NaN);
  const valorantAgentsCountMax = Number(options.supplierFilters?.valorant_agents_count_max ?? NaN);
  const valorantKnifeCountMin = Number(options.supplierFilters?.valorant_knife_count_min ?? NaN);
  const valorantKnifeCountMax = Number(options.supplierFilters?.valorant_knife_count_max ?? NaN);
  const valorantGunBuddiesMin = Number(options.supplierFilters?.valorant_gunbuddies_count_min ?? NaN);
  const valorantGunBuddiesMax = Number(options.supplierFilters?.valorant_gunbuddies_count_max ?? NaN);
  const valorantLevelMin = Number(options.supplierFilters?.valorant_level_min ?? NaN);
  const valorantLevelMax = Number(options.supplierFilters?.valorant_level_max ?? NaN);
  const valorantVpMin = Number(options.supplierFilters?.valorant_vp_min ?? NaN);
  const valorantVpMax = Number(options.supplierFilters?.valorant_vp_max ?? NaN);
  const valorantInventoryValueMin = Number(
    options.supplierFilters?.valorant_inventory_value_min ?? NaN
  );
  const valorantInventoryValueMax = Number(
    options.supplierFilters?.valorant_inventory_value_max ?? NaN
  );
  const valorantRpMin = Number(options.supplierFilters?.valorant_rp_min ?? NaN);
  const valorantRpMax = Number(options.supplierFilters?.valorant_rp_max ?? NaN);
  const valorantFreeAgentsMin = Number(options.supplierFilters?.valorant_free_agents_min ?? NaN);
  const valorantFreeAgentsMax = Number(options.supplierFilters?.valorant_free_agents_max ?? NaN);
  const valorantHasKnife = options.supplierFilters?.valorant_has_knife?.trim() ?? "";
  const valorantRegionRaw = options.supplierFilters?.valorant_region ?? "";
  const valorantExcludeRegionRaw = options.supplierFilters?.valorant_exclude_region ?? "";
  const valorantRank = (options.supplierFilters?.valorant_rank ?? "").trim().toLowerCase();
  const valorantRankMin = (options.supplierFilters?.valorant_rank_min ?? "").trim().toLowerCase();
  const valorantRankMax = (options.supplierFilters?.valorant_rank_max ?? "").trim().toLowerCase();
  const valorantPreviousRankMin = (options.supplierFilters?.valorant_previous_rank_min ?? "")
    .trim()
    .toLowerCase();
  const valorantPreviousRankMax = (options.supplierFilters?.valorant_previous_rank_max ?? "")
    .trim()
    .toLowerCase();
  const valorantLastRankMin = (options.supplierFilters?.valorant_last_rank_min ?? "")
    .trim()
    .toLowerCase();
  const valorantLastRankMax = (options.supplierFilters?.valorant_last_rank_max ?? "")
    .trim()
    .toLowerCase();
  const lolSkinCountMin = Number(options.supplierFilters?.lol_skin_count_min ?? NaN);
  const lolSkinCountMax = Number(options.supplierFilters?.lol_skin_count_max ?? NaN);
  const lolChampionsMin = Number(options.supplierFilters?.lol_champions_count_min ?? NaN);
  const lolChampionsMax = Number(options.supplierFilters?.lol_champions_count_max ?? NaN);
  const lolLevelMin = Number(options.supplierFilters?.lol_level_min ?? NaN);
  const lolLevelMax = Number(options.supplierFilters?.lol_level_max ?? NaN);
  const lolWinrateMin = Number(options.supplierFilters?.lol_winrate_min ?? NaN);
  const lolWinrateMax = Number(options.supplierFilters?.lol_winrate_max ?? NaN);
  const lolBlueEssenceMin = Number(options.supplierFilters?.lol_blue_essence_min ?? NaN);
  const lolBlueEssenceMax = Number(options.supplierFilters?.lol_blue_essence_max ?? NaN);
  const lolOrangeEssenceMin = Number(options.supplierFilters?.lol_orange_essence_min ?? NaN);
  const lolOrangeEssenceMax = Number(options.supplierFilters?.lol_orange_essence_max ?? NaN);
  const lolMythicEssenceMin = Number(options.supplierFilters?.lol_mythic_essence_min ?? NaN);
  const lolMythicEssenceMax = Number(options.supplierFilters?.lol_mythic_essence_max ?? NaN);
  const lolRiotPointsMin = Number(options.supplierFilters?.lol_riot_points_min ?? NaN);
  const lolRiotPointsMax = Number(options.supplierFilters?.lol_riot_points_max ?? NaN);
  const lolRegionRaw = options.supplierFilters?.lol_region ?? "";
  const lolExcludeRegionRaw = options.supplierFilters?.lol_exclude_region ?? "";
  const lolRank = (options.supplierFilters?.lol_rank ?? "").trim().toLowerCase();
  const robloxLevelMin = Number(options.supplierFilters?.roblox_level_min ?? NaN);
  const robloxLevelMax = Number(options.supplierFilters?.roblox_level_max ?? NaN);
  const robloxRobuxMin = Number(options.supplierFilters?.roblox_robux_min ?? NaN);
  const robloxRobuxMax = Number(options.supplierFilters?.roblox_robux_max ?? NaN);
  const robloxFriendsMin = Number(options.supplierFilters?.roblox_friends_min ?? NaN);
  const robloxFriendsMax = Number(options.supplierFilters?.roblox_friends_max ?? NaN);
  const robloxFollowersMin = Number(options.supplierFilters?.roblox_followers_min ?? NaN);
  const robloxFollowersMax = Number(options.supplierFilters?.roblox_followers_max ?? NaN);
  const robloxInventoryMin = Number(options.supplierFilters?.roblox_inventory_value_min ?? NaN);
  const robloxInventoryMax = Number(options.supplierFilters?.roblox_inventory_value_max ?? NaN);
  const robloxAgeDaysMin = Number(options.supplierFilters?.roblox_age_days_min ?? NaN);
  const robloxAgeDaysMax = Number(options.supplierFilters?.roblox_age_days_max ?? NaN);
  const steamGameCountMin = Number(options.supplierFilters?.steam_game_count_min ?? NaN);
  const cs2Prime = options.supplierFilters?.cs2_prime?.trim() ?? "";
  const cs2Rank = (options.supplierFilters?.cs2_rank ?? "").trim().toLowerCase();
  const parseMultiSelect = (raw: string | undefined) =>
    (raw ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  const fortniteOutfits = parseMultiSelect(options.supplierFilters?.fortnite_outfits);
  const fortnitePickaxes = parseMultiSelect(options.supplierFilters?.fortnite_pickaxes);
  const fortniteEmotes = parseMultiSelect(options.supplierFilters?.fortnite_emotes);
  const fortniteGliders = parseMultiSelect(options.supplierFilters?.fortnite_gliders);
  const hasFortniteSelectorFilters =
    fortniteOutfits.length > 0 ||
    fortnitePickaxes.length > 0 ||
    fortniteEmotes.length > 0 ||
    fortniteGliders.length > 0;
  const hasFortniteCountFilters =
    (Number.isFinite(fortniteSkinCountMin) && fortniteSkinCountMin > 0) ||
    (Number.isFinite(fortniteSkinCountMax) && fortniteSkinCountMax > 0) ||
    (Number.isFinite(fortnitePickaxeCountMin) && fortnitePickaxeCountMin > 0) ||
    (Number.isFinite(fortnitePickaxeCountMax) && fortnitePickaxeCountMax > 0) ||
    (Number.isFinite(fortniteEmoteCountMin) && fortniteEmoteCountMin > 0) ||
    (Number.isFinite(fortniteEmoteCountMax) && fortniteEmoteCountMax > 0) ||
    (Number.isFinite(fortniteGliderCountMin) && fortniteGliderCountMin > 0) ||
    (Number.isFinite(fortniteGliderCountMax) && fortniteGliderCountMax > 0);
  const trustNativeFortniteCountFiltering =
    hasFortniteCountFilters &&
    !hasFortniteSelectorFilters &&
    !hasKeywordQuery;
  const useNativeFortniteSelectorParams =
    hasFortniteSelectorFilters &&
    !Boolean(options.disableNativeFortniteSelectorParams) &&
    ENABLE_NATIVE_FORTNITE_SELECTOR_PARAMS;
  const socialKeywords = [
    "instagram",
    "insta",
    "tiktok",
    "tik tok",
    "facebook",
    "twitter",
    "x.com",
    "youtube",
    "telegram",
    "discord",
    "snapchat",
    "social",
    "media",
    "инстаграм",
    "тикток",
    "ютуб",
    "фейсбук",
    "соц"
  ];
  const mediaPlatformKeywords: Record<string, string[]> = {
    instagram: ["instagram", "insta", "инстаграм"],
    tiktok: ["tiktok", "tik tok", "тикток"],
    facebook: ["facebook", "фейсбук"],
    telegram: ["telegram", "телеграм"],
    discord: ["discord", "дискорд"],
    youtube: ["youtube", "ютуб"],
    twitter: ["twitter", "x.com", "икс", "твиттер"],
    snapchat: ["snapchat", "снапчат"]
  };
  const normalizeText = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  const fortniteAccountOrigin = normalizeText(fortniteAccountOriginRaw);
  const fortniteExcludeAccountOrigin = normalizeText(fortniteExcludeAccountOriginRaw);
  const fortniteAccountLogin = normalizeText(fortniteAccountLoginRaw);
  const fortniteEmailDomain = normalizeText(fortniteEmailDomainRaw);
  const fortniteExcludeMailDomain = normalizeText(fortniteExcludeMailDomainRaw);
  const fortniteMailProvider = normalizeText(fortniteMailProviderRaw);
  const fortniteExcludeMailProvider = normalizeText(fortniteExcludeMailProviderRaw);
  const fortniteCountry = normalizeText(fortniteCountryRaw);
  const fortniteExcludeCountry = normalizeText(fortniteExcludeCountryRaw);
  const fortniteStwEdition = normalizeText(fortniteStwEditionRaw);
  const fortniteExcludeStwEdition = normalizeText(fortniteExcludeStwEditionRaw);
  const riotAccountOrigin = normalizeText(riotAccountOriginRaw);
  const riotExcludeAccountOrigin = normalizeText(riotExcludeAccountOriginRaw);
  const riotCountry = normalizeText(riotCountryRaw);
  const riotExcludeCountry = normalizeText(riotExcludeCountryRaw);
  const riotEmailDomain = normalizeText(riotEmailDomainRaw);
  const riotExcludeMailDomain = normalizeText(riotExcludeMailDomainRaw);
  const riotMailProvider = normalizeText(riotMailProviderRaw);
  const riotExcludeMailProvider = normalizeText(riotExcludeMailProviderRaw);
  const valorantRegion = normalizeText(valorantRegionRaw);
  const valorantExcludeRegion = normalizeText(valorantExcludeRegionRaw);
  const lolRegion = normalizeText(lolRegionRaw);
  const lolExcludeRegion = normalizeText(lolExcludeRegionRaw);
  const toFilterTokens = (raw: string) =>
    normalizeText(raw)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);
  const matchesTokens = (haystack: string, tokens: string[]) => {
    if (tokens.length === 0) {
      return true;
    }
    return tokens.every((token) => haystack.includes(token));
  };
  const itemSearchText = (item: MarketListing) =>
    normalizeText(
      `${item.title} ${item.description} ${item.game} ${item.category} ${item.specs
        .map((spec) => `${spec.label} ${spec.value}`)
        .join(" ")}`
    );
  const queryTokens = Array.from(
    new Set(
      normalizeText(queryTerm)
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    )
  );
  const normalizedQuery = queryTokens.join(" ");
  const compactQuery = queryTokens.join("");
  const isSubsequence = (haystack: string, needle: string) => {
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
  };
  const tokenMatchesText = (
    normalizedHaystack: string,
    compactHaystack: string,
    token: string
  ) => {
    if (normalizedHaystack.includes(token)) {
      return true;
    }
    const words = normalizedHaystack.split(" ");
    if (words.some((word) => word.startsWith(token) || token.startsWith(word))) {
      return true;
    }
    if (token.length >= 4 && isSubsequence(compactHaystack, token)) {
      return true;
    }
    return false;
  };
  const matchesKeywordQuery = (item: MarketListing) => {
    if (queryTokens.length === 0) {
      return true;
    }
    const normalizedHaystack = normalizeText(
      `${item.title} ${item.description} ${item.game} ${item.category} ${item.specs
        .map((spec) => `${spec.label} ${spec.value}`)
        .join(" ")}`
    );
    if (!normalizedHaystack) {
      return false;
    }
    const compactHaystack = normalizedHaystack.replace(/\s+/g, "");
    if (normalizedQuery && normalizedHaystack.includes(normalizedQuery)) {
      return true;
    }
    if (compactQuery.length >= 5 && compactHaystack.includes(compactQuery)) {
      return true;
    }
    let matches = 0;
    for (const token of queryTokens) {
      if (tokenMatchesText(normalizedHaystack, compactHaystack, token)) {
        matches += 1;
      }
    }
    const requiredMatches =
      queryTokens.length <= 1
        ? 1
        : queryTokens.length <= 2
          ? 2
          : Math.max(2, Math.ceil(queryTokens.length * 0.67));
    return matches >= requiredMatches;
  };
  const scoreKeywordMatch = (item: MarketListing) => {
    if (queryTokens.length === 0) {
      return 0;
    }
    const haystack = normalizeText(
      `${item.title} ${item.description} ${item.game} ${item.category} ${item.specs
        .map((spec) => `${spec.label} ${spec.value}`)
        .join(" ")}`
    );
    if (!haystack) {
      return 0;
    }
    const compactHaystack = haystack.replace(/\s+/g, "");
    let score = 0;

    if (normalizedQuery && haystack.includes(normalizedQuery)) {
      score += 160;
    }
    if (compactQuery.length >= 5 && compactHaystack.includes(compactQuery)) {
      score += 120;
    }

    const words = haystack.split(" ");
    for (const token of queryTokens) {
      if (haystack.includes(token)) {
        score += 28;
      }
      if (words.some((word) => word.startsWith(token) || token.startsWith(word))) {
        score += 18;
      }
      if (token.length >= 4 && isSubsequence(compactHaystack, token)) {
        score += 10;
      }
    }

    if (matchesKeywordQuery(item)) {
      score += 24;
    }
    return score;
  };
  const matchesStrictPhrase = (item: MarketListing, phrase: string) => {
    const normalizedPhrase = normalizeText(phrase);
    if (!normalizedPhrase) {
      return false;
    }
    const haystack = normalizeText(
      `${item.title} ${item.description} ${item.game} ${item.category} ${item.specs
        .map((spec) => `${spec.label} ${spec.value}`)
        .join(" ")}`
    );
    if (!haystack) {
      return false;
    }
    if (haystack.includes(normalizedPhrase)) {
      return true;
    }
    const phraseTokens = normalizedPhrase.split(" ").filter((token) => token.length >= 2);
    if (phraseTokens.length < 2) {
      return false;
    }
    return phraseTokens.every((token) =>
      haystack.split(" ").some((word) => word === token || word.startsWith(token))
    );
  };
  const matchesSelectedTerm = (item: MarketListing, term: string) => {
    const normalizedTerm = normalizeText(term);
    if (!normalizedTerm) {
      return false;
    }
    const haystack = normalizeText(
      `${item.title} ${item.description} ${item.game} ${item.category} ${item.specs
        .map((spec) => `${spec.label} ${spec.value}`)
        .join(" ")}`
    );
    if (!haystack) {
      return false;
    }
    if (haystack.includes(normalizedTerm)) {
      return true;
    }
    const words = haystack.split(" ").filter(Boolean);
    const ignoredTokens = new Set([
      "fortnite",
      "account",
      "accounts",
      "skin",
      "skins",
      "outfit",
      "outfits",
      "pickaxe",
      "pickaxes",
      "emote",
      "emotes",
      "dance",
      "dances",
      "glider",
      "gliders",
      "og",
      "full",
      "stacked"
    ]);
    const termTokens = normalizedTerm
      .split(" ")
      .filter((token) => token.length >= 2)
      .filter((token) => !ignoredTokens.has(token));
    if (termTokens.length === 0) {
      return false;
    }
    return termTokens.every((token) =>
      words.some(
        (word) => word === token || (token.length >= 5 && word.startsWith(token))
      )
    );
  };
  type FortniteSelectorKey = "fortnite_outfits" | "fortnite_pickaxes" | "fortnite_emotes" | "fortnite_gliders";
  const matchesSelectedFortniteTerm = (
    item: MarketListing,
    term: string,
    selectorKey: FortniteSelectorKey
  ) => {
    const normalizedTerm = normalizeText(term);
    if (!normalizedTerm) {
      return false;
    }
    const compactTerm = normalizedTerm.replace(/\s+/g, "");
    const selectorHints: Record<FortniteSelectorKey, string[]> = {
      fortnite_outfits: ["outfit", "outfits", "skin", "skins", "character", "hero"],
      fortnite_pickaxes: ["pickaxe", "pickaxes", "axe", "axes", "harvesting"],
      fortnite_emotes: ["emote", "emotes", "dance", "dances"],
      fortnite_gliders: ["glider", "gliders"]
    };
    const descriptionPatterns: Record<FortniteSelectorKey, RegExp> = {
      fortnite_outfits: /\b(?:outfits?|skins?)\s*[:=-]\s*([^\n\r]{2,320})/gi,
      fortnite_pickaxes: /\b(?:pickaxes?|axes?)\s*[:=-]\s*([^\n\r]{2,320})/gi,
      fortnite_emotes: /\b(?:emotes?|dances?)\s*[:=-]\s*([^\n\r]{2,320})/gi,
      fortnite_gliders: /\b(?:gliders?)\s*[:=-]\s*([^\n\r]{2,320})/gi
    };

    const candidates: string[] = [];
    const normalizeFortniteCosmeticCode = (value: string) => {
      const compact = value
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
      if (!compact) {
        return "";
      }
      const withoutCommonPrefix = compact.replace(/^(?:cid|character|eid|glider)_/, "");
      return withoutCommonPrefix || compact;
    };
    const termCode = normalizeFortniteCosmeticCode(term);
    const splitTermTokens = normalizedTerm
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .filter(
        (token) =>
          ![
            "fortnite",
            "skin",
            "skins",
            "outfit",
            "outfits",
            "pickaxe",
            "pickaxes",
            "emote",
            "emotes",
            "dance",
            "dances",
            "glider",
            "gliders"
          ].includes(token)
      );
    const splitCandidateParts = (value: string) =>
      value
        .replace(/\[[^\]]+]/g, " ")
        .replace(/\([^)]*\)/g, " ")
        .split(/(?:\s*\|\s*|,\s*|;\s*|\/\s*|\n+)+/g)
        .map((part) => part.trim())
        .filter(Boolean);

    const matchesExactCandidate = (source: string) => {
      const normalizedSource = normalizeText(source);
      if (!normalizedSource) {
        return false;
      }
      if (normalizedSource === normalizedTerm) {
        return true;
      }
      const compactSource = normalizedSource.replace(/\s+/g, "");
      if (compactTerm.length >= 3 && compactSource === compactTerm) {
        return true;
      }
      if (termCode) {
        const sourceCode = normalizeFortniteCosmeticCode(source);
        if (sourceCode && sourceCode === termCode) {
          return true;
        }
      }
      for (const part of splitCandidateParts(source)) {
        const normalizedPart = normalizeText(part);
        if (!normalizedPart) {
          continue;
        }
        if (normalizedPart === normalizedTerm) {
          return true;
        }
        const compactPart = normalizedPart.replace(/\s+/g, "");
        if (compactTerm.length >= 3 && compactPart === compactTerm) {
          return true;
        }
        if (termCode) {
          const partCode = normalizeFortniteCosmeticCode(part);
          if (partCode && partCode === termCode) {
            return true;
          }
        }
      }
      return false;
    };
    const matchesLooseCandidate = (source: string) => {
      if (splitTermTokens.length === 0) {
        return false;
      }
      const parts = [source, ...splitCandidateParts(source)];
      for (const part of parts) {
        const normalizedPart = normalizeText(part);
        if (!normalizedPart) {
          continue;
        }
        const words = normalizedPart.split(" ").filter(Boolean);
        const matchedAll = splitTermTokens.every((token) =>
          words.some((word) => word === token || word.startsWith(token) || token.startsWith(word))
        );
        if (matchedAll) {
          return true;
        }
      }
      return false;
    };

    // Include title/description first because many suppliers only expose cosmetics there.
    // Some listings have sparse specs, but still clearly list selected cosmetics in title text.
    candidates.push(item.title);
    candidates.push(item.description);

    for (const spec of item.specs) {
      const label = normalizeText(spec.label);
      const value = normalizeText(spec.value);
      const hasSelectorHint = selectorHints[selectorKey].some((hint) =>
        label.includes(normalizeText(hint)) || value.includes(normalizeText(hint))
      );

      // Real LZT detail payloads often store cosmetics as label=title (e.g. "Crystal"),
      // so we must scan generic spec text too, not only hint-labeled rows.
      candidates.push(`${spec.label} ${spec.value}`);
      candidates.push(spec.label);
      candidates.push(spec.value);
      if (hasSelectorHint) {
        candidates.push(`${spec.value} ${spec.label}`);
      }
    }
    for (const match of item.description.matchAll(descriptionPatterns[selectorKey])) {
      candidates.push(match[1] ?? "");
    }
    if (candidates.length === 0) {
      return false;
    }

    for (const source of candidates) {
      if (matchesExactCandidate(source)) {
        return true;
      }
    }
    for (const source of candidates) {
      if (matchesLooseCandidate(source)) {
        return true;
      }
    }
    return false;
  };

  const hasFortniteSignal = (item: MarketListing) => {
    const text = itemSearchText(item);
    const strongKeywords = [
      "fortnite",
      "фортнайт",
      "vbucks",
      "v bucks",
      "v-bucks",
      "save the world",
      "stw",
      "battle royale",
      "locker"
    ]
      .map((keyword) => normalizeText(keyword))
      .some((keyword) => keyword && text.includes(keyword));

    if (strongKeywords) {
      return true;
    }

    const weakKeywords = [
      "outfit",
      "outfits",
      "skin",
      "skins",
      "pickaxe",
      "pickaxes",
      "emote",
      "emotes",
      "dances",
      "dance",
      "glider",
      "gliders"
    ];
    const weakMatchCount = weakKeywords.reduce((count, keyword) => {
      const normalized = normalizeText(keyword);
      return normalized && text.includes(normalized) ? count + 1 : count;
    }, 0);

    const blockedLeakKeywords = [
      "gta",
      "grand theft auto",
      "social club",
      "rockstar",
      "ark",
      "dead by daylight",
      "dbd",
      "steam",
      "counter strike",
      "cs2",
      "valorant",
      "league of legends",
      "battlenet",
      "battle.net"
    ];
    const hasLeakKeyword = blockedLeakKeywords
      .map((keyword) => normalizeText(keyword))
      .some((keyword) => keyword && text.includes(keyword));

    const hasFortniteSpecLabel = item.specs.some((spec) =>
      normalizeText(spec.label).includes("fortnite")
    );
    if (hasFortniteSpecLabel) {
      return true;
    }

    return weakMatchCount >= 2 && !hasLeakKeyword;
  };
  const matchesGameToken = (item: MarketListing, token: string) => {
    const normalizedToken = normalizeText(token);
    const rawHaystack = `${item.game} ${item.title} ${item.category} ${item.description} ${item.specs
      .map((spec) => `${spec.label} ${spec.value}`)
      .join(" ")}`.toLowerCase();
    const normalizedHaystack = normalizeText(rawHaystack);
    const containsToken = (keyword: string) =>
      rawHaystack.includes(keyword.toLowerCase()) ||
      normalizedHaystack.includes(normalizeText(keyword));
    if (
      normalizedToken === "social" ||
      normalizedToken === "media" ||
      normalizedToken === "media account" ||
      normalizedToken === "media accounts"
    ) {
      return socialKeywords.some((keyword) => containsToken(keyword));
    }
    if (normalizedToken === "fortnite") {
      return hasFortniteSignal(item);
    }
    if (normalizedToken === "steam") {
      return (
        containsToken("steam") ||
        containsToken("cs2") ||
        containsToken("counter-strike") ||
        containsToken("dota") ||
        containsToken("rust") ||
        containsToken("pubg") ||
        containsToken("vac") ||
        containsToken("prime") ||
        containsToken("faceit")
      );
    }
    if (
      normalizedToken === "siege" ||
      normalizedToken === "uplay" ||
      normalizedToken === "rainbow-six-siege"
    ) {
      return (
        containsToken("siege") ||
        containsToken("rainbow") ||
        containsToken("r6") ||
        containsToken("uplay") ||
        containsToken("ubisoft")
      );
    }
    if (normalizedToken === "supercell") {
      return (
        containsToken("supercell") ||
        containsToken("brawl stars") ||
        containsToken("brawlstars") ||
        containsToken("clash of clans") ||
        containsToken("clashofclans") ||
        containsToken("clash royale") ||
        containsToken("clashroyale") ||
        containsToken("hay day") ||
        containsToken("hayday") ||
        containsToken("squad busters")
      );
    }
    if (normalizedToken === "roblox") {
      return (
        containsToken("roblox") ||
        containsToken("rbx") ||
        containsToken("robux") ||
        containsToken("limited") ||
        containsToken("korblox") ||
        containsToken("headless") ||
        containsToken("blox fruits")
      );
    }
    if (
      normalizedToken === "valorant" ||
      normalizedToken === "riot client" ||
      normalizedToken === "riot"
    ) {
      return containsToken("valorant") || containsToken("riot");
    }
    if (normalizedToken === "battlenet") {
      return (
        containsToken("battlenet") ||
        containsToken("battle.net") ||
        containsToken("blizzard") ||
        containsToken("overwatch") ||
        containsToken("warzone") ||
        containsToken("call of duty") ||
        containsToken("diablo") ||
        containsToken("world of warcraft") ||
        containsToken("wow")
      );
    }
    if (normalizedToken === "telegram") {
      return containsToken("telegram") || containsToken("телеграм");
    }
    if (normalizedToken === "discord") {
      return containsToken("discord") || containsToken("дискорд");
    }
    if (normalizedToken === "cs2") {
      return (
        containsToken("cs2") ||
        containsToken("counter-strike") ||
        containsToken("counter strike") ||
        containsToken("csgo")
      );
    }
    return containsToken(normalizedToken);
  };
  const itemScopeHaystack = (item: MarketListing) =>
    normalizeText(`${item.game} ${item.title} ${item.category} ${item.description}`);
  const hasSocialKeyword = (item: MarketListing) => {
    const haystack = itemScopeHaystack(item);
    return socialKeywords.some((keyword) => haystack.includes(normalizeText(keyword)));
  };
  const hasFortniteKeyword = (item: MarketListing) => matchesGameToken(item, "fortnite");
  const parseCompactNumber = (raw: string) => {
    const text = raw.toLowerCase().replace(/\s+/g, "").replace(",", ".");
    const match = text.match(/(\d+(?:\.\d+)?)(k|m|b)?/);
    if (!match) {
      return 0;
    }
    const base = Number(match[1]);
    if (!Number.isFinite(base)) {
      return 0;
    }
    const suffix = match[2] ?? "";
    const multiplier =
      suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : suffix === "b" ? 1_000_000_000 : 1;
    return Math.round(base * multiplier);
  };
  const parseLooseNumber = (raw: string) => {
    const compactToken = raw.match(/\d+(?:[.,]\d+)?\s*[kmb]?/i)?.[0] ?? "";
    if (compactToken) {
      const compact = parseCompactNumber(compactToken);
      if (compact > 0) {
        return compact;
      }
    }
    const fallbackToken = raw.match(/\d[\d\s.,]*/)?.[0] ?? "";
    if (!fallbackToken) {
      return 0;
    }
    const parsed = Number(fallbackToken.replace(/[^\d]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const extractMetricValue = (item: MarketListing, aliases: string[]) => {
    let max = 0;
    const sources = [
      item.title,
      item.description,
      ...item.specs.map((spec) => `${spec.label}: ${spec.value}`)
    ];

    for (const source of sources) {
      const lower = source.toLowerCase();
      for (const alias of aliases) {
        const normalizedAlias = alias.toLowerCase();
        if (!lower.includes(normalizedAlias)) {
          continue;
        }
        const nearMatches = source.match(
          new RegExp(`${normalizedAlias.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}[^\\d]{0,12}(\\d[\\d\\s.,kmb]*)`, "gi")
        ) ?? [];
        for (const match of nearMatches) {
          max = Math.max(max, parseLooseNumber(match));
        }
      }
    }

    for (const spec of item.specs) {
      const label = spec.label.toLowerCase();
      if (aliases.some((alias) => label.includes(alias.toLowerCase()))) {
        max = Math.max(max, parseLooseNumber(spec.value));
      }
    }

    return max;
  };
  type FortniteMetricKey = "outfits" | "pickaxes" | "emotes" | "gliders";
  const extractFortniteCountStrict = (
    item: MarketListing,
    metric: FortniteMetricKey,
    mode: "core" | "paid"
  ) => {
    const metricAliases: Record<FortniteMetricKey, string[]> = {
      outfits: [
        "skins",
        "skin",
        "outfits",
        "outfit",
        "locker",
        "скины",
        "скин",
        "облики",
        "облик"
      ],
      pickaxes: [
        "pickaxes",
        "pickaxe",
        "harvesting tool",
        "axe",
        "кирки",
        "кирка"
      ],
      emotes: [
        "emotes",
        "emote",
        "dances",
        "dance",
        "эмоции",
        "эмоция",
        "танцы",
        "танец"
      ],
      gliders: ["gliders", "glider", "дельтапланы", "дельтаплан", "глайдеры", "глайдер"]
    };
    const normalizedAliases = metricAliases[metric].map((alias) => normalizeText(alias)).filter(Boolean);
    if (normalizedAliases.length === 0) {
      return 0;
    }

    const extractNumberTokens = (text: string) =>
      Array.from(text.matchAll(/\d+(?:[.,]\d+)?\s*[kmb]?/gi))
        .map((match) => parseCompactNumber(match[0]))
        .filter((value) => Number.isFinite(value) && value > 0);
    const pickPaidCountValue = (text: string) => {
      const normalized = normalizeText(text);
      if (!normalized || (!normalized.includes("paid") && !normalized.includes("shop"))) {
        return 0;
      }
      const candidates: number[] = [];
      for (const match of normalized.matchAll(
        /(?:paid|shop)[^\d]{0,8}(\d+(?:[.,]\d+)?\s*[kmb]?)/gi
      )) {
        candidates.push(parseCompactNumber(match[1] ?? ""));
      }
      for (const match of normalized.matchAll(
        /(\d+(?:[.,]\d+)?\s*[kmb]?)[^\d]{0,8}(?:paid|shop)/gi
      )) {
        candidates.push(parseCompactNumber(match[1] ?? ""));
      }
      const parsed = candidates.filter((value) => Number.isFinite(value) && value > 0);
      if (parsed.length === 0) {
        return 0;
      }
      return Math.max(...parsed);
    };
    const pickCountValue = (text: string, currentMode: "core" | "paid") => {
      const tokens = extractNumberTokens(text);
      if (tokens.length === 0) {
        return 0;
      }
      if (currentMode === "paid") {
        const paidCount = pickPaidCountValue(text);
        if (paidCount > 0) {
          return paidCount;
        }
        return tokens.length > 1 ? tokens[1] : tokens[0];
      }
      if (
        /\d+(?:[.,]\d+)?\s*[kmb]?\s*[-–—~]\s*\d+(?:[.,]\d+)?\s*[kmb]?/i.test(text) ||
        /\bfrom\b[^.\n]{0,14}\bto\b/i.test(text)
      ) {
        return Math.max(...tokens);
      }
      return tokens[0];
    };
    const labelGroups: Record<FortniteMetricKey, string[]> = {
      outfits: [
        "fortnite skin count",
        "skin count",
        "skins",
        "outfit count",
        "outfits",
        "count skins",
        "количество скинов",
        "скинов"
      ],
      pickaxes: [
        "fortnite pickaxe count",
        "pickaxe count",
        "pickaxes",
        "harvesting tool",
        "количество кирок",
        "кирок"
      ],
      emotes: [
        "fortnite emote count",
        "fortnite dance count",
        "emote count",
        "emotes",
        "dance count",
        "dances",
        "количество эмоций",
        "эмоций",
        "танцев"
      ],
      gliders: [
        "fortnite glider count",
        "glider count",
        "gliders",
        "количество дельтапланов",
        "дельтапланов",
        "глайдеров"
      ]
    };
    const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    let max = 0;
    const preferredLabels = labelGroups[metric].map((label) => normalizeText(label));
    for (const spec of item.specs) {
      const label = normalizeText(spec.label);
      const value = normalizeText(spec.value);
      const combined = `${label} ${value}`.trim();
      if (!combined) {
        continue;
      }
      if (!preferredLabels.some((entry) => label.includes(entry))) {
        continue;
      }
      const hasPaid = combined.includes("paid") || combined.includes("shop");
      if (mode === "paid" && !hasPaid) {
        continue;
      }
      max = Math.max(max, pickCountValue(spec.value, mode));
    }
    if (max > 0) {
      return max;
    }

    const scanSource = (sourceRaw: string) => {
      const source = sourceRaw.toLowerCase();
      const sourceNormalized = normalizeText(sourceRaw);
      if (!sourceNormalized) {
        return;
      }
      if (!normalizedAliases.some((alias) => sourceNormalized.includes(alias))) {
        return;
      }
      const hasPaid = sourceNormalized.includes("paid") || sourceNormalized.includes("shop");
      if (mode === "paid" && !hasPaid) {
        return;
      }
      for (const alias of normalizedAliases) {
        if (!sourceNormalized.includes(alias)) {
          continue;
        }
        const escapedAlias = escapePattern(alias);
        const forwardRegex = new RegExp(
          `${escapedAlias}[^\\d]{0,12}(\\d+(?:[.,]\\d+)?\\s*[kmb]?(?:\\s*[-–—~]\\s*\\d+(?:[.,]\\d+)?\\s*[kmb]?)?)`,
          "gi"
        );
        const backwardRegex = new RegExp(
          `(\\d+(?:[.,]\\d+)?\\s*[kmb]?(?:\\s*[-–—~]\\s*\\d+(?:[.,]\\d+)?\\s*[kmb]?)?)[^\\d]{0,8}${escapedAlias}`,
          "gi"
        );
        for (const match of source.matchAll(forwardRegex)) {
          max = Math.max(max, pickCountValue(match[1] ?? "", mode));
        }
        for (const match of source.matchAll(backwardRegex)) {
          max = Math.max(max, pickCountValue(match[1] ?? "", mode));
        }
      }
    };

    for (const spec of item.specs) {
      const label = normalizeText(spec.label);
      const value = normalizeText(spec.value);
      const combined = `${label} ${value}`.trim();
      if (!combined) {
        continue;
      }
      if (!normalizedAliases.some((alias) => combined.includes(alias) || label.includes(alias))) {
        continue;
      }
      const hasPaid = combined.includes("paid") || combined.includes("shop");
      if (mode === "paid" && !hasPaid) {
        continue;
      }
      max = Math.max(max, pickCountValue(spec.value, mode));
    }

    if (max > 0) {
      return max;
    }

    scanSource(item.title);
    scanSource(item.description);
    for (const spec of item.specs) {
      scanSource(`${spec.label}: ${spec.value}`);
    }

    if (max > 0) {
      return max;
    }

    const metricPatternMap: Record<FortniteMetricKey, RegExp> = {
      outfits: /\b(?:skins?|outfits?|fortnite skin count|количество скинов|скинов)\b[^\d]{0,12}(\d+(?:[.,]\d+)?\s*[kmb]?)/gi,
      pickaxes: /\b(?:pickaxes?|pickaxe|axes?|harvesting tool|количество кирок|кирок)\b[^\d]{0,12}(\d+(?:[.,]\d+)?\s*[kmb]?)/gi,
      emotes: /\b(?:emotes?|emote|dances?|dance|количество эмоций|эмоций|танцев)\b[^\d]{0,12}(\d+(?:[.,]\d+)?\s*[kmb]?)/gi,
      gliders: /\b(?:gliders?|glider|глайдеров|дельтапланов)\b[^\d]{0,12}(\d+(?:[.,]\d+)?\s*[kmb]?)/gi
    };
    const fallbackSource = `${item.title}\n${item.description}\n${item.specs
      .map((spec) => `${spec.label}: ${spec.value}`)
      .join("\n")}`;
    for (const match of fallbackSource.matchAll(metricPatternMap[metric])) {
      max = Math.max(max, parseCompactNumber(match[1] ?? ""));
    }

    return max;
  };
  const applyFortniteCountRangeStrict = (
    metric: FortniteMetricKey,
    min: number,
    max: number,
    mode: "core" | "paid"
  ) => {
    if (trustNativeFortniteCountFiltering) {
      // Supplier already receives native Fortnite count params (smin/pickaxe_min/dmin/gmin etc).
      // Avoid over-pruning here when local parsing is incomplete.
      return;
    }
    if (phase === "pre") {
      return;
    }
    const hasMin = Number.isFinite(min) && min > 0;
    const hasMax = Number.isFinite(max) && max > 0;
    if (!hasMin && !hasMax) {
      return;
    }
    const values = output.map((item) => extractFortniteCountStrict(item, metric, mode));
    const parsableCount = values.filter((value) => value > 0).length;
    if (phase === "final" && parsableCount === 0) {
      return;
    }
    const filtered = output.filter((item, index) => {
      const value = values[index] ?? 0;
      if (value <= 0) {
        return false;
      }
      if (hasMin && value < min) {
        return false;
      }
      if (hasMax && value > max) {
        return false;
      }
      return true;
    });
    output = filtered;
  };
  const extractFollowers = (item: MarketListing) => {
    const sources = [
      item.title,
      item.description,
      ...item.specs.map((spec) => `${spec.label}: ${spec.value}`)
    ];
    const keywords = [
      "followers",
      "subs",
      "subscribers",
      "подпис",
      "audience"
    ];

    let maxValue = 0;
    for (const source of sources) {
      const text = source.toLowerCase();
      const compactMatches = text.match(/\b\d+(?:[.,]\d+)?\s*[kmb]\b/gi) ?? [];
      for (const token of compactMatches) {
        maxValue = Math.max(maxValue, parseCompactNumber(token));
      }

      const explicitMatches =
        text.match(/\b\d[\d\s.,]{1,12}\b(?=[^\n]{0,24}(followers|subs|subscribers|подпис|audience))/gi) ??
        [];
      for (const token of explicitMatches) {
        const numeric = Number(token.replace(/[^\d]/g, ""));
        if (Number.isFinite(numeric)) {
          maxValue = Math.max(maxValue, numeric);
        }
      }

      if (keywords.some((keyword) => text.includes(keyword))) {
        const fallbackMatches = text.match(/\b\d[\d\s.,]{1,12}\b/gi) ?? [];
        for (const token of fallbackMatches) {
          const numeric = Number(token.replace(/[^\d]/g, ""));
          if (Number.isFinite(numeric)) {
            maxValue = Math.max(maxValue, numeric);
          }
        }
      }
    }
    return maxValue;
  };
  const isVerifiedMedia = (item: MarketListing) => {
    const text = normalizeText(
      `${item.title} ${item.description} ${item.specs
        .map((spec) => `${spec.label} ${spec.value}`)
        .join(" ")}`
    );
    const positive = [
      "verified",
      "verification",
      "blue check",
      "checkmark",
      "галочка",
      "вериф"
    ];
    const negative = [
      "not verified",
      "without verify",
      "no verify",
      "без вериф",
      "без галочки"
    ];
    if (negative.some((token) => text.includes(token))) {
      return false;
    }
    return positive.some((token) => text.includes(token));
  };
  const hasMailAccess = (item: MarketListing) => {
    const specsCombined = item.specs.map((spec) => `${spec.label} ${spec.value}`).join(" ");
    const text = normalizeText(`${item.title} ${item.description} ${specsCombined}`);
    const negativePatterns = [
      /\bwithout mail\b/,
      /\bwithout email\b/,
      /\bno mail\b/,
      /\bno email\b/,
      /\bmail access\s*[:=-]?\s*(no|false|0)\b/,
      /\bemail access\s*[:=-]?\s*(no|false|0)\b/,
      /\bma\s*[:=-]?\s*(no|false|0)\b/,
      /без\s+почт/,
      /почт[аы]\s+нет/
    ];
    if (negativePatterns.some((pattern) => pattern.test(text))) {
      return false;
    }

    const positivePatterns = [
      /\bmail access\b/,
      /\bemail access\b/,
      /\bwith mail\b/,
      /\bwith email\b/,
      /\bmail\b/,
      /\bemail\b/,
      /\bgmail\b/,
      /\bпочт[аы]\b/,
      /родн(?:ая|ой)\s+почт/,
      /доступ[^.]{0,32}почт/
    ];
    if (positivePatterns.some((pattern) => pattern.test(text))) {
      return true;
    }

    return item.specs.some((spec) => {
      const label = normalizeText(spec.label);
      const value = normalizeText(spec.value);
      if (label !== "ma") {
        return false;
      }
      return ["1", "yes", "true", "on", "available"].includes(value);
    });
  };
  const hasCs2Prime = (item: MarketListing) => {
    const text = normalizeText(
      `${item.title} ${item.description} ${item.specs
        .map((spec) => `${spec.label} ${spec.value}`)
        .join(" ")}`
    );
    if (/\b(no prime|without prime|non prime|non-prime)\b/.test(text)) {
      return false;
    }
    return /\bprime\b/.test(text);
  };
  const isVacClean = (item: MarketListing) => {
    const text = itemSearchText(item);
    if (
      text.includes("vac ban") ||
      text.includes("banned by vac") ||
      text.includes("not vac clean")
    ) {
      return false;
    }
    return text.includes("vac clean") || text.includes("without vac") || text.includes("no vac");
  };
  const hasBattlePass = (item: MarketListing) => {
    const text = itemSearchText(item);
    if (
      text.includes("without battle pass") ||
      text.includes("no battle pass") ||
      text.includes("battle pass no") ||
      text.includes("battlepass no")
    ) {
      return false;
    }
    return text.includes("battle pass") || text.includes("battlepass");
  };
  const hasNoTransactionsData = (item: MarketListing) => {
    const text = itemSearchText(item);
    return (
      text.includes("no transactions") ||
      text.includes("without transactions") ||
      text.includes("without purchases") ||
      text.includes("нет транзак")
    );
  };
  const applyMetricRange = (aliases: string[], min: number, max: number) => {
    const hasMin = Number.isFinite(min) && min > 0;
    const hasMax = Number.isFinite(max) && max > 0;
    if (!hasMin && !hasMax) {
      return;
    }
    const values = output.map((item) => extractMetricValue(item, aliases));
    const parsableCount = values.filter((value) => value > 0).length;
    if (phase === "final" && parsableCount === 0) {
      return;
    }
    const filtered = output.filter((_, index) => {
      const value = values[index] ?? 0;
      if (value <= 0) {
        return phase === "pre";
      }
      if (hasMin && value < min) {
        return false;
      }
      if (hasMax && value > max) {
        return false;
      }
      return true;
    });
    if (phase === "final" && filtered.length === 0) {
      return;
    }
    output = filtered;
  };
  const extractScopedMetricValue = (
    item: MarketListing,
    scopeAliases: string[],
    metricAliases: string[]
  ) => {
    const normalizedScopes = scopeAliases.map((alias) => normalizeText(alias)).filter(Boolean);
    const normalizedMetrics = metricAliases.map((alias) => normalizeText(alias)).filter(Boolean);
    if (normalizedScopes.length === 0 || normalizedMetrics.length === 0) {
      return 0;
    }

    let max = 0;
    for (const spec of item.specs) {
      const label = normalizeText(spec.label);
      const value = normalizeText(spec.value);
      const combined = `${label} ${value}`.trim();
      if (!combined) {
        continue;
      }
      const hasScope = normalizedScopes.some(
        (scope) => label.includes(scope) || combined.includes(scope)
      );
      if (!hasScope) {
        continue;
      }
      const hasMetric = normalizedMetrics.some(
        (metric) => label.includes(metric) || combined.includes(metric)
      );
      if (!hasMetric) {
        continue;
      }
      max = Math.max(max, parseLooseNumber(spec.value));
    }

    if (max > 0) {
      return max;
    }

    const sources = [item.title, item.description];
    for (const source of sources) {
      const normalized = normalizeText(source);
      if (!normalized) {
        continue;
      }
      for (const scope of normalizedScopes) {
        if (!normalized.includes(scope)) {
          continue;
        }
        for (const metric of normalizedMetrics) {
          const escapedScope = scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const escapedMetric = metric.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const forward = new RegExp(
            `${escapedScope}[\\s\\S]{0,48}${escapedMetric}[^\\d]{0,12}(\\d[\\d\\s.,kmb]*)`,
            "gi"
          );
          const backward = new RegExp(
            `(\\d[\\d\\s.,kmb]*)[^\\d]{0,12}${escapedMetric}[\\s\\S]{0,48}${escapedScope}`,
            "gi"
          );
          for (const match of source.matchAll(forward)) {
            max = Math.max(max, parseLooseNumber(match[1] ?? ""));
          }
          for (const match of source.matchAll(backward)) {
            max = Math.max(max, parseLooseNumber(match[1] ?? ""));
          }
        }
      }
    }

    return max;
  };
  const applyScopedMetricRange = (
    scopeAliases: string[],
    metricAliases: string[],
    min: number,
    max: number
  ) => {
    const hasMin = Number.isFinite(min) && min > 0;
    const hasMax = Number.isFinite(max) && max > 0;
    if (!hasMin && !hasMax) {
      return;
    }
    const values = output.map((item) =>
      extractScopedMetricValue(item, scopeAliases, metricAliases)
    );
    const parsableCount = values.filter((value) => value > 0).length;
    if (phase === "final" && parsableCount === 0) {
      output = [];
      return;
    }
    output = output.filter((_, index) => {
      const value = values[index] ?? 0;
      if (value <= 0) {
        return phase === "pre";
      }
      if (hasMin && value < min) {
        return false;
      }
      if (hasMax && value > max) {
        return false;
      }
      return true;
    });
  };
  const applyIncludeTokens = (raw: string) => {
    const tokens = toFilterTokens(raw);
    if (tokens.length === 0) {
      return;
    }
    output = output.filter((item) => matchesTokens(itemSearchText(item), tokens));
  };
  const applyExcludeTokens = (raw: string) => {
    const tokens = toFilterTokens(raw);
    if (tokens.length === 0) {
      return;
    }
    output = output.filter((item) => !matchesTokens(itemSearchText(item), tokens));
  };
  const valorantRankOrder = [
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
  const lolRankOrder = [
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
  const siegeRankOrder = [
    "copper",
    "bronze",
    "silver",
    "gold",
    "platinum",
    "emerald",
    "diamond",
    "champion"
  ];
  const rankIndex = (rank: string, order: string[]) => {
    if (!rank) {
      return 0;
    }
    const normalizedRank = normalizeText(rank);
    const foundIndex = order.findIndex((entry) => normalizedRank.includes(entry));
    return foundIndex >= 0 ? foundIndex + 1 : 0;
  };
  const extractRankIndexFromItem = (item: MarketListing, order: string[]) => {
    const text = itemSearchText(item);
    let maxRank = 0;
    for (const [index, entry] of order.entries()) {
      if (text.includes(entry)) {
        maxRank = Math.max(maxRank, index + 1);
      }
    }
    return maxRank;
  };
  const hasLinkedEmail = (item: MarketListing) => {
    const text = itemSearchText(item);
    if (
      text.includes("email unlinked") ||
      text.includes("mail unlinked") ||
      text.includes("without email") ||
      text.includes("without mail")
    ) {
      return false;
    }
    return (
      text.includes("email linked") ||
      text.includes("mail linked") ||
      text.includes("linked email") ||
      text.includes("linked mail")
    );
  };
  const hasLinkedPhone = (item: MarketListing) => {
    const text = itemSearchText(item);
    if (
      text.includes("phone unlinked") ||
      text.includes("without phone") ||
      text.includes("no phone linked")
    ) {
      return false;
    }
    return text.includes("phone linked") || text.includes("linked phone");
  };
  const hasValorantKnife = (item: MarketListing) => {
    const text = itemSearchText(item);
    return text.includes("knife") || text.includes("melee");
  };
  const hasSoldBefore = (item: MarketListing) => {
    const text = itemSearchText(item);
    return text.includes("sold before") || text.includes("resold") || text.includes("перепрод");
  };
  const isNotSoldBefore = (item: MarketListing) => {
    const text = itemSearchText(item);
    return text.includes("not sold before") || text.includes("first sale") || text.includes("не продав");
  };
  const getRawFilter = (key: string) => options.supplierFilters?.[key] ?? "";
  const getNumberFilter = (key: string) => Number(options.supplierFilters?.[key] ?? NaN);
  const getFlagFilter = (key: string) => options.supplierFilters?.[key]?.trim() ?? "";
  const hasFortniteSpecificFilters = Object.entries(options.supplierFilters ?? {}).some(
    ([key, value]) => key.startsWith("fortnite_") && String(value ?? "").trim().length > 0
  );
  let effectiveGameFilter = gameFilter;
  if (hasFortniteSpecificFilters && effectiveGameFilter !== "fortnite") {
    effectiveGameFilter = "fortnite";
  }
  const applyRangeByKeys = (minKey: string, maxKey: string, aliases: string[]) => {
    applyMetricRange(aliases, getNumberFilter(minKey), getNumberFilter(maxKey));
  };
  const applySoftMediaRangeByKeys = (minKey: string, maxKey: string, aliases: string[]) => {
    const min = getNumberFilter(minKey);
    const max = getNumberFilter(maxKey);
    const hasMin = Number.isFinite(min) && min > 0;
    const hasMax = Number.isFinite(max) && max > 0;
    if (!hasMin && !hasMax) {
      return;
    }

    const values = output.map((item) => extractMetricValue(item, aliases));
    const parsableCount = values.filter((value) => value > 0).length;
    if (phase === "final" && parsableCount === 0) {
      return;
    }

    const filtered = output.filter((_, index) => {
      const value = values[index] ?? 0;
      if (value <= 0) {
        return phase === "pre";
      }
      if (hasMin && value < min) {
        return false;
      }
      if (hasMax && value > max) {
        return false;
      }
      return true;
    });
    output = filtered;
  };
  const applyPrefixCommonFilters = (prefix: string) => {
    applyIncludeTokens(getRawFilter(`${prefix}_account_origin`));
    applyExcludeTokens(getRawFilter(`${prefix}_exclude_account_origin`));
    applyIncludeTokens(getRawFilter(`${prefix}_country`));
    applyExcludeTokens(getRawFilter(`${prefix}_exclude_country`));
    applyIncludeTokens(getRawFilter(`${prefix}_email_domain`));
    applyExcludeTokens(getRawFilter(`${prefix}_exclude_mail_domain`));
    applyIncludeTokens(getRawFilter(`${prefix}_mail_provider`));
    applyExcludeTokens(getRawFilter(`${prefix}_exclude_mail_provider`));

    const lastActivityMax = getNumberFilter(`${prefix}_last_activity_days_max`);
    if (Number.isFinite(lastActivityMax) && lastActivityMax > 0) {
      output = output.filter((item) => {
        const activity = extractMetricValue(item, ["last activity", "active", "activity days"]);
        return activity <= lastActivityMax || activity === 0;
      });
    }

    if (getFlagFilter(`${prefix}_not_sold_before`) === "1") {
      output = output.filter((item) => isNotSoldBefore(item));
    }
    if (getFlagFilter(`${prefix}_sold_before`) === "1") {
      output = output.filter((item) => hasSoldBefore(item));
    }
    if (getFlagFilter(`${prefix}_not_sold_before_by_me`) === "1") {
      output = output.filter((item) => isNotSoldBefore(item));
    }
    if (getFlagFilter(`${prefix}_sold_before_by_me`) === "1") {
      output = output.filter((item) => hasSoldBefore(item));
    }
  };

  if (Number.isFinite(options.minPrice ?? NaN)) {
    output = output.filter((item) => item.basePrice >= Number(options.minPrice));
  }
  if (Number.isFinite(options.maxPrice ?? NaN)) {
    output = output.filter((item) => item.basePrice <= Number(options.maxPrice));
  }
  const hasRobloxSpecificFilters = Object.entries(options.supplierFilters ?? {}).some(
    ([key, rawValue]) => key.startsWith("roblox_") && String(rawValue ?? "").trim().length > 0
  );
  // Roblox records are often sparse/mislabeled; allow scoped fallback but trim obvious leaks later.
  const looseScopeGameTokens = new Set(["roblox"]);
  if (!trustSupplierScopedEndpoint && effectiveGameFilter && effectiveGameFilter !== "uplay") {
    const skipRobloxTokenNarrowing =
      effectiveGameFilter === "roblox" && !hasRobloxSpecificFilters;

    if (!skipRobloxTokenNarrowing) {
      const scoped = output.filter((item) => matchesGameToken(item, effectiveGameFilter));
      if (scoped.length > 0) {
        output = scoped;
      } else if (!hasExplicitScope && effectiveGameFilter === "fortnite") {
        const fallbackFortnite = output.filter((item) => !hasSocialKeyword(item));
        if (fallbackFortnite.length > 0) {
          output = fallbackFortnite;
        }
      } else if (phase === "final" && looseScopeGameTokens.has(effectiveGameFilter)) {
        // Some provider records in scoped Roblox endpoints do not include explicit "roblox" tokens.
        // Keep scoped endpoint results instead of force-emptying this pass.
      } else if ((hasExplicitScope || Boolean(inferredQueryGameFilter)) && phase === "final") {
        output = [];
      }
    }
  }
  if (!trustSupplierScopedEndpoint && effectiveGameFilter === "fortnite") {
    const fortniteScoped = output.filter((item) => hasFortniteSignal(item));
    if (phase === "final" || fortniteScoped.length > 0) {
      output = fortniteScoped;
    }
  }
  if (
    !trustSupplierScopedEndpoint &&
    categoryFilter &&
    categoryFilter !== "uplay" &&
    (!effectiveGameFilter || categoryFilter === effectiveGameFilter)
  ) {
    const skipRobloxCategoryTokenNarrowing =
      categoryFilter === "roblox" && !hasRobloxSpecificFilters;
    if (!skipRobloxCategoryTokenNarrowing) {
      const scopedByCategory = output.filter((item) => matchesGameToken(item, categoryFilter));
      if (scopedByCategory.length > 0) {
        output = scopedByCategory;
      } else if (phase === "final" && looseScopeGameTokens.has(categoryFilter)) {
        // Same as game-scope fallback: trust scoped endpoint results for Roblox.
      } else if (selectedCategoryFilter && phase === "final") {
        output = [];
      }
    }
  }
  const hasRobloxExclusionSignal = (item: MarketListing) => {
    const haystack = itemScopeHaystack(item);
    const exclusionTokens = [
      "apex",
      "ea account",
      "ea play",
      "electronic arts",
      "fifa",
      "fortnite",
      "valorant",
      "riot client",
      "counter strike",
      "cs2",
      "steam",
      "rainbow",
      "siege",
      "uplay",
      "telegram",
      "discord",
      "battle net",
      "battlenet",
      "blizzard",
      "supercell",
      "brawl stars",
      "clash royale",
      "clash of clans"
    ].map((token) => normalizeText(token));
    return exclusionTokens.some((token) => token && haystack.includes(token));
  };
  const hasRobloxMetricSignal = (item: MarketListing) => {
    const haystack = itemSearchText(item);
    const keywordSignals = [
      "robux",
      "rbx",
      "korblox",
      "headless",
      "limited",
      "rap",
      "gamepass",
      "gamepasses",
      "voice chat",
      "xbox connected",
      "psn connected"
    ];
    if (keywordSignals.some((token) => haystack.includes(normalizeText(token)))) {
      return true;
    }
    const metricSignals = [
      extractMetricValue(item, ["robux", "rbx"]),
      extractMetricValue(item, ["friends", "friend"]),
      extractMetricValue(item, ["followers", "follows", "subs", "subscribers"]),
      extractMetricValue(item, ["inventory value", "limited value", "rap"]),
      extractMetricValue(item, ["gamepasses", "gamepass"])
    ];
    return metricSignals.some((value) => Number.isFinite(value) && value > 0);
  };
  if (!trustSupplierScopedEndpoint && (effectiveGameFilter === "roblox" || categoryFilter === "roblox")) {
    const hasRobloxTextSignal = (item: MarketListing) => {
      const haystack = itemSearchText(item);
      return (
        haystack.includes("roblox") ||
        haystack.includes("rbx") ||
        haystack.includes("robux") ||
        haystack.includes("korblox") ||
        haystack.includes("headless") ||
        haystack.includes("limited")
      );
    };
    const withoutObviousLeaks = output.filter((item) => !hasRobloxExclusionSignal(item));
    const strictRobloxScoped = withoutObviousLeaks.filter(
      (item) =>
        matchesGameToken(item, "roblox") ||
        hasRobloxMetricSignal(item) ||
        hasRobloxTextSignal(item)
    );
    if (hasRobloxSpecificFilters) {
      if (strictRobloxScoped.length > 0) {
        output = strictRobloxScoped;
      } else if (phase === "final") {
        output = [];
      }
    } else if (withoutObviousLeaks.length > 0) {
      // No explicit Roblox filters: trust scoped Roblox endpoint data and only trim obvious cross-vertical leaks.
      output = withoutObviousLeaks;
    } else if (phase === "final") {
      output = [];
    }
  }
  if (hasKeywordQuery) {
    const ranked = output.map((item) => ({
      item,
      score: scoreKeywordMatch(item)
    }));
    const matched = ranked
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
    const strictKeywordFilter =
      phase === "final" &&
      queryTokens.length >= 2 &&
      !hasFortniteSelectorFilters;
    if (strictKeywordFilter) {
      const strictMatched = output.filter((item) => matchesStrictPhrase(item, queryTerm));
      if (strictMatched.length > 0) {
        output = strictMatched;
      } else if (matched.length > 0) {
        output = matched;
      } else {
        output = [];
      }
    } else if (matched.length > 0) {
      const matchedIds = new Set(matched.map((item) => item.id));
      const nonMatched = output.filter((item) => !matchedIds.has(item.id));
      output = [...matched, ...nonMatched];
    }
  }
  const resolvedMediaPlatform =
    mediaPlatform && mediaPlatform in mediaPlatformKeywords
      ? mediaPlatform
      : categoryFilter in mediaPlatformKeywords
        ? categoryFilter
        : "";
  if (resolvedMediaPlatform) {
    const platformTokens = mediaPlatformKeywords[resolvedMediaPlatform] ?? [];
    const platformScoped = output.filter((item) => {
      const haystack = `${item.title} ${item.description} ${item.game} ${item.category} ${item.specs
        .map((spec) => `${spec.label} ${spec.value}`)
        .join(" ")}`.toLowerCase();
      return platformTokens.some((token) => haystack.includes(token));
    });
    // Some supplier records only carry platform hints in sparse/irregular fields.
    // Keep scoped endpoint results instead of collapsing to zero when none are parseable.
    if (platformScoped.length > 0) {
      output = platformScoped;
    }
  }
  applyIncludeTokens(fortniteAccountOrigin);
  applyExcludeTokens(fortniteExcludeAccountOrigin);
  applyIncludeTokens(fortniteAccountLogin);
  applyIncludeTokens(fortniteEmailDomain);
  applyExcludeTokens(fortniteExcludeMailDomain);
  applyIncludeTokens(fortniteMailProvider);
  applyExcludeTokens(fortniteExcludeMailProvider);
  applyIncludeTokens(fortniteCountry);
  applyExcludeTokens(fortniteExcludeCountry);
  applyIncludeTokens(fortniteStwEdition);
  applyExcludeTokens(fortniteExcludeStwEdition);
  applyFortniteCountRangeStrict(
    "outfits",
    fortniteSkinCountMin,
    fortniteSkinCountMax,
    "core"
  );
  applyFortniteCountRangeStrict(
    "pickaxes",
    fortnitePickaxeCountMin,
    fortnitePickaxeCountMax,
    "core"
  );
  applyFortniteCountRangeStrict(
    "emotes",
    fortniteEmoteCountMin,
    fortniteEmoteCountMax,
    "core"
  );
  applyFortniteCountRangeStrict(
    "gliders",
    fortniteGliderCountMin,
    fortniteGliderCountMax,
    "core"
  );
  applyMetricRange(
    ["level", "lvl", "account level"],
    fortniteLevelMin,
    fortniteLevelMax
  );
  applyMetricRange(
    ["wins", "lifetime wins", "victories"],
    fortniteLifetimeWinsMin,
    fortniteLifetimeWinsMax
  );
  applyMetricRange(
    ["vbucks", "v bucks", "v-bucks"],
    fortniteVbucksMin,
    fortniteVbucksMax
  );
  applyFortniteCountRangeStrict(
    "outfits",
    fortnitePaidSkinCountMin,
    fortnitePaidSkinCountMax,
    "paid"
  );
  applyFortniteCountRangeStrict(
    "pickaxes",
    fortnitePaidPickaxeCountMin,
    fortnitePaidPickaxeCountMax,
    "paid"
  );
  applyFortniteCountRangeStrict(
    "emotes",
    fortnitePaidEmoteCountMin,
    fortnitePaidEmoteCountMax,
    "paid"
  );
  applyFortniteCountRangeStrict(
    "gliders",
    fortnitePaidGliderCountMin,
    fortnitePaidGliderCountMax,
    "paid"
  );
  applyMetricRange(
    ["battle pass level", "bp level"],
    fortniteBattlePassLevelMin,
    fortniteBattlePassLevelMax
  );
  if (Number.isFinite(fortniteLastActivityDaysMax) && fortniteLastActivityDaysMax > 0) {
    output = output.filter((item) => {
      const activity = extractMetricValue(item, ["last activity", "active", "activity days"]);
      return activity <= fortniteLastActivityDaysMax || activity === 0;
    });
  }
  if (Number.isFinite(fortniteLastTransactionYearsMin) && fortniteLastTransactionYearsMin > 0) {
    output = output.filter((item) => {
      const years = extractMetricValue(item, ["last transaction", "transaction", "purchase"]);
      return years >= fortniteLastTransactionYearsMin || years === 0;
    });
  }
  if (Number.isFinite(fortniteRegisteredYearsMin) && fortniteRegisteredYearsMin > 0) {
    output = output.filter((item) => {
      const years = extractMetricValue(item, ["registered", "reg date", "registration"]);
      return years >= fortniteRegisteredYearsMin || years === 0;
    });
  }
  if (fortniteNoTransactions === "1") {
    output = output.filter((item) => hasNoTransactionsData(item));
  }
  if (fortniteBattlePass === "1") {
    output = output.filter((item) => hasBattlePass(item));
  }
  if (fortniteBattlePass === "0") {
    output = output.filter((item) => !hasBattlePass(item));
  }
  applyIncludeTokens(riotAccountOrigin);
  applyExcludeTokens(riotExcludeAccountOrigin);
  applyIncludeTokens(riotCountry);
  applyExcludeTokens(riotExcludeCountry);
  applyIncludeTokens(riotEmailDomain);
  applyExcludeTokens(riotExcludeMailDomain);
  applyIncludeTokens(riotMailProvider);
  applyExcludeTokens(riotExcludeMailProvider);
  if (Number.isFinite(riotLastActivityDaysMax) && riotLastActivityDaysMax > 0) {
    output = output.filter((item) => {
      const activity = extractMetricValue(item, ["last activity", "active", "activity days"]);
      return activity <= riotLastActivityDaysMax || activity === 0;
    });
  }
  if (riotEmailLinked === "1") {
    output = output.filter((item) => hasLinkedEmail(item));
  }
  if (riotEmailLinked === "0") {
    output = output.filter((item) => !hasLinkedEmail(item));
  }
  if (riotPhoneLinked === "1") {
    output = output.filter((item) => hasLinkedPhone(item));
  }
  if (riotPhoneLinked === "0") {
    output = output.filter((item) => !hasLinkedPhone(item));
  }
  if (riotNotSoldBefore === "1") {
    output = output.filter((item) => isNotSoldBefore(item));
  }
  if (riotSoldBefore === "1") {
    output = output.filter((item) => hasSoldBefore(item));
  }
  if (riotNotSoldBeforeByMe === "1") {
    output = output.filter((item) => isNotSoldBefore(item));
  }
  if (riotSoldBeforeByMe === "1") {
    output = output.filter((item) => hasSoldBefore(item));
  }
  applyScopedMetricRange(
    ["valorant", "riot valorant", "vlt", "val"],
    ["skins", "skin", "weapon skins", "inventory", "collection"],
    valorantSkinCountMin,
    valorantSkinCountMax
  );
  applyScopedMetricRange(
    ["valorant", "riot valorant", "vlt", "val"],
    ["agents", "agent"],
    valorantAgentsCountMin,
    valorantAgentsCountMax
  );
  applyScopedMetricRange(
    ["valorant", "riot valorant", "vlt", "val"],
    ["knives", "knife", "melee"],
    valorantKnifeCountMin,
    valorantKnifeCountMax
  );
  applyScopedMetricRange(
    ["valorant", "riot valorant", "vlt", "val"],
    ["gun buddy", "gun buddies", "gunbuddies", "buddies"],
    valorantGunBuddiesMin,
    valorantGunBuddiesMax
  );
  applyScopedMetricRange(
    ["valorant", "riot valorant", "vlt", "val"],
    ["level", "account level"],
    valorantLevelMin,
    valorantLevelMax
  );
  applyScopedMetricRange(
    ["valorant", "riot valorant", "vlt", "val"],
    ["vp", "valorant points"],
    valorantVpMin,
    valorantVpMax
  );
  applyScopedMetricRange(
    ["valorant", "riot valorant", "vlt", "val"],
    ["inventory value", "collection value", "inventory"],
    valorantInventoryValueMin,
    valorantInventoryValueMax
  );
  applyScopedMetricRange(
    ["valorant", "riot valorant", "vlt", "val"],
    ["rp", "radianite", "radianite points"],
    valorantRpMin,
    valorantRpMax
  );
  applyScopedMetricRange(
    ["valorant", "riot valorant", "vlt", "val"],
    ["free agents", "unlocked agents"],
    valorantFreeAgentsMin,
    valorantFreeAgentsMax
  );
  applyIncludeTokens(valorantRegion);
  applyExcludeTokens(valorantExcludeRegion);
  if (valorantRank) {
    output = output.filter((item) => itemSearchText(item).includes(valorantRank));
  }
  if (valorantHasKnife === "1") {
    if (phase === "final") {
      output = output.filter((item) => hasValorantKnife(item));
    }
  }
  if (valorantRankMin) {
    const target = rankIndex(valorantRankMin, valorantRankOrder);
    if (target > 0) {
      output = output.filter((item) => extractRankIndexFromItem(item, valorantRankOrder) >= target);
    }
  }
  if (valorantRankMax) {
    const target = rankIndex(valorantRankMax, valorantRankOrder);
    if (target > 0) {
      output = output.filter((item) => {
        const rank = extractRankIndexFromItem(item, valorantRankOrder);
        return rank > 0 && rank <= target;
      });
    }
  }
  if (valorantPreviousRankMin) {
    const target = rankIndex(valorantPreviousRankMin, valorantRankOrder);
    if (target > 0) {
      output = output.filter((item) => extractRankIndexFromItem(item, valorantRankOrder) >= target);
    }
  }
  if (valorantPreviousRankMax) {
    const target = rankIndex(valorantPreviousRankMax, valorantRankOrder);
    if (target > 0) {
      output = output.filter((item) => {
        const rank = extractRankIndexFromItem(item, valorantRankOrder);
        return rank > 0 && rank <= target;
      });
    }
  }
  if (valorantLastRankMin) {
    const target = rankIndex(valorantLastRankMin, valorantRankOrder);
    if (target > 0) {
      output = output.filter((item) => extractRankIndexFromItem(item, valorantRankOrder) >= target);
    }
  }
  if (valorantLastRankMax) {
    const target = rankIndex(valorantLastRankMax, valorantRankOrder);
    if (target > 0) {
      output = output.filter((item) => {
        const rank = extractRankIndexFromItem(item, valorantRankOrder);
        return rank > 0 && rank <= target;
      });
    }
  }
  applyScopedMetricRange(
    ["league of legends", "league", "lol", "riot lol"],
    ["skins", "skin", "lol skins", "league skins"],
    lolSkinCountMin,
    lolSkinCountMax
  );
  applyScopedMetricRange(
    ["league of legends", "league", "lol", "riot lol"],
    ["champions", "champs", "champion"],
    lolChampionsMin,
    lolChampionsMax
  );
  applyScopedMetricRange(
    ["league of legends", "league", "lol", "riot lol"],
    ["level", "summoner level"],
    lolLevelMin,
    lolLevelMax
  );
  applyScopedMetricRange(
    ["league of legends", "league", "lol", "riot lol"],
    ["winrate", "win rate"],
    lolWinrateMin,
    lolWinrateMax
  );
  applyScopedMetricRange(
    ["league of legends", "league", "lol", "riot lol"],
    ["blue essence", "be"],
    lolBlueEssenceMin,
    lolBlueEssenceMax
  );
  applyScopedMetricRange(
    ["league of legends", "league", "lol", "riot lol"],
    ["orange essence"],
    lolOrangeEssenceMin,
    lolOrangeEssenceMax
  );
  applyScopedMetricRange(
    ["league of legends", "league", "lol", "riot lol"],
    ["mythic essence"],
    lolMythicEssenceMin,
    lolMythicEssenceMax
  );
  applyScopedMetricRange(
    ["league of legends", "league", "lol", "riot lol"],
    ["riot points", "rp"],
    lolRiotPointsMin,
    lolRiotPointsMax
  );
  applyIncludeTokens(lolRegion);
  applyExcludeTokens(lolExcludeRegion);
  if (lolRank) {
    const target = rankIndex(lolRank, lolRankOrder);
    if (target > 0) {
      output = output.filter((item) => extractRankIndexFromItem(item, lolRankOrder) >= target);
    } else {
      output = output.filter((item) => itemSearchText(item).includes(lolRank));
    }
  }
  for (const prefix of [
    "siege",
    "roblox",
    "supercell",
    "media",
    "telegram",
    "discord",
    "steam",
    "cs2",
    "battlenet"
  ]) {
    applyPrefixCommonFilters(prefix);
  }

  applyIncludeTokens(getRawFilter("siege_platform"));
  applyIncludeTokens(getRawFilter("siege_rank"));
  applyIncludeTokens(getRawFilter("siege_region"));
  applyExcludeTokens(getRawFilter("siege_exclude_region"));
  applyIncludeTokens(getRawFilter("siege_operators"));
  applyIncludeTokens(getRawFilter("siege_skins"));
  const siegeRankMin = normalizeText(getRawFilter("siege_rank_min"));
  const siegeRankMax = normalizeText(getRawFilter("siege_rank_max"));
  if (siegeRankMin) {
    const target = rankIndex(siegeRankMin, siegeRankOrder);
    if (target > 0) {
      output = output.filter((item) => extractRankIndexFromItem(item, siegeRankOrder) >= target);
    }
  }
  if (siegeRankMax) {
    const target = rankIndex(siegeRankMax, siegeRankOrder);
    if (target > 0) {
      output = output.filter((item) => {
        const rank = extractRankIndexFromItem(item, siegeRankOrder);
        return rank === 0 || rank <= target;
      });
    }
  }
  applyRangeByKeys("siege_level_min", "siege_level_max", ["level", "account level"]);
  applyRangeByKeys("siege_operators_min", "siege_operators_max", ["operators", "operator"]);
  applyRangeByKeys("siege_skins_min", "siege_skins_max", ["skins", "skin"]);
  applyRangeByKeys("siege_credits_min", "siege_credits_max", ["credits", "r6 credits"]);
  applyRangeByKeys("siege_kd_min", "siege_kd_max", ["kd", "k d"]);
  applyRangeByKeys("siege_winrate_min", "siege_winrate_max", ["winrate", "win rate"]);
  if (getFlagFilter("siege_banned") === "1") {
    output = output.filter((item) => {
      const text = itemSearchText(item);
      return text.includes("ban") || text.includes("banned");
    });
  }
  if (getFlagFilter("siege_banned") === "0") {
    output = output.filter((item) => {
      const text = itemSearchText(item);
      return (
        text.includes("no ban") ||
        text.includes("without ban") ||
        text.includes("clean") ||
        text.includes("not banned")
      );
    });
  }

  applyIncludeTokens(getRawFilter("supercell_game"));
  applyExcludeTokens(getRawFilter("supercell_exclude_game"));
  applyRangeByKeys(
    "supercell_trophies_min",
    "supercell_trophies_max",
    ["trophies", "trophy"]
  );
  applyRangeByKeys("supercell_gems_min", "supercell_gems_max", ["gems", "gem"]);
  applyRangeByKeys("supercell_level_min", "supercell_level_max", ["level", "lvl"]);
  applyRangeByKeys("supercell_brawl_brawlers_min", "supercell_brawl_brawlers_max", ["brawlers"]);
  applyRangeByKeys("supercell_brawl_skins_min", "supercell_brawl_skins_max", ["skins"]);
  applyRangeByKeys("supercell_brawl_wins_min", "supercell_brawl_wins_max", ["wins"]);
  applyRangeByKeys(
    "supercell_brawl_legendary_brawlers_min",
    "supercell_brawl_legendary_brawlers_max",
    ["legendary brawlers"]
  );
  applyRangeByKeys(
    "supercell_brawl_hypercharges_min",
    "supercell_brawl_hypercharges_max",
    ["hypercharges", "hypercharge"]
  );
  applyRangeByKeys(
    "supercell_brawl_highest_trophies_min",
    "supercell_brawl_highest_trophies_max",
    ["highest trophies"]
  );
  if (getFlagFilter("supercell_brawl_pass") === "1") {
    output = output.filter((item) => itemSearchText(item).includes("brawl pass"));
  }
  if (getFlagFilter("supercell_brawl_pass") === "0") {
    output = output.filter((item) => !itemSearchText(item).includes("brawl pass"));
  }
  applyRangeByKeys("supercell_cr_crown_level_min", "supercell_cr_crown_level_max", ["crown level"]);
  applyRangeByKeys(
    "supercell_cr_evolved_cards_min",
    "supercell_cr_evolved_cards_max",
    ["evolved cards", "evolved"]
  );
  applyRangeByKeys("supercell_cr_champions_min", "supercell_cr_champions_max", ["champions"]);
  applyRangeByKeys(
    "supercell_cr_league_trophies_min",
    "supercell_cr_league_trophies_max",
    ["league trophies"]
  );
  applyRangeByKeys(
    "supercell_cr_league_number_min",
    "supercell_cr_league_number_max",
    ["league number", "league"]
  );
  if (getFlagFilter("supercell_cr_royale_pass") === "1") {
    output = output.filter((item) => itemSearchText(item).includes("royale pass"));
  }
  if (getFlagFilter("supercell_cr_royale_pass") === "0") {
    output = output.filter((item) => !itemSearchText(item).includes("royale pass"));
  }
  applyRangeByKeys("supercell_coc_cup_count_min", "supercell_coc_cup_count_max", ["cup count", "trophies"]);
  applyRangeByKeys("supercell_coc_wins_min", "supercell_coc_wins_max", ["wins"]);
  applyRangeByKeys("supercell_coc_town_hall_min", "supercell_coc_town_hall_max", ["town hall"]);
  applyRangeByKeys(
    "supercell_coc_total_hero_level_min",
    "supercell_coc_total_hero_level_max",
    ["total hero level", "hero level"]
  );
  applyRangeByKeys(
    "supercell_coc_total_troops_level_min",
    "supercell_coc_total_troops_level_max",
    ["total troops level", "troops level"]
  );
  applyRangeByKeys(
    "supercell_coc_total_spell_level_min",
    "supercell_coc_total_spell_level_max",
    ["total spell level", "spell level"]
  );
  applyRangeByKeys(
    "supercell_coc_total_heroes_builder_min",
    "supercell_coc_total_heroes_builder_max",
    ["heroes in the builder", "builder heroes"]
  );
  applyRangeByKeys(
    "supercell_coc_total_troops_builder_min",
    "supercell_coc_total_troops_builder_max",
    ["troops in the builder", "builder troops"]
  );
  applyRangeByKeys(
    "supercell_coc_builder_hall_cups_min",
    "supercell_coc_builder_hall_cups_max",
    ["cup count in builder hall", "builder hall cups"]
  );
  applyRangeByKeys(
    "supercell_coc_builder_hall_min",
    "supercell_coc_builder_hall_max",
    ["builder hall"]
  );
  if (getFlagFilter("supercell_coc_gold_pass") === "1") {
    output = output.filter((item) => itemSearchText(item).includes("gold pass"));
  }
  if (getFlagFilter("supercell_coc_gold_pass") === "0") {
    output = output.filter((item) => !itemSearchText(item).includes("gold pass"));
  }

  // For explicit scoped category pages (e.g. /roblox), trust supplier-side filtering first.
  // Local Roblox metric parsing is kept only as fallback for broad/mixed result modes.
  if (!(trustSupplierScopedEndpoint && hasRobloxSpecificFilters)) {
    applyMetricRange(["level", "lvl", "account level"], robloxLevelMin, robloxLevelMax);
    applyMetricRange(["robux", "rbx"], robloxRobuxMin, robloxRobuxMax);
    applyMetricRange(["friends", "friend"], robloxFriendsMin, robloxFriendsMax);
    applyMetricRange(
      ["followers", "follows", "subs", "subscribers"],
      robloxFollowersMin,
      robloxFollowersMax
    );
    applyMetricRange(
      ["inventory value", "inventory", "value", "limited value"],
      robloxInventoryMin,
      robloxInventoryMax
    );
    applyMetricRange(["age days", "days old", "registered"], robloxAgeDaysMin, robloxAgeDaysMax);
  }

  applySoftMediaRangeByKeys("media_followers_min", "media_followers_max", ["followers", "subs", "subscribers"]);
  applySoftMediaRangeByKeys("media_following_min", "media_following_max", ["following"]);
  applySoftMediaRangeByKeys("media_posts_min", "media_posts_max", ["posts"]);
  applySoftMediaRangeByKeys("media_age_days_min", "media_age_days_max", ["age days", "days old", "registered"]);
  applySoftMediaRangeByKeys("media_engagement_min", "media_engagement_max", ["engagement", "er"]);
  applyIncludeTokens(getRawFilter("media_account_type"));

  if (getFlagFilter("telegram_premium") === "1") {
    output = output.filter((item) => itemSearchText(item).includes("premium"));
  }
  if (getFlagFilter("telegram_premium") === "0") {
    output = output.filter((item) => !itemSearchText(item).includes("premium"));
  }
  applyRangeByKeys("telegram_dialogs_min", "telegram_dialogs_max", ["dialogs", "chats", "messages"]);
  applyRangeByKeys("telegram_channels_min", "telegram_channels_max", ["channels", "channel"]);
  applyRangeByKeys("telegram_groups_min", "telegram_groups_max", ["groups", "group"]);
  applyRangeByKeys("telegram_sessions_min", "telegram_sessions_max", ["sessions", "devices"]);
  applyRangeByKeys("telegram_stars_min", "telegram_stars_max", ["stars"]);
  applyRangeByKeys("telegram_age_days_min", "telegram_age_days_max", ["age days", "days old", "registered"]);

  if (getFlagFilter("discord_nitro") === "1") {
    output = output.filter((item) => itemSearchText(item).includes("nitro"));
  }
  if (getFlagFilter("discord_nitro") === "0") {
    output = output.filter((item) => !itemSearchText(item).includes("nitro"));
  }
  if (getFlagFilter("discord_phone_verified") === "1") {
    output = output.filter((item) => itemSearchText(item).includes("phone verified"));
  }
  if (getFlagFilter("discord_phone_verified") === "0") {
    output = output.filter((item) => !itemSearchText(item).includes("phone verified"));
  }
  if (getFlagFilter("discord_email_verified") === "1") {
    output = output.filter((item) => itemSearchText(item).includes("email verified"));
  }
  if (getFlagFilter("discord_email_verified") === "0") {
    output = output.filter((item) => !itemSearchText(item).includes("email verified"));
  }
  applyRangeByKeys("discord_friends_min", "discord_friends_max", ["friends", "friend"]);
  applyRangeByKeys("discord_servers_min", "discord_servers_max", ["servers", "guilds"]);
  applyRangeByKeys("discord_age_days_min", "discord_age_days_max", ["age days", "days old", "registered"]);
  applyRangeByKeys("discord_badges_min", "discord_badges_max", ["badges", "badge"]);

  if (Number.isFinite(steamGameCountMin) && steamGameCountMin > 0) {
    output = output.filter(
      (item) => extractMetricValue(item, ["games", "owned games", "game count"]) >= steamGameCountMin
    );
  }
  applyRangeByKeys("steam_game_count_min", "steam_game_count_max", ["games", "owned games", "game count"]);
  applyRangeByKeys("steam_level_min", "steam_level_max", ["steam level", "level"]);
  applyRangeByKeys("steam_inventory_value_min", "steam_inventory_value_max", ["inventory", "inventory value"]);
  applyRangeByKeys("steam_hours_min", "steam_hours_max", ["hours", "playtime"]);
  applyIncludeTokens(getRawFilter("steam_rank"));
  applyIncludeTokens(getRawFilter("steam_region"));
  applyExcludeTokens(getRawFilter("steam_exclude_region"));
  if (getFlagFilter("steam_vac") === "1") {
    output = output.filter((item) => isVacClean(item));
  }
  if (getFlagFilter("steam_vac") === "0") {
    output = output.filter((item) => !isVacClean(item));
  }

  if (cs2Prime === "1") {
    output = output.filter((item) => hasCs2Prime(item));
  }
  if (cs2Prime === "0") {
    output = output.filter((item) => !hasCs2Prime(item));
  }
  if (cs2Rank) {
    output = output.filter((item) =>
      normalizeText(
        `${item.title} ${item.description} ${item.specs
          .map((spec) => `${spec.label} ${spec.value}`)
          .join(" ")}`
      ).includes(cs2Rank)
    );
  }
  applyRangeByKeys("cs2_faceit_level_min", "cs2_faceit_level_max", ["faceit level", "faceit"]);
  applyRangeByKeys("cs2_premier_rating_min", "cs2_premier_rating_max", ["premier rating", "premier"]);
  applyRangeByKeys("cs2_wins_min", "cs2_wins_max", ["wins", "victories"]);
  applyRangeByKeys("cs2_hours_min", "cs2_hours_max", ["hours", "playtime"]);
  applyRangeByKeys("cs2_inventory_value_min", "cs2_inventory_value_max", ["inventory", "inventory value"]);
  if (getFlagFilter("cs2_vac") === "1") {
    output = output.filter((item) => isVacClean(item));
  }
  if (getFlagFilter("cs2_vac") === "0") {
    output = output.filter((item) => !isVacClean(item));
  }

  applyIncludeTokens(getRawFilter("battlenet_region"));
  applyExcludeTokens(getRawFilter("battlenet_exclude_region"));
  applyIncludeTokens(getRawFilter("battlenet_rank"));
  applyRangeByKeys("battlenet_level_min", "battlenet_level_max", ["level"]);
  applyRangeByKeys("battlenet_games_min", "battlenet_games_max", ["games", "owned games"]);
  applyRangeByKeys("battlenet_cod_cp_min", "battlenet_cod_cp_max", ["cp", "cod points"]);
  applyRangeByKeys("battlenet_wow_ilvl_min", "battlenet_wow_ilvl_max", ["ilvl", "item level"]);

  if (mediaVerified === "1") {
    output = output.filter((item) => isVerifiedMedia(item));
  }
  if (mediaVerified === "0") {
    output = output.filter((item) => !isVerifiedMedia(item));
  }
  const preFortniteSelectorOutput = output.slice();
  const applyFortniteSelectedTerms = (terms: string[], selectorKey: FortniteSelectorKey) => {
    if (terms.length === 0 || phase === "pre" || useNativeFortniteSelectorParams) {
      return;
    }
    // Treat multi-selects inside one selector as OR, not AND.
    // Example: 2 pickaxes selected should match listings containing either pickaxe.
    const strictMatched = output.filter((item) =>
      terms.some((term) => matchesSelectedFortniteTerm(item, term, selectorKey))
    );
    if (strictMatched.length > 0) {
      output = strictMatched;
      return;
    }

    // Supplier payloads are inconsistent across listings. If strict exact matching
    // yields nothing, retry with token-aware matching instead of returning false zero-results.
    const normalizedTerms = terms
      .map((value) => normalizeText(value))
      .filter(Boolean)
      .slice(0, 20);
    const looseMatched = output.filter((item) => {
      const haystack = normalizeText(
        `${item.title} ${item.description} ${item.specs
          .map((spec) => `${spec.label} ${spec.value}`)
          .join(" ")}`
      );
      if (!haystack) {
        return false;
      }
      const words = haystack.split(" ").filter(Boolean);
      return normalizedTerms.some((normalizedTerm) => {
        const tokens = normalizedTerm
          .split(" ")
          .map((token) => token.trim())
          .filter((token) => token.length >= 2);
        if (tokens.length === 0) {
          return false;
        }
        return tokens.every((token) =>
          words.some((word) => word === token || word.startsWith(token) || token.startsWith(word))
        );
      });
    });
    if (looseMatched.length > 0) {
      output = looseMatched;
    }
  };
  applyFortniteSelectedTerms(fortniteOutfits, "fortnite_outfits");
  applyFortniteSelectedTerms(fortnitePickaxes, "fortnite_pickaxes");
  applyFortniteSelectedTerms(fortniteEmotes, "fortnite_emotes");
  applyFortniteSelectedTerms(fortniteGliders, "fortnite_gliders");
  if (
    phase === "final" &&
    !useNativeFortniteSelectorParams &&
    output.length === 0 &&
    (fortniteOutfits.length > 0 ||
      fortnitePickaxes.length > 0 ||
      fortniteEmotes.length > 0 ||
      fortniteGliders.length > 0)
  ) {
    const groups: Array<{ key: FortniteSelectorKey; terms: string[] }> = [
      { key: "fortnite_outfits", terms: fortniteOutfits },
      { key: "fortnite_pickaxes", terms: fortnitePickaxes },
      { key: "fortnite_emotes", terms: fortniteEmotes },
      { key: "fortnite_gliders", terms: fortniteGliders }
    ];
    output = preFortniteSelectorOutput.filter((item) =>
      groups.some(({ key, terms }) =>
        terms.some((term) => matchesSelectedFortniteTerm(item, term, key))
      )
    );
  }
  if (options.hasImage) {
    output = output.filter((item) => hasRealImage(item.imageUrl));
  }
  if (options.hasDescription) {
    output = output.filter((item) => hasRealDescription(item.description));
  }
  if (options.hasSpecs) {
    output = output.filter((item) => item.specs.length > 0);
  }

  if (options.supplierFilters) {
    const requiresMailAccess = options.supplierFilters.ma === "1";
    const requiresOnline = options.supplierFilters.online === "1";

    const matchesSpecKeyword = (item: MarketListing, keyword: string) =>
      item.specs.some((spec) => `${spec.label} ${spec.value}`.toLowerCase().includes(keyword));

    if (requiresMailAccess) {
      output = output.filter((item) => hasMailAccess(item));
    }
    if (requiresOnline) {
      output = output.filter((item) => matchesSpecKeyword(item, "online"));
    }
  }

  if (options.sort === "price_asc") {
    output.sort((a, b) => a.basePrice - b.basePrice);
  } else if (options.sort === "price_desc") {
    output.sort((a, b) => b.basePrice - a.basePrice);
  } else if (options.sort === "newest") {
    output.sort((a, b) => b.id.localeCompare(a.id));
  }

  return output;
}

function containsCyrillic(text: string) {
  return /[\u0400-\u04FF]/.test(text);
}

async function translateRussianToEnglish(text: string) {
  const source = text.trim();
  if (!source || !containsCyrillic(source)) {
    return text;
  }

  const cached = translationCache.get(source);
  if (cached) {
    return cached;
  }

  const url = new URL(
    process.env.TRANSLATE_API_URL ?? "https://translate.googleapis.com/translate_a/single"
  );

  if (url.hostname.includes("translate.googleapis.com")) {
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", "ru");
    url.searchParams.set("tl", "en");
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", source);
  } else {
    url.searchParams.set("sl", "ru");
    url.searchParams.set("tl", "en");
    url.searchParams.set("q", source);
  }

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    if (!response.ok) {
      return text;
    }

    const data = await response.json();
    let translated = "";

    if (Array.isArray(data) && Array.isArray(data[0])) {
      translated = (data[0] as unknown[])
        .map((segment) => (Array.isArray(segment) && typeof segment[0] === "string" ? segment[0] : ""))
        .join("")
        .trim();
    } else if (data && typeof data === "object") {
      const record = data as Record<string, unknown>;
      translated = extractText(record.translatedText ?? record.translation ?? record.text, "");
    }

    if (!translated) {
      return text;
    }

    translationCache.set(source, translated);
    return translated;
  } catch {
    return text;
  }
}

async function translateListingsToEnglish(listings: MarketListing[]) {
  if ((process.env.LZT_TRANSLATE_RU_TO_EN ?? "true") === "false") {
    return listings;
  }

  const texts = new Set<string>();
  for (const listing of listings) {
    if (containsCyrillic(listing.title)) {
      texts.add(listing.title);
    }
    if (containsCyrillic(listing.description)) {
      texts.add(listing.description);
    }
    if (containsCyrillic(listing.game)) {
      texts.add(listing.game);
    }
    if (containsCyrillic(listing.category)) {
      texts.add(listing.category);
    }
    for (const spec of listing.specs) {
      if (containsCyrillic(spec.label)) {
        texts.add(spec.label);
      }
      if (containsCyrillic(spec.value)) {
        texts.add(spec.value);
      }
    }
  }

  if (texts.size === 0) {
    return listings;
  }

  const translations = new Map<string, string>();
  for (const text of texts) {
    translations.set(text, await translateRussianToEnglish(text));
  }

  return listings.map((listing) => ({
    ...listing,
    title: translations.get(listing.title) ?? listing.title,
    description: translations.get(listing.description) ?? listing.description,
    game: translations.get(listing.game) ?? listing.game,
    category: translations.get(listing.category) ?? listing.category,
    specs: listing.specs.map((spec) => ({
      label: translations.get(spec.label) ?? spec.label,
      value: translations.get(spec.value) ?? spec.value
    }))
  }));
}

const FORTNITE_IMAGE_STOPWORDS = new Set([
  "fortnite",
  "account",
  "accounts",
  "skin",
  "skins",
  "outfit",
  "outfits",
  "pickaxe",
  "pickaxes",
  "dances",
  "dance",
  "emotes",
  "emote",
  "glider",
  "gliders",
  "stacked",
  "full",
  "mail",
  "access",
  "fa",
  "nfa",
  "og",
  "bundle",
  "with",
  "and",
  "the",
  "for"
]);

function isFortniteListing(listing: MarketListing) {
  const text = normalizeKeywordText(`${listing.game} ${listing.category} ${listing.title}`);
  return (
    text.includes("fortnite") ||
    text.includes("vbucks") ||
    text.includes("v bucks") ||
    text.includes("battle pass") ||
    text.includes("outfit") ||
    text.includes("pickaxe") ||
    text.includes("emote") ||
    text.includes("glider") ||
    text.includes("stw")
  );
}

function sanitizeFortniteTerm(raw: string) {
  const compact = raw
    .replace(/[\[\]{}()<>]/g, " ")
    .replace(/[_|/\\]+/g, " ")
    .replace(/[+&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) {
    return "";
  }
  const tokens = compact
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !FORTNITE_IMAGE_STOPWORDS.has(token.toLowerCase()))
    .filter((token) => !/^\d+$/.test(token));
  const phrase = tokens.join(" ").trim();
  if (!phrase || phrase.length < 2 || phrase.length > 64) {
    return "";
  }
  return phrase;
}

const FORTNITE_SPEC_LABEL_HINTS = [
  "outfit",
  "outfits",
  "skin",
  "skins",
  "pickaxe",
  "pickaxes",
  "harvesting",
  "axe",
  "emote",
  "emotes",
  "dance",
  "dances",
  "glider",
  "gliders",
  "cosmetic",
  "cosmetics",
  "locker",
  "bundle",
  "set"
];

function splitFortniteNameCandidates(raw: string) {
  const text = raw
    .replace(/\[[^\]]+]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, "|")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return [];
  }
  const separators = /(?:\s*\|\s*|,\s*|;\s*|\/\s*|\n+|•)+/g;
  const segments = text
    .split(separators)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return Array.from(new Set(segments)).slice(0, 24);
}

function isLikelyFortniteCosmeticLabel(label: string) {
  const normalized = normalizeKeywordText(label);
  if (!normalized) {
    return false;
  }
  return FORTNITE_SPEC_LABEL_HINTS.some((hint) => normalized.includes(hint));
}

function extractFortniteCosmeticTerms(listing: MarketListing) {
  const candidates = new Map<string, string>();
  const add = (value: string) => {
    const term = sanitizeFortniteTerm(value);
    if (!term) {
      return;
    }
    const key = normalizeKeywordText(term);
    if (!key || candidates.has(key)) {
      return;
    }
    candidates.set(key, term);
  };

  for (const spec of listing.specs) {
    if (!isLikelyFortniteCosmeticLabel(spec.label)) {
      continue;
    }
    const value = String(spec.value ?? "").trim();
    if (!value || /^\d+(?:\.\d+)?$/.test(value)) {
      continue;
    }
    for (const part of splitFortniteNameCandidates(value)) {
      add(part);
    }
  }

  const structuredMatches = Array.from(
    listing.description.matchAll(
      /\b(?:outfits?|skins?|pickaxes?|emotes?|dances?|gliders?)\s*[:=-]\s*([^\n\r]{3,240})/gi
    )
  );
  for (const match of structuredMatches) {
    for (const part of splitFortniteNameCandidates(match[1] ?? "")) {
      add(part);
    }
  }

  add(listing.title);
  for (const part of listing.title.split(/[,/|+&-]+/g)) {
    add(part);
  }

  const titleTokens = listing.title
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 24);
  for (let i = 0; i < titleTokens.length; i += 1) {
    add(titleTokens[i]);
    if (i + 1 < titleTokens.length) {
      add(`${titleTokens[i]} ${titleTokens[i + 1]}`);
    }
    if (i + 2 < titleTokens.length) {
      add(`${titleTokens[i]} ${titleTokens[i + 1]} ${titleTokens[i + 2]}`);
    }
  }

  const quoted = Array.from(listing.description.matchAll(/["'`]\s*([^"'`]{2,60})\s*["'`]/g));
  for (const match of quoted) {
    add(match[1] ?? "");
  }

  return Array.from(candidates.values()).slice(0, 10);
}

function normalizeFortniteNameMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isFortniteApiCandidateMatch(record: Record<string, unknown>, term: string) {
  const target = normalizeFortniteNameMatch(term);
  if (!target) {
    return false;
  }
  const candidateName = normalizeFortniteNameMatch(extractText(record.name, ""));
  if (!candidateName) {
    return false;
  }
  if (candidateName === target) {
    return true;
  }
  if (candidateName.includes(target) || target.includes(candidateName)) {
    return true;
  }
  const targetTokens = target.split(" ").filter((token) => token.length >= 2);
  if (targetTokens.length === 0) {
    return false;
  }
  const candidateTokens = new Set(candidateName.split(" ").filter((token) => token.length >= 2));
  const matched = targetTokens.filter((token) => candidateTokens.has(token)).length;
  return matched >= Math.max(1, Math.ceil(targetTokens.length * 0.6));
}

function extractFortniteApiImageFromPayload(payload: unknown, term: string) {
  const pickImage = (record: Record<string, unknown>) => {
    if (!isFortniteApiCandidateMatch(record, term)) {
      return "";
    }
    const images =
      record.images && typeof record.images === "object"
        ? (record.images as Record<string, unknown>)
        : null;
    if (!images) {
      return "";
    }
    const candidates = [
      images.icon,
      images.smallIcon,
      images.featured,
      images.background
    ];
    for (const candidate of candidates) {
      const normalized = normalizeImageUrl(extractText(candidate, ""));
      if (normalized && isLikelyImageUrl(normalized)) {
        return normalized;
      }
    }
    return "";
  };

  if (!payload || typeof payload !== "object") {
    return "";
  }
  const root = payload as Record<string, unknown>;
  const data = root.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const image = pickImage(data as Record<string, unknown>);
    if (image) {
      return image;
    }
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const image = pickImage(item as Record<string, unknown>);
      if (image) {
        return image;
      }
    }
  }
  return "";
}

async function resolveFortniteCosmeticImage(term: string) {
  const key = normalizeKeywordText(term);
  if (!key) {
    return "";
  }
  const cached = fortniteCosmeticImageCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.imageUrl;
  }

  const baseUrl = (process.env.FORTNITE_API_BASE_URL ?? "https://fortnite-api.com").trim().replace(/\/+$/, "");
  const fortniteApiKey = (process.env.FORTNITE_API_KEY ?? "").trim();
  const fortniteAuthHeader = fortniteApiKey || "";
  const urls = [
    `${baseUrl}/v2/cosmetics/br/search?name=${encodeURIComponent(term)}`,
    `${baseUrl}/v2/cosmetics/br/search/all?name=${encodeURIComponent(term)}`
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          ...(fortniteAuthHeader ? { Authorization: fortniteAuthHeader, "x-api-key": fortniteApiKey } : {})
        },
        cache: "no-store"
      });
      if (!response.ok) {
        continue;
      }
      const payload = (await response.json()) as unknown;
      const imageUrl = extractFortniteApiImageFromPayload(payload, term);
      if (imageUrl) {
        fortniteCosmeticImageCache.set(key, {
          imageUrl,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000
        });
        return imageUrl;
      }
    } catch {
      continue;
    }
  }

  fortniteCosmeticImageCache.set(key, {
    imageUrl: "",
    expiresAt: Date.now() + 60 * 60 * 1000
  });
  return "";
}

async function enrichFortniteListingImages(listings: MarketListing[]) {
  const output = listings.slice();
  let lookupBudget = 28;
  const imageUsage = new Map<string, number>();

  for (let index = 0; index < output.length; index += 1) {
    const listing = output[index];
    if (!isFortniteListing(listing)) {
      continue;
    }

    const shouldOverride = !hasRealImage(listing.imageUrl);
    if (!shouldOverride) {
      continue;
    }

    const terms = extractFortniteCosmeticTerms(listing);
    if (terms.length === 0) {
      continue;
    }

    let imageUrl = "";
    for (const term of terms) {
      if (lookupBudget <= 0) {
        break;
      }
      lookupBudget -= 1;
      imageUrl = await resolveFortniteCosmeticImage(term);
      if (imageUrl) {
        const usage = imageUsage.get(imageUrl) ?? 0;
        if (usage >= 1) {
          imageUrl = "";
          continue;
        }
        imageUsage.set(imageUrl, usage + 1);
        break;
      }
    }

    if (imageUrl) {
      output[index] = {
        ...listing,
        imageUrl
      };
    }
    if (lookupBudget <= 0) {
      break;
    }
  }

  return output;
}

function withMarkup(listings: MarketListing[], markupPercent: number) {
  return listings.map((listing) => {
    const basePrice = Number.isFinite(listing.basePrice) ? listing.basePrice : listing.price;
    return {
      ...listing,
      basePrice: normalizeMoney(basePrice),
      price: applyMarkup(basePrice, markupPercent)
    };
  });
}

function buildSupplierQueryVariants(query: string, options: SearchOptions = {}) {
  const normalized = query.trim();
  const variants = new Set<string>();
  const hasScope = Boolean(options.game?.trim() || options.category?.trim());
  const hasActiveSupplierFilters = Object.values(options.supplierFilters ?? {}).some(
    (value) => String(value ?? "").trim().length > 0
  );
  const maxVariants = normalized
    ? hasActiveSupplierFilters
      ? Math.min(4, SUPPLIER_MAX_QUERY_VARIANTS)
      : SUPPLIER_MAX_QUERY_VARIANTS
    : 1;
  const addVariant = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    variants.add(trimmed);
  };
  const tokenize = (value: string) =>
    Array.from(
      new Set(
        value
          .toLowerCase()
          .split(/[^a-z0-9а-яё]+/gi)
          .map((token) => token.trim())
          .filter((token) => token.length >= 2)
      )
    );
  const addTokenizedVariants = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    addVariant(trimmed);
    const tokens = tokenize(trimmed);
    if (tokens.length > 0) {
      addVariant(tokens.join(" "));
    }
    for (const token of tokens) {
      if (token.length >= 3) {
        addVariant(token);
      }
    }
    for (let index = 0; index < tokens.length - 1; index += 1) {
      const pair = `${tokens[index]} ${tokens[index + 1]}`.trim();
      if (pair.length >= 4) {
        addVariant(pair);
      }
    }
  };
  const parseMultiValue = (raw: string | undefined) =>
    (raw ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  if (normalized) {
    addTokenizedVariants(normalized);
  }

  const inferredIntent = detectQueryIntent(normalized);
  if (inferredIntent) {
    addVariant(inferredIntent);
    for (const alias of QUERY_INTENT_ALIASES[inferredIntent] ?? []) {
      addVariant(alias);
    }
  }

  const supplierFilters = options.supplierFilters ?? {};
  const hasFortniteFilterKeys = Object.keys(supplierFilters).some((key) =>
    key.startsWith("fortnite_")
  );
  const scopeText = `${options.game ?? ""} ${options.category ?? ""}`.toLowerCase();
  const isFortniteScope = hasFortniteFilterKeys || scopeText.includes("fortnite");
  let fortniteSelectedTerms: string[] = [];
  let fortniteSelectedTermCount = 0;

  if (isFortniteScope) {
    const selectedTerms = [
      ...parseMultiValue(supplierFilters.fortnite_outfits),
      ...parseMultiValue(supplierFilters.fortnite_pickaxes),
      ...parseMultiValue(supplierFilters.fortnite_emotes),
      ...parseMultiValue(supplierFilters.fortnite_gliders)
    ]
      .map((term) => term.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 26);
    fortniteSelectedTerms = selectedTerms;
    fortniteSelectedTermCount = selectedTerms.length;

    for (const term of selectedTerms) {
      addTokenizedVariants(term);
      addVariant(`fortnite ${term}`);
      addVariant(`${term} fortnite`);
      const normalizedSelectorAlias = term
        .replace(/^(?:cid|character|eid|glider)_/i, "")
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (normalizedSelectorAlias && normalizedSelectorAlias.toLowerCase() !== term.toLowerCase()) {
        addTokenizedVariants(normalizedSelectorAlias);
        addVariant(`fortnite ${normalizedSelectorAlias}`);
      }
    }

    if (!normalized && selectedTerms.length === 0) {
      // Fortnite category browse with no text query must stay broad.
      // Forcing "fortnite" as keyword can collapse results to zero on supplier side.
      return [""];
    }
  }

  if (isFortniteScope && fortniteSelectedTermCount > 0) {
    // When Fortnite native selector params are present, avoid keyword-based narrowing.
    // Let supplier-side selector params drive matching and keep one broad fallback query.
    if (normalized) {
      return [normalized, ""];
    }
    return [""];
  }

  if (!normalized) {
    const finalizedEmpty = Array.from(variants).filter(Boolean);
    if (finalizedEmpty.length > 0) {
      return finalizedEmpty.slice(0, SUPPLIER_MAX_QUERY_VARIANTS);
    }
    return [""];
  }

  if (variants.size === 0) {
    return [""];
  }

  const finalized = Array.from(variants).filter(Boolean);
  if (hasScope && normalized) {
    const scoped = finalized.slice(0, 2);
    // In scoped mode with active filters, keep one broad fallback query to avoid
    // false empty pages from strict text matching (especially on price_asc).
    if (hasActiveSupplierFilters) {
      return Array.from(new Set([...scoped, ""]));
    }
    return scoped;
  }
  return finalized.slice(0, maxVariants);
}

export async function searchListings(query: string, options: SearchOptions = {}): Promise<SearchResult> {
  const store = await readStore();
  const markupMultiplier = 1 + store.settings.markupPercent / 100;
  const endpoint = getSearchEndpoint();
  const trimmedQuery = query.trim();
  const explicitScope = Boolean(options.game?.trim() || options.category?.trim());
  const inferredScope = !explicitScope ? detectQueryIntent(trimmedQuery) : "";
  const effectiveOptions: SearchOptions = inferredScope
    ? {
        ...options,
        game: options.game?.trim() ? options.game : inferredScope
      }
    : options;
  const fortniteSelectorFilterKeys = new Set([
    "fortnite_outfits",
    "fortnite_pickaxes",
    "fortnite_emotes",
    "fortnite_gliders"
  ]);
  let resolvedSupplierFilters = { ...(effectiveOptions.supplierFilters ?? {}) };
  let disableNativeFortniteSelectorParams = Boolean(options.disableNativeFortniteSelectorParams);
  const hasFortniteSelectorInput = Object.entries(resolvedSupplierFilters).some(
    ([key, value]) =>
      fortniteSelectorFilterKeys.has(key) && String(value ?? "").trim().length > 0
  );
  if (
    ENABLE_NATIVE_FORTNITE_SELECTOR_PARAMS &&
    !disableNativeFortniteSelectorParams &&
    hasFortniteSelectorInput
  ) {
    let resolution:
      | {
          filters: Record<string, string>;
          hadLookupData: boolean;
        }
      | null = null;
    try {
      resolution = await resolveFortniteSelectorFiltersWithMeta(resolvedSupplierFilters);
    } catch {
      resolution = null;
    }
    if (resolution) {
      resolvedSupplierFilters = resolution.filters;
    }
    // Keep native selector params whenever lookup data exists.
    // Fallback when lookup data is unavailable or lookup failed.
    if (!resolution || !resolution.hadLookupData) {
      disableNativeFortniteSelectorParams = true;
    }
  }
  const searchOptions: SearchOptions = {
    ...effectiveOptions,
    supplierFilters: resolvedSupplierFilters,
    disableNativeFortniteSelectorParams
  };
  const hasBrowseScope = Boolean(searchOptions.game?.trim() || searchOptions.category?.trim());
  const activeSupplierFilterEntries = Object.entries(searchOptions.supplierFilters ?? {}).filter(
    ([, value]) => String(value ?? "").trim().length > 0
  );
  const hasActiveSupplierFilters = activeSupplierFilterEntries.length > 0;
  const hasNonSelectorSupplierFilters = activeSupplierFilterEntries.some(
    ([key]) => !fortniteSelectorFilterKeys.has(key)
  );
  const hasFortniteSelectorFilters = activeSupplierFilterEntries.some(([key]) =>
    fortniteSelectorFilterKeys.has(key)
  );
  const hasFortniteSelectorOnlyFilters =
    hasActiveSupplierFilters && !hasNonSelectorSupplierFilters;
  const minPriceBase =
    Number.isFinite(options.minPrice ?? NaN) && markupMultiplier > 0
      ? Number(options.minPrice) / markupMultiplier
      : null;
  const maxPriceBase =
    Number.isFinite(options.maxPrice ?? NaN) && markupMultiplier > 0
      ? Number(options.maxPrice) / markupMultiplier
      : null;
  const page = Number.isFinite(options.page ?? NaN) ? Math.max(1, Number(options.page)) : 1;
  const pageSize = Number.isFinite(options.pageSize ?? NaN)
    ? Math.min(60, Math.max(1, Number(options.pageSize)))
    : 15;
  const fetchPageSize = Math.min(80, pageSize + 12);
  const normalizedOptions: SearchOptions = {
    ...searchOptions,
    minPrice: minPriceBase,
    maxPrice: maxPriceBase,
    page,
    pageSize: fetchPageSize
  };
  const hasLocalPriceFilter =
    (Number.isFinite(normalizedOptions.minPrice ?? NaN) &&
      Number(normalizedOptions.minPrice) > 0) ||
    (Number.isFinite(normalizedOptions.maxPrice ?? NaN) &&
      Number(normalizedOptions.maxPrice) > 0);
  const cacheKey = buildSearchResultCacheKey(trimmedQuery, normalizedOptions, store.settings.markupPercent);
  const cachedResult = readSearchResultCache(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }
  const inFlight = inFlightSearches.get(cacheKey);
  if (inFlight) {
    return structuredClone(await inFlight);
  }

  if (!trimmedQuery && !hasBrowseScope) {
    return {
      listings: [],
      hasMore: false,
      page,
      pageSize
    };
  }
  const token = await getLztAccessToken();
  if (!token) {
    throw new Error("LZT_AUTH_MISSING");
  }

  const executeSearch = async (): Promise<SearchResult> => {
    const deadlineAt = Date.now() + SEARCH_EXECUTION_BUDGET_MS;
    const isOutOfBudget = () => Date.now() >= deadlineAt;
    const remainingBudgetMs = () => Math.max(0, deadlineAt - Date.now());
    try {
    const normalizedScopeGame = (searchOptions.game ?? "").trim().toLowerCase();
    const normalizedScopeCategory = (searchOptions.category ?? "").trim().toLowerCase();
    const isRobloxScope = normalizedScopeGame === "roblox" || normalizedScopeCategory === "roblox";
    const hasRobloxFilters = Object.keys(searchOptions.supplierFilters ?? {}).some((key) =>
      key.startsWith("roblox_")
    );
    const fetchFromEndpointForQueries = async (
      endpointTarget: string,
      pageOptions: SearchOptions,
      supplierQueries: string[],
      supplierPages: number[],
      queryLimit: number,
      pageSpanLimit: number
    ) => {
      const normalizedQueries = (
        supplierQueries.length > 0 ? supplierQueries : [""]
      ).slice(0, queryLimit);
      const pageTargets = (
        supplierPages.length > 0 ? supplierPages : [Number(pageOptions.page) || 1]
      ).slice(0, pageSpanLimit);
      const tasks: Array<Promise<MarketListing[]>> = [];
      for (const supplierPage of pageTargets) {
        for (const supplierQuery of normalizedQueries) {
          tasks.push(
            fetchListingsFromEndpoint({
              endpoint: endpointTarget,
              token,
              query: supplierQuery,
              options: {
                ...pageOptions,
                page: supplierPage
              }
            })
          );
        }
      }
      const settled = await Promise.allSettled(tasks);
      return settled
        .filter(
          (entry): entry is PromiseFulfilledResult<MarketListing[]> =>
            entry.status === "fulfilled"
        )
        .flatMap((entry) => entry.value);
    };

    const loadFilteredPage = async (
      targetPage: number,
      broadMode = false,
      supplierQueries: string[] = [trimmedQuery]
    ) => {
      if (isOutOfBudget()) {
        return [] as MarketListing[];
      }
      const pageOptions: SearchOptions = {
        ...normalizedOptions,
        page: targetPage
      };
      const scopedPriceMode = hasBrowseScope && hasLocalPriceFilter;
      const useHeavySupplierCaps = hasNonSelectorSupplierFilters;
      const queryLimit = useHeavySupplierCaps
        ? HEAVY_FILTER_MAX_QUERY_VARIANTS
        : scopedPriceMode
          ? 2
          : SUPPLIER_MAX_QUERY_VARIANTS;
      const pageSpanLimit = useHeavySupplierCaps
        ? HEAVY_FILTER_MAX_PAGE_SPAN
        : scopedPriceMode
          ? 2
          : SUPPLIER_MAX_PAGE_SPAN;
      const supplierPageSpan = Math.min(
        pageSpanLimit,
        hasBrowseScope ? (trimmedQuery ? (scopedPriceMode ? 1 : 2) : 1) : 1
      );
      const supplierPageStart = Math.max(1, (targetPage - 1) * supplierPageSpan + 1);
      const supplierPages = Array.from({ length: supplierPageSpan }, (_, index) => supplierPageStart + index);

      const shouldUsePrimaryEndpoint = !hasBrowseScope || broadMode || explicitScope;
      const primary = shouldUsePrimaryEndpoint
        ? await fetchFromEndpointForQueries(
            endpoint,
            pageOptions,
            supplierQueries,
            supplierPages,
            queryLimit,
            pageSpanLimit
          )
        : [];
      const endpointScope = broadMode
        ? {
            ...searchOptions,
            game: null,
            category: null
          }
        : searchOptions;
      const categoryEndpointLimit = useHeavySupplierCaps
        ? HEAVY_FILTER_MAX_CATEGORY_ENDPOINTS
        : scopedPriceMode
          ? 1
          : SUPPLIER_MAX_CATEGORY_ENDPOINTS;
      const categoryEndpoints = buildCategoryEndpoints(endpoint, endpointScope).slice(0, categoryEndpointLimit);
      const shouldFetchCategoryEndpoints =
        categoryEndpoints.length > 0 &&
        (
          !explicitScope ||
          broadMode ||
          primary.length === 0
        );

      const categoryResultsSettled = shouldFetchCategoryEndpoints
        ? await Promise.allSettled(
            categoryEndpoints.map((categoryEndpoint) =>
              fetchFromEndpointForQueries(
                categoryEndpoint,
                pageOptions,
                supplierQueries,
                supplierPages,
                queryLimit,
                pageSpanLimit
              )
            )
          )
        : [];
      const categoryResults = categoryResultsSettled
        .filter(
          (entry): entry is PromiseFulfilledResult<MarketListing[]> =>
            entry.status === "fulfilled"
        )
        .map((entry) => entry.value);

      const combined = mergeUnique([primary, ...categoryResults].flat());
      return applyLocalFilters(combined, normalizedOptions, trimmedQuery, "pre");
    };

    let activeSupplierQueries = buildSupplierQueryVariants(trimmedQuery, searchOptions);
    let usingEmptySupplierQueryFallback = false;
    let filteredCurrentPage = await loadFilteredPage(
      page,
      false,
      activeSupplierQueries
    );
    let usingBroadFallback = false;
    if (trimmedQuery && !explicitScope) {
      if (filteredCurrentPage.length < pageSize) {
        usingBroadFallback = true;
        const broadScoped = await loadFilteredPage(
          page,
          true,
          activeSupplierQueries
        );
        if (broadScoped.length > filteredCurrentPage.length) {
          filteredCurrentPage = broadScoped;
        }

      }
    }
    if (hasBrowseScope && !trimmedQuery && !explicitScope) {
      const broadScoped = await loadFilteredPage(page, true, activeSupplierQueries);
      if (broadScoped.length > filteredCurrentPage.length) {
        filteredCurrentPage = broadScoped;
        usingBroadFallback = true;
      }

    }
    if (
      trimmedQuery &&
      filteredCurrentPage.length === 0 &&
      hasBrowseScope &&
      !hasActiveSupplierFilters &&
      !explicitScope
    ) {
      const scopeOnly = await loadFilteredPage(page, false, [""]);
      if (scopeOnly.length > 0) {
        filteredCurrentPage = scopeOnly;
        activeSupplierQueries = [""];
        usingEmptySupplierQueryFallback = true;
      } else if (!explicitScope) {
        const broadScopeOnly = await loadFilteredPage(page, true, [""]);
        if (broadScopeOnly.length > 0) {
          filteredCurrentPage = broadScopeOnly;
          activeSupplierQueries = [""];
          usingBroadFallback = true;
          usingEmptySupplierQueryFallback = true;
        }
      }
    }
    const targetStart = (page - 1) * pageSize;
    const targetEnd = targetStart + pageSize;
    const strictFortniteCountFilterKeys = [
      "fortnite_skin_count_min",
      "fortnite_skin_count_max",
      "fortnite_pickaxe_count_min",
      "fortnite_pickaxe_count_max",
      "fortnite_emote_count_min",
      "fortnite_emote_count_max",
      "fortnite_glider_count_min",
      "fortnite_glider_count_max",
      "fortnite_paid_skin_count_min",
      "fortnite_paid_skin_count_max",
      "fortnite_paid_pickaxe_count_min",
      "fortnite_paid_pickaxe_count_max",
      "fortnite_paid_emote_count_min",
      "fortnite_paid_emote_count_max",
      "fortnite_paid_glider_count_min",
      "fortnite_paid_glider_count_max"
    ];
    const hasStrictFortniteCountFilters = strictFortniteCountFilterKeys.some((key) =>
      Boolean(searchOptions.supplierFilters?.[key]?.trim())
    );
    const hasTextQuery = Boolean(trimmedQuery);
    const hasAscendingPriceSort = options.sort === "price_asc";
    const hasFortniteSelectorPriceAsc = hasFortniteSelectorFilters && hasAscendingPriceSort;
    const requiresDeepCandidateScan =
      hasActiveSupplierFilters || hasLocalPriceFilter || hasTextQuery || hasAscendingPriceSort;
    const requiredAggregatedSize = requiresDeepCandidateScan
      ? isRobloxScope && hasRobloxFilters
        ? Math.min(5200, Math.max(targetEnd + pageSize * 180, 1800))
        : hasFortniteSelectorPriceAsc
          ? Math.min(2600, Math.max(targetEnd + pageSize * 110, 1200))
        : hasFortniteSelectorFilters
          ? Math.min(1600, Math.max(targetEnd + pageSize * 48, 700))
          : hasStrictFortniteCountFilters
            ? Math.min(20000, Math.max(targetEnd + pageSize * 460, 9000))
            : hasAscendingPriceSort
              ? Math.min(6400, Math.max(targetEnd + pageSize * 220, 2600))
              : hasTextQuery
                ? Math.min(1800, Math.max(targetEnd + pageSize * 80, 600))
                : Math.min(900, Math.max(targetEnd + pageSize * (hasLocalPriceFilter ? 12 : 16), 260))
      : targetEnd + 1;
    const aggregated: MarketListing[] = [];
    const seenIds = new Set<string>();
    const preloadedByLogicalPage = new Map<number, MarketListing[]>([[page, filteredCurrentPage]]);
    const pushChunkUnique = (chunk: MarketListing[]) => {
      for (const item of chunk) {
        if (!item.id) {
          continue;
        }
        const normalizedId = item.id.trim().toLowerCase();
        if (seenIds.has(normalizedId)) {
          continue;
        }
        seenIds.add(normalizedId);
        aggregated.push(item);
      }
    };

    let logicalCursor = 1;
    const maxLogicalPages = requiresDeepCandidateScan
      ? hasLocalPriceFilter || hasAscendingPriceSort
        ? Math.max(page + 40, PRICE_FILTER_MAX_LOGICAL_PAGES)
        : isRobloxScope && hasRobloxFilters
          ? Math.max(page + 45, 80)
        : hasStrictFortniteCountFilters
          ? Math.max(page + 90, 160)
        : hasNonSelectorSupplierFilters
          ? Math.max(page + 6, HEAVY_FILTER_MAX_LOGICAL_PAGES)
        : hasFortniteSelectorPriceAsc
            ? Math.max(page + 20, 40)
        : hasFortniteSelectorOnlyFilters
            ? Math.max(page + 4, 10)
            : Math.max(page + 4, SUPPLIER_MAX_LOGICAL_PAGES)
      : Math.max(page + 4, SUPPLIER_MAX_LOGICAL_PAGES);
    let consecutiveEmpty = 0;

    while (
      logicalCursor <= maxLogicalPages &&
      aggregated.length < requiredAggregatedSize &&
      !isOutOfBudget()
    ) {
      let chunk = preloadedByLogicalPage.get(logicalCursor);
      if (!chunk) {
        chunk = await loadFilteredPage(
          logicalCursor,
          usingBroadFallback,
          usingEmptySupplierQueryFallback ? [""] : activeSupplierQueries
        );
      }

      if (chunk.length === 0) {
        consecutiveEmpty += 1;
        const allowEarlyStop = !hasLocalPriceFilter && !hasTextQuery;
        if (allowEarlyStop && consecutiveEmpty >= 3 && logicalCursor > page) {
          break;
        }
      } else {
        consecutiveEmpty = 0;
        pushChunkUnique(chunk);
      }

      logicalCursor += 1;
    }

    if (options.sort === "price_asc") {
      aggregated.sort((a, b) => a.basePrice - b.basePrice);
    } else if (options.sort === "price_desc") {
      aggregated.sort((a, b) => b.basePrice - a.basePrice);
    } else if (options.sort === "newest") {
      aggregated.sort((a, b) => b.id.localeCompare(a.id));
    }

    let hasMore = aggregated.length > targetEnd;
    if (!hasMore) {
      const probeLimit = hasStrictFortniteCountFilters ? 5 : hasNonSelectorSupplierFilters ? 1 : 2;
      for (let probeOffset = 0; probeOffset < probeLimit && !isOutOfBudget(); probeOffset += 1) {
        const probePage = logicalCursor + probeOffset;
        const probeChunk = await loadFilteredPage(
          probePage,
          usingBroadFallback,
          usingEmptySupplierQueryFallback ? [""] : activeSupplierQueries
        );
        if (probeChunk.length === 0) {
          continue;
        }

        const beforeCount = aggregated.length;
        pushChunkUnique(probeChunk);
        if (aggregated.length > beforeCount) {
          if (options.sort === "price_asc") {
            aggregated.sort((a, b) => a.basePrice - b.basePrice);
          } else if (options.sort === "price_desc") {
            aggregated.sort((a, b) => b.basePrice - a.basePrice);
          } else if (options.sort === "newest") {
            aggregated.sort((a, b) => b.id.localeCompare(a.id));
          }

          hasMore = aggregated.length > targetEnd;
          if (hasMore) {
            break;
          }
        }
      }
    }
    const needsStrictFortniteCountFinalPass = strictFortniteCountFilterKeys.some((key) =>
      Boolean(searchOptions.supplierFilters?.[key]?.trim())
    );
    const needsDeepFilterFinalPass =
      hasActiveSupplierFilters ||
      needsStrictFortniteCountFinalPass ||
      hasLocalPriceFilter ||
      hasAscendingPriceSort;
    const finalPassPoolSize = hasFortniteSelectorPriceAsc
      ? Math.min(2600, Math.max(targetEnd + pageSize * 120, 1300))
      : hasFortniteSelectorFilters
      ? Math.min(1500, Math.max(targetEnd + pageSize * 50, 700))
      : hasStrictFortniteCountFilters
        ? Math.min(18000, Math.max(targetEnd + pageSize * 420, 9000))
      : isRobloxScope && hasRobloxFilters
        ? Math.min(5600, Math.max(targetEnd + pageSize * 200, 2200))
      : hasAscendingPriceSort
        ? Math.min(7600, Math.max(targetEnd + pageSize * 260, 3200))
      : needsDeepFilterFinalPass
        ? Math.min(640, Math.max(targetEnd + pageSize * 24, 260))
        : Math.max(targetEnd + 1, pageSize + 1);
    const finalPassPool = aggregated.slice(0, finalPassPoolSize);
    const baseDetailEnrichmentLimit = hasFortniteSelectorPriceAsc
      ? Math.min(finalPassPool.length, 420)
      : hasFortniteSelectorFilters
      ? Math.min(finalPassPool.length, 260)
      : hasStrictFortniteCountFilters
        ? Math.min(finalPassPool.length, 9000)
      : isRobloxScope && hasRobloxFilters
        ? Math.min(finalPassPool.length, 1800)
      : hasAscendingPriceSort
        ? Math.min(finalPassPool.length, 800)
      : needsDeepFilterFinalPass
        ? Math.min(finalPassPool.length, 140)
        : 24;
    const detailEnrichmentLimit =
      remainingBudgetMs() < 1200
        ? Math.min(baseDetailEnrichmentLimit, 24)
        : remainingBudgetMs() < 2500
          ? Math.min(baseDetailEnrichmentLimit, 80)
          : baseDetailEnrichmentLimit;
    const enriched = await enrichListingsWithDetails(
      finalPassPool,
      token,
      detailEnrichmentLimit,
      hasFortniteSelectorFilters
    );
    const finalFiltered = applyLocalFilters(enriched, normalizedOptions, trimmedQuery, "final");
    const uniqueFinal = mergeUnique(finalFiltered);
    if (options.sort === "price_asc") {
      uniqueFinal.sort((a, b) => a.basePrice - b.basePrice);
    } else if (options.sort === "price_desc") {
      uniqueFinal.sort((a, b) => b.basePrice - a.basePrice);
    } else if (options.sort === "newest") {
      uniqueFinal.sort((a, b) => b.id.localeCompare(a.id));
    }
    const finalWindow = uniqueFinal.slice(targetStart, targetEnd);
    const finalHasMore =
      uniqueFinal.length > targetEnd ||
      (hasFortniteSelectorFilters && hasMore) ||
      (!needsDeepFilterFinalPass && hasMore && finalWindow.length >= pageSize);
    const displayTranslated =
      remainingBudgetMs() < 900 ? finalWindow : await translateListingsToEnglish(finalWindow);
    const displayWithSharedImages = applySharedImageFallback(displayTranslated, trimmedQuery);
    const displayWithFortniteApiImages =
      remainingBudgetMs() < 700
        ? displayWithSharedImages
        : await enrichFortniteListingImages(displayWithSharedImages);
    const diversified = withFortniteImageDiversity(displayWithFortniteApiImages);
    const pagedListings = withMarkup(diversified, store.settings.markupPercent);
    const result: SearchResult = {
      listings: pagedListings,
      hasMore: finalHasMore,
      page,
      pageSize
    };
    if (
      hasFortniteSelectorFilters &&
      !Boolean(normalizedOptions.disableNativeFortniteSelectorParams)
    ) {
      const shouldFallbackFromStrictNativeSelector =
        result.listings.length === 0 ||
        (page === 1 &&
          !result.hasMore &&
          result.listings.length < Math.min(pageSize, 5));

      if (shouldFallbackFromStrictNativeSelector) {
        // Native selector params can under-report results when seller data is incomplete.
        // Retry with native params disabled and keep the richer result set.
        const fallback = await searchListings(query, {
          ...options,
          disableNativeFortniteSelectorParams: true
        });
        if (fallback.listings.length > result.listings.length || fallback.hasMore) {
          return fallback;
        }
      }
    }
    writeSearchResultCache(cacheKey, result);
    return result;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("LZT_AUTH_")) {
        throw error;
      }
      const staleResult = readSearchResultCache(cacheKey, true);
      if (staleResult) {
        return staleResult;
      }
      return {
        listings: [],
        hasMore: false,
        page,
        pageSize
      };
    }
  };

  if (!cacheKey) {
    return executeSearch();
  }

  const running = executeSearch();
  inFlightSearches.set(cacheKey, running);
  try {
    return structuredClone(await running);
  } finally {
    inFlightSearches.delete(cacheKey);
  }
}

export async function getListingById(listingId: string) {
  const listingIdTrimmed = listingId.trim();
  if (!listingIdTrimmed) {
    return null;
  }

  const token = await getLztAccessToken();
  const store = await readStore();

  if (token) {
    try {
      const mapped = await fetchListingDetailFromApi(listingIdTrimmed, token);
      if (mapped) {
        const [translated] = await translateListingsToEnglish([mapped]);
        const [withFortniteImage] = await enrichFortniteListingImages([translated]);
        const ready = withFortniteImage ?? translated;
        if (!ready.id || ready.basePrice <= 0) {
          throw new Error("INVALID_DETAIL_PAYLOAD");
        }
        return {
          ...ready,
          price: applyMarkup(ready.basePrice, store.settings.markupPercent)
        };
      }
    } catch (error) {
      if (error instanceof Error && error.message === "BLOCKED_LISTING") {
        return null;
      }
      return fallbackById(listingIdTrimmed, store.settings.markupPercent);
    }
  }

  return fallbackById(listingIdTrimmed, store.settings.markupPercent);
}

export async function buyFromSupplier(listingId: string) {
  const encodedId = encodeURIComponent(listingId);
  const primaryEndpoint = getPurchaseEndpoint(listingId);
  const canonicalEndpoint = `${getLztBaseUrl()}/${encodedId}/fast-buy`;
  const endpoints = Array.from(new Set([primaryEndpoint, canonicalEndpoint]));
  const token = await getLztAccessToken();

  if (!token) {
    const simulatedDelivery = {
      accountUsername: `account_${Math.floor(Math.random() * 90000 + 10000)}`,
      accountPassword: randomReadableSecret(),
      accountEmail: null,
      notes: "Delivered automatically"
    };
    return {
      supplierOrderId: `sim_${listingId}_${Date.now()}`,
      delivery: {
        ...simulatedDelivery,
        rawSupplierPayload: JSON.stringify(simulatedDelivery, null, 2),
        deliveredItems: buildDeliveredItems(simulatedDelivery)
      }
    };
  }

  const payloadVariants: Array<Record<string, string> | null> = [
    null,
    { item_id: listingId },
    { listing_id: listingId },
    { listingId }
  ];
  const extractSupplierErrorMessage = (parsed: Record<string, unknown>, responseText: string) => {
    const nestedData =
      parsed.data && typeof parsed.data === "object"
        ? (parsed.data as Record<string, unknown>)
        : null;
    const fromStructured = extractText(
      parsed.error ??
        parsed.message ??
        parsed.detail ??
        parsed.errors ??
        nestedData?.error ??
        nestedData?.message ??
        nestedData?.detail ??
        nestedData?.errors,
      ""
    );
    if (fromStructured) {
      return fromStructured;
    }
    const fromBody = extractText(responseText, "");
    return fromBody || "Supplier purchase failed";
  };
  let data: Record<string, unknown> | null = null;
  let lastErrorMessage = "Supplier purchase failed";

  for (const endpoint of endpoints) {
    for (const payload of payloadVariants) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      };
      const requestInit: RequestInit = {
        method: "POST",
        headers,
        cache: "no-store"
      };
      if (payload) {
        headers["Content-Type"] = "application/json";
        requestInit.body = JSON.stringify(payload);
      }

      const response = await fetch(endpoint, requestInit);
      const responseText = await response.text();
      let parsed: Record<string, unknown> = {};
      if (responseText) {
        try {
          parsed = JSON.parse(responseText) as Record<string, unknown>;
        } catch {
          parsed = {};
        }
      }

      if (!response.ok) {
        lastErrorMessage = extractSupplierErrorMessage(parsed, responseText);
        const loweredResponseText = responseText.toLowerCase();
        if (
          loweredResponseText.includes("_dfjs/b.js") ||
          loweredResponseText.includes("cloudflare") ||
          loweredResponseText.includes("captcha")
        ) {
          lastErrorMessage = `Supplier protection triggered: ${lastErrorMessage}`;
        }
        continue;
      }

      const statusText = extractText(parsed.status, "").toLowerCase();
      const explicitError = extractSupplierErrorMessage(parsed, responseText);
      const plainText = responseText.trim().toLowerCase();
      const hasParsedPayload = Object.keys(parsed).length > 0;
      const hasSupplierErrorsArray = Array.isArray(parsed.errors) && parsed.errors.length > 0;
      const successFlag =
        parsed.success === false ||
        parsed.success === 0 ||
        extractText(parsed.success, "").toLowerCase() === "false" ||
        extractText(parsed.success, "").toLowerCase() === "0";
      const plainTextFailure =
        !hasParsedPayload &&
        Boolean(plainText) &&
        /(recently purchased|wait before purchasing again|purchase failed|error|failed|insufficient|not enough)/i.test(
          plainText
        );
      const explicitFailure =
        statusText === "failed" ||
        statusText === "error" ||
        successFlag ||
        hasSupplierErrorsArray ||
        Boolean(explicitError && (statusText === "failed" || statusText === "error")) ||
        plainTextFailure;

      if (explicitFailure) {
        lastErrorMessage = explicitError || "Supplier purchase failed";
        if (
          plainText.includes("_dfjs/b.js") ||
          plainText.includes("cloudflare") ||
          plainText.includes("captcha")
        ) {
          lastErrorMessage = `Supplier protection triggered: ${lastErrorMessage}`;
        }
        continue;
      }

      data = parsed;
      break;
    }
    if (data) {
      break;
    }
  }

  if (!data) {
    throw new Error(lastErrorMessage);
  }

  const deliverySource =
    data.delivery && typeof data.delivery === "object"
      ? ((data.delivery as Record<string, unknown>) ?? {})
      : data;

  const accountUsername = extractText(
    deliverySource.username ??
      deliverySource.login ??
      deliverySource.account_username ??
      deliverySource.accountUsername ??
      data.username ??
      data.login,
    ""
  );
  const accountPassword = extractText(
    deliverySource.password ??
      deliverySource.pass ??
      deliverySource.account_password ??
      deliverySource.accountPassword ??
      data.password ??
      data.pass,
    ""
  );
  const accountEmailRaw =
    deliverySource.email ??
    deliverySource.mail ??
    deliverySource.account_email ??
    deliverySource.accountEmail ??
    data.email ??
    data.mail;
  const notes = extractText(
    deliverySource.note ??
      deliverySource.notes ??
      deliverySource.comment ??
      deliverySource.additional ??
      data.note ??
      data.notes,
    ""
  );

  const deliveredItems = buildDeliveredItems(deliverySource);

  return {
    supplierOrderId: extractText(data.orderId ?? data.id, `ord_${Date.now()}`),
    delivery: {
      accountUsername,
      accountPassword,
      accountEmail: accountEmailRaw == null ? null : extractText(accountEmailRaw),
      notes: notes || null,
      rawSupplierPayload: JSON.stringify(data, null, 2),
      deliveredItems
    }
  };
}

function formatDeliveryLabel(path: string) {
  return path
    .replace(/\[(\d+)\]/g, " $1 ")
    .replace(/[._-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toDeliveryValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const flattened = value
      .map((entry) => toDeliveryValue(entry))
      .filter(Boolean)
      .join(" | ");
    return flattened;
  }
  if (typeof value === "object") {
    try {
      const serialized = JSON.stringify(value);
      return serialized.length > 1500 ? `${serialized.slice(0, 1500)}...` : serialized;
    } catch {
      return "";
    }
  }
  return "";
}

function collectDeliveryFields(
  value: unknown,
  path: string,
  output: Array<{ label: string; value: string }>,
  depth: number
) {
  if (value == null || depth > 4 || output.length >= 80) {
    return;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    const normalized = toDeliveryValue(value);
    if (!normalized) {
      return;
    }
    const label = formatDeliveryLabel(path || "value");
    if (!output.some((item) => item.label === label && item.value === normalized)) {
      output.push({ label, value: normalized });
    }
    return;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectDeliveryFields(value[index], `${path}[${index}]`, output, depth + 1);
    }
    return;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const [key, entry] of Object.entries(record)) {
      if (!key) {
        continue;
      }
      const nextPath = path ? `${path}.${key}` : key;
      collectDeliveryFields(entry, nextPath, output, depth + 1);
      if (output.length >= 80) {
        break;
      }
    }
  }
}

function buildDeliveredItems(source: Record<string, unknown>) {
  const items: Array<{ label: string; value: string }> = [];
  collectDeliveryFields(source, "", items, 0);
  return items;
}

function randomReadableSecret() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let output = "";
  for (let index = 0; index < 14; index += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

function fallbackById(listingId: string, markupPercent: number) {
  const local = fallbackListings.find((item) => item.id === listingId);
  if (!local) {
    return null;
  }
  return {
    ...local,
    price: applyMarkup(local.basePrice, markupPercent)
  };
}
