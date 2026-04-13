import { fallbackListings } from "@/lib/market";
import { getLztAccessToken } from "@/lib/lzt-auth";
import { applyMarkup } from "@/lib/pricing";
import { readStore } from "@/lib/store";
import { MarketListing, MarketListingSpec } from "@/lib/types";

export type SearchSort = "relevance" | "price_asc" | "price_desc" | "newest";

export type SearchOptions = {
  sort?: SearchSort;
  minPrice?: number | null;
  maxPrice?: number | null;
  game?: string | null;
  category?: string | null;
  hasImage?: boolean;
  hasDescription?: boolean;
  hasSpecs?: boolean;
  supplierFilters?: Record<string, string>;
};

const translationCache = new Map<string, string>();
const DEFAULT_LISTING_IMAGE = "/listing-placeholder.svg";
const BLOCKED_MARKET_LINK_PATTERN =
  /(?:https?:\/\/|www\.)[^\s\]]*(?:lzt\.market|lolz\.guru)|\[url[^\]]*=(?:https?:\/\/)?(?:www\.)?(?:lzt\.market|lolz\.guru)[^\]]*\]|\b(?:lzt\.market|lolz\.guru)\b/i;

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
  const source = buildListingSource(item);
  const basePrice = extractNumber(
    source.price ?? source.amount ?? source.price_rub ?? source.currency_price ?? source.cost
  );
  const id = extractText(source.id ?? source.item_id ?? source.itemId ?? source.listing_id ?? "");
  const title = extractText(
    source.title ?? source.item_title ?? source.name ?? source.heading,
    "Untitled listing"
  );
  const imageUrl = extractImageUrl(source);
  const game = resolveGameLabel(source);
  const category = resolveCategoryLabel(source, game);
  const specs = extractSpecs(source);
  const description =
    extractDescription(source) ||
    (specs.length > 0 ? "Structured details are available below." : "Details available in listing");

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
      return {
        ...item,
        ...(candidate as Record<string, unknown>)
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
  if (raw.startsWith("/")) {
    return `${getLztBaseUrl()}${raw}`;
  }
  return "";
}

function extractImageUrlFromText(value: string) {
  const text = value.trim();
  if (!text) {
    return "";
  }

  const bbCodeMatch = text.match(/\[img(?:=[^\]]*)?\]\s*([^\s\]]+)\s*\[\/img\]/i);
  if (bbCodeMatch?.[1]) {
    const normalized = normalizeImageUrl(bbCodeMatch[1]);
    if (normalized) {
      return normalized;
    }
  }

  const markdownMatch = text.match(/!\[[^\]]*]\(([^)\s]+)\)/i);
  if (markdownMatch?.[1]) {
    const normalized = normalizeImageUrl(markdownMatch[1]);
    if (normalized) {
      return normalized;
    }
  }

  const urlMatches = text.match(/(?:https?:\/\/|\/\/)[^\s"'<>)\]]+/gi) ?? [];
  for (const url of urlMatches) {
    const normalized = normalizeImageUrl(url);
    if (!normalized) {
      continue;
    }
    const lower = normalized.toLowerCase();
    if (
      lower.includes(".jpg") ||
      lower.includes(".jpeg") ||
      lower.includes(".png") ||
      lower.includes(".webp") ||
      lower.includes(".gif") ||
      lower.includes(".bmp") ||
      lower.includes(".avif")
    ) {
      return normalized;
    }
  }

  return "";
}

function pickImageFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    const fromText = extractImageUrlFromText(value);
    if (fromText) {
      return fromText;
    }
    const normalized = normalizeImageUrl(value);
    return normalized;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = pickImageFromUnknown(entry);
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
      const found = pickImageFromUnknown(record[key]);
      if (found) {
        return found;
      }
    }
  }

  for (const [key, entry] of Object.entries(record)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("image") ||
      lower.includes("img") ||
      lower.includes("photo") ||
      lower.includes("preview") ||
      lower.includes("cover") ||
      lower.includes("thumb") ||
      lower.includes("avatar") ||
      lower.includes("attachment") ||
      lower.includes("media") ||
      lower.includes("gallery")
    ) {
      const found = pickImageFromUnknown(entry);
      if (found) {
        return found;
      }
    }
  }

  return "";
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
    item.attachments,
    item.first_post,
    item.firstPost,
    item.post
  ];
  for (const candidate of arrayCandidates) {
    const found = pickImageFromUnknown(candidate);
    if (found) {
      return found;
    }
  }

  const textCandidates = [
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
    item.text
  ];
  for (const candidate of textCandidates) {
    const found = pickImageFromUnknown(candidate);
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

  return texts.some((text) => BLOCKED_MARKET_LINK_PATTERN.test(text));
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
    item.features
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
    "friends"
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

  return specs.slice(0, 18);
}

function extractDescription(item: Record<string, unknown>) {
  const direct = extractText(
    item.description ??
      item.short_description ??
      item.item_description ??
      item.full_description ??
      item.description_html ??
      item.descriptionHtml ??
      item.post ??
      item.post_body ??
      item.postBody ??
      item.first_post ??
      item.firstPost ??
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

function buildSearchUrl(endpoint: string, query: string, options: SearchOptions) {
  const url = new URL(normalizeEndpoint(endpoint));
  url.searchParams.set("title", query);
  url.searchParams.set("q", query);
  url.searchParams.set("order_by", resolveSupplierSort(options.sort));
  url.searchParams.set("page", "1");

  if (Number.isFinite(options.minPrice ?? NaN)) {
    const min = String(Number(options.minPrice));
    url.searchParams.set("price_from", min);
    url.searchParams.set("pmin", min);
  }
  if (Number.isFinite(options.maxPrice ?? NaN)) {
    const max = String(Number(options.maxPrice));
    url.searchParams.set("price_to", max);
    url.searchParams.set("pmax", max);
  }

  if (options.supplierFilters) {
    for (const [key, value] of Object.entries(options.supplierFilters)) {
      const normalizedKey = key.trim();
      const normalizedValue = value.trim();
      if (!normalizedKey || !normalizedValue) {
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
  const response = await fetch(buildSearchUrl(input.endpoint, input.query, input.options), {
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
    .filter((entry) => !hasBlockedMarketplaceLink(buildListingSource(entry)))
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
    const source = fromArray[0]
      ? {
          ...raw,
          ...fromArray[0]
        }
      : raw;
    if (hasBlockedMarketplaceLink(buildListingSource(source))) {
      throw new Error("BLOCKED_LISTING");
    }
    const mapped = mapRawListing(source);
    if (!mapped.id) {
      mapped.id = listingId;
    }
    return mapped;
  } catch (error) {
    if (error instanceof Error && error.message === "BLOCKED_LISTING") {
      throw error;
    }
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

function buildCategoryEndpoints(baseEndpoint: string, options: SearchOptions) {
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
  const requestedCategory = options.category ? toSlug(options.category) : "";
  const requestedGame = options.game ? toSlug(options.game) : "";
  const requested = requestedCategory || requestedGame;
  const narrowedCategories =
    requested.length > 0
      ? categories.filter((item) => {
          const slug = toSlug(item);
          if (!slug) {
            return false;
          }
          if (slug === requested || slug.includes(requested) || requested.includes(slug)) {
            return true;
          }
          if (
            requested.includes("social") &&
            ["instagram", "tiktok", "telegram", "discord", "facebook", "twitter"].some((social) =>
              slug.includes(social)
            )
          ) {
            return true;
          }
          return false;
        })
      : categories;
  const root = normalizeEndpoint(baseEndpoint);

  return Array.from(
    new Set(
      (narrowedCategories.length > 0 ? narrowedCategories : categories).map((category) =>
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
  return (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("data:image/")
  );
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

  const detailStates = await Promise.all(
    candidates.map(async (listing) => {
      try {
        const detail = await fetchListingDetailFromApi(listing.id, token);
        return {
          id: listing.id,
          detail,
          blocked: false
        };
      } catch (error) {
        if (error instanceof Error && error.message === "BLOCKED_LISTING") {
          return {
            id: listing.id,
            detail: null,
            blocked: true
          };
        }
        return {
          id: listing.id,
          detail: null,
          blocked: false
        };
      }
    })
  );

  const blockedIds = new Set(
    detailStates.filter((state) => state.blocked).map((state) => state.id)
  );

  const detailById = new Map<string, MarketListing>();
  for (const state of detailStates) {
    if (state.detail?.id) {
      detailById.set(state.detail.id, state.detail);
    }
  }

  return output
    .filter((listing) => !blockedIds.has(listing.id))
    .map((listing) => mergeListing(listing, detailById.get(listing.id) ?? null));
}

function applyLocalFilters(listings: MarketListing[], options: SearchOptions) {
  let output = listings.slice();
  const gameFilter = options.game?.trim().toLowerCase() ?? "";
  const categoryFilter = options.category?.trim().toLowerCase() ?? "";

  if (Number.isFinite(options.minPrice ?? NaN)) {
    output = output.filter((item) => item.basePrice >= Number(options.minPrice));
  }
  if (Number.isFinite(options.maxPrice ?? NaN)) {
    output = output.filter((item) => item.basePrice <= Number(options.maxPrice));
  }
  if (gameFilter) {
    output = output.filter((item) => {
      const haystack = `${item.game} ${item.title} ${item.category}`.toLowerCase();
      return haystack.includes(gameFilter);
    });
  }
  if (categoryFilter) {
    output = output.filter((item) => {
      const haystack = `${item.category} ${item.title} ${item.game}`.toLowerCase();
      return haystack.includes(categoryFilter);
    });
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
    const domainFilter = options.supplierFilters.domain?.trim().toLowerCase() ?? "";
    const rankFilter = options.supplierFilters.rank?.trim().toLowerCase() ?? "";
    const requiresOrigin = options.supplierFilters.origin === "1";
    const requiresMailAccess = options.supplierFilters.ma === "1";
    const requiresOnline = options.supplierFilters.online === "1";
    const requiresGuarantee = options.supplierFilters.guarantee === "1";
    const requiresNoReserve = options.supplierFilters.no_reserve === "1";

    if (domainFilter) {
      output = output.filter((item) => {
        const haystack = `${item.title} ${item.description} ${item.specs
          .map((spec) => `${spec.label} ${spec.value}`)
          .join(" ")}`.toLowerCase();
        return haystack.includes(domainFilter);
      });
    }

    if (rankFilter) {
      output = output.filter((item) => {
        const haystack = `${item.title} ${item.description} ${item.specs
          .map((spec) => `${spec.label} ${spec.value}`)
          .join(" ")}`.toLowerCase();
        return haystack.includes(rankFilter);
      });
    }

    const matchesSpecKeyword = (item: MarketListing, keyword: string) =>
      item.specs.some((spec) => `${spec.label} ${spec.value}`.toLowerCase().includes(keyword));

    if (requiresOrigin) {
      output = output.filter((item) => matchesSpecKeyword(item, "original"));
    }
    if (requiresMailAccess) {
      output = output.filter((item) => matchesSpecKeyword(item, "mail"));
    }
    if (requiresOnline) {
      output = output.filter((item) => matchesSpecKeyword(item, "online"));
    }
    if (requiresGuarantee) {
      output = output.filter((item) => matchesSpecKeyword(item, "guarantee"));
    }
    if (requiresNoReserve) {
      output = output.filter((item) => !matchesSpecKeyword(item, "reserve"));
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
    const primary = await fetchListingsFromEndpoint({
      endpoint,
      token,
      query: trimmedQuery,
      options
    });
    const categoryEndpoints = buildCategoryEndpoints(endpoint, options);
    const categoryResultsSettled = await Promise.allSettled(
      categoryEndpoints.map((categoryEndpoint) =>
        fetchListingsFromEndpoint({
          endpoint: categoryEndpoint,
          token,
          query: trimmedQuery,
          options
        })
      )
    );
    const categoryResults = categoryResultsSettled
      .filter(
        (entry): entry is PromiseFulfilledResult<MarketListing[]> =>
          entry.status === "fulfilled"
      )
      .map((entry) => entry.value);

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
