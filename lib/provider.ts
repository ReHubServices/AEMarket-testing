import { fallbackListings } from "@/lib/market";
import { getLztAccessToken } from "@/lib/lzt-auth";
import { applyMarkup } from "@/lib/pricing";
import { readStore } from "@/lib/store";
import { MarketListing } from "@/lib/types";

export type SearchSort = "relevance" | "price_asc" | "price_desc" | "newest";

export type SearchOptions = {
  sort?: SearchSort;
  minPrice?: number | null;
  maxPrice?: number | null;
};

const translationCache = new Map<string, string>();
const DEFAULT_LISTING_IMAGE = "/listing-placeholder.svg";

function getLztBaseUrl() {
  const raw = (process.env.LZT_API_BASE_URL ?? "https://prod-api.lzt.market").trim();
  return raw.replace(/\/+$/, "");
}

function getSearchEndpoint() {
  return (
    process.env.LZT_API_SEARCH_URL ??
    process.env.SUPPLIER_API_SEARCH_URL ??
    `${getLztBaseUrl()}/`
  );
}

function getItemEndpointBase() {
  return (
    process.env.LZT_API_ITEM_URL ??
    process.env.SUPPLIER_API_ITEM_URL ??
    getLztBaseUrl()
  );
}

function getPurchaseEndpoint(listingId: string) {
  const configured = process.env.LZT_API_PURCHASE_URL ?? process.env.SUPPLIER_API_PURCHASE_URL;
  if (configured?.includes("{item_id}")) {
    return configured.replace("{item_id}", encodeURIComponent(listingId));
  }
  if (configured) {
    return configured;
  }
  return `${getLztBaseUrl()}/${encodeURIComponent(listingId)}/fast-buy`;
}

function normalizeEndpoint(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
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
      "ru",
      "en",
      "username",
      "user_name",
      "login",
      "value",
      "label",
      "text",
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

function extractNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, "").replace(",", ".").replace(/[^\d.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidates = [record.amount, record.value, record.price, record.sum];
    for (const candidate of candidates) {
      const parsed: number = extractNumber(candidate);
      if (parsed > 0) {
        return parsed;
      }
    }
  }
  return 0;
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

function mapRawListing(item: Record<string, unknown>): MarketListing {
  const source = unwrapListingNode(item);
  const basePrice = extractNumber(
    source.price ?? source.amount ?? source.price_rub ?? source.currency_price ?? source.cost
  );
  const id = extractText(source.id ?? source.item_id ?? source.itemId ?? source.listing_id ?? "");
  const title = extractText(
    source.title ?? source.item_title ?? source.name ?? source.heading,
    "Untitled listing"
  );
  const imageUrl = extractImageUrl(source);
  const game = extractText(source.game ?? source.category_name ?? source.category, "Game Account");
  const category = extractText(source.category ?? source.platform, "Account");
  const description = extractDescription(source) || "No description provided for this listing.";

  return {
    id,
    title,
    imageUrl,
    price: basePrice,
    basePrice,
    currency: extractCurrency(source),
    game,
    category,
    seller: "Verified Seller",
    rating: extractNumber(source.rating ?? 4.7),
    description
  };
}

function unwrapListingNode(item: Record<string, unknown>) {
  const nestedCandidates = [
    item.item,
    item.account,
    item.listing,
    item.data,
    item.result
  ];
  for (const candidate of nestedCandidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }
  return item;
}

function extractImageUrl(item: Record<string, unknown>) {
  const directCandidates = [
    item.image,
    item.image_url,
    item.imageUrl,
    item.avatar,
    item.avatar_url,
    item.img,
    item.cover,
    item.cover_url,
    item.preview,
    item.preview_url,
    item.photo,
    item.icon
  ];
  for (const candidate of directCandidates) {
    const url = extractText(candidate, "");
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/")) {
      return url;
    }
  }

  const arrayCandidates = [item.photos, item.images, item.media, item.gallery];
  for (const candidate of arrayCandidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      for (const entry of candidate) {
        const url = extractText(entry, "");
        if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/")) {
          return url;
        }
        if (entry && typeof entry === "object") {
          const record = entry as Record<string, unknown>;
          const nestedUrl = extractText(
            record.url ?? record.src ?? record.image ?? record.preview,
            ""
          );
          if (
            nestedUrl.startsWith("http://") ||
            nestedUrl.startsWith("https://") ||
            nestedUrl.startsWith("/")
          ) {
            return nestedUrl;
          }
        }
      }
    }
  }

  return DEFAULT_LISTING_IMAGE;
}

function extractCurrency(item: Record<string, unknown>) {
  const currencyRaw = extractText(item.currency ?? item.currency_code ?? item.curr, "USD");
  if (!currencyRaw) {
    return "USD";
  }
  if (currencyRaw.includes("₽") || currencyRaw.toLowerCase() === "rub") {
    return "RUB";
  }
  if (currencyRaw.includes("$") || currencyRaw.toLowerCase() === "usd") {
    return "USD";
  }
  return currencyRaw.toUpperCase();
}

function extractDescription(item: Record<string, unknown>) {
  const direct = extractText(
    item.description ??
      item.short_description ??
      item.item_description ??
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
    item.details
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

  return "";
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function buildSearchUrl(endpoint: string, query: string) {
  const url = new URL(normalizeEndpoint(endpoint));
  url.searchParams.set("title", query);
  url.searchParams.set("order_by", "pdate_to_down");
  url.searchParams.set("page", "1");
  return url.toString();
}

async function fetchListingsFromEndpoint(input: {
  endpoint: string;
  token: string;
  query: string;
}) {
  const response = await fetch(buildSearchUrl(input.endpoint, input.query), {
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("LZT_AUTH_FAILED");
  }
  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as unknown;
  return extractItems(data)
    .map((entry) => mapRawListing(entry))
    .filter(
      (listing) =>
        Boolean(listing.id) &&
        listing.basePrice > 0 &&
        listing.title.toLowerCase() !== "untitled listing"
    );
}

async function fetchListingDetailFromApi(listingId: string, token: string) {
  const endpoint = getItemEndpointBase();

  try {
    const response = await fetch(`${endpoint}/${encodeURIComponent(listingId)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      },
      cache: "no-store"
    });
    if (!response.ok) {
      return null;
    }

    const raw = (await response.json()) as Record<string, unknown>;
    const fromArray = extractItems(raw);
    const mapped = mapRawListing(fromArray[0] ?? raw);
    if (!mapped.id) {
      mapped.id = listingId;
    }
    return mapped;
  } catch {
    return null;
  }
}

function buildCategoryEndpoints(baseEndpoint: string) {
  const custom = (process.env.LZT_CATEGORY_ENDPOINTS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const defaults = [
    "steam",
    "fortnite",
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
    "chatgpt",
    "battlenet",
    "vpn",
    "roblox",
    "warface",
    "hytale"
  ];

  const categories = custom.length > 0 ? custom : defaults;
  const root = normalizeEndpoint(baseEndpoint);

  return Array.from(
    new Set(
      categories.map((category) =>
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
    if (!byId.has(listing.id)) {
      byId.set(listing.id, listing);
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
  const normalized = url.trim().toLowerCase();
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
  return normalized.startsWith("http://") || normalized.startsWith("https://");
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
    game: detail.game || base.game,
    category: detail.category || base.category,
    currency: detail.currency || base.currency,
    basePrice: detail.basePrice > 0 ? detail.basePrice : base.basePrice,
    price: detail.price > 0 ? detail.price : base.price,
    rating: detail.rating > 0 ? detail.rating : base.rating
  };
}

async function enrichListingsWithDetails(listings: MarketListing[], token: string) {
  const maxEnrichment = 24;
  const output = listings.slice();
  const candidates = output
    .slice(0, maxEnrichment)
    .filter(
      (listing) =>
        !hasRealDescription(listing.description) || !hasRealImage(listing.imageUrl)
    );

  if (candidates.length === 0) {
    return output;
  }

  const details = await Promise.all(
    candidates.map((listing) => fetchListingDetailFromApi(listing.id, token))
  );

  const detailById = new Map<string, MarketListing>();
  for (const detail of details) {
    if (detail?.id) {
      detailById.set(detail.id, detail);
    }
  }

  return output.map((listing) => mergeListing(listing, detailById.get(listing.id) ?? null));
}

function applyLocalFilters(listings: MarketListing[], options: SearchOptions) {
  let output = listings.slice();

  if (Number.isFinite(options.minPrice ?? NaN)) {
    output = output.filter((item) => item.basePrice >= Number(options.minPrice));
  }
  if (Number.isFinite(options.maxPrice ?? NaN)) {
    output = output.filter((item) => item.basePrice <= Number(options.maxPrice));
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
    category: translations.get(listing.category) ?? listing.category
  }));
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

export async function searchListings(query: string, options: SearchOptions = {}) {
  const store = await readStore();
  const endpoint = getSearchEndpoint();
  const token = await getLztAccessToken();
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [];
  }
  if (!token) {
    throw new Error("LZT_AUTH_MISSING");
  }

  try {
    const primary = await fetchListingsFromEndpoint({ endpoint, token, query: trimmedQuery });
    const categoryEndpoints = buildCategoryEndpoints(endpoint);
    const categoryResults = await Promise.all(
      categoryEndpoints.map((categoryEndpoint) =>
        fetchListingsFromEndpoint({ endpoint: categoryEndpoint, token, query: trimmedQuery })
      )
    );

    const combined = mergeUnique([primary, ...categoryResults].flat());
    const filtered = applyLocalFilters(combined, options).slice(0, 80);
    const enriched = await enrichListingsWithDetails(filtered, token);
    const translated = await translateListingsToEnglish(enriched);
    return withMarkup(translated, store.settings.markupPercent).slice(0, 60);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("LZT_AUTH_")) {
      throw error;
    }
    return [];
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
        if (!translated.id || translated.basePrice <= 0) {
          throw new Error("INVALID_DETAIL_PAYLOAD");
        }
        return {
          ...translated,
          price: applyMarkup(translated.basePrice, store.settings.markupPercent)
        };
      }
    } catch {
      return fallbackById(listingIdTrimmed, store.settings.markupPercent);
    }
  }

  return fallbackById(listingIdTrimmed, store.settings.markupPercent);
}

export async function buyFromSupplier(listingId: string) {
  const endpoint = getPurchaseEndpoint(listingId);
  const token = await getLztAccessToken();

  if (!token) {
    return {
      supplierOrderId: `sim_${listingId}_${Date.now()}`,
      delivery: {
        accountUsername: `account_${Math.floor(Math.random() * 90000 + 10000)}`,
        accountPassword: randomReadableSecret(),
        accountEmail: null,
        notes: "Delivered automatically"
      }
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ listingId })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Supplier purchase failed");
  }

  const data = (await response.json()) as Record<string, unknown>;
  return {
    supplierOrderId: extractText(data.orderId ?? data.id, `ord_${Date.now()}`),
    delivery: {
      accountUsername: extractText(data.username ?? data.login, ""),
      accountPassword: extractText(data.password, ""),
      accountEmail: data.email == null ? null : extractText(data.email),
      notes: data.note == null ? null : extractText(data.note)
    }
  };
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
