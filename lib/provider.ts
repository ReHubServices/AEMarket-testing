import { fallbackListings } from "@/lib/market";
import { getLztAccessToken } from "@/lib/lzt-auth";
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
  return process.env.LZT_API_SEARCH_URL ?? `${getLztBaseUrl()}/`;
}

function getItemEndpointBase() {
  return process.env.LZT_API_ITEM_URL ?? getLztBaseUrl();
}

function getPurchaseEndpoint(listingId: string) {
  const configured = process.env.LZT_API_PURCHASE_URL;
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
  const directCandidates = [
    source.final_price,
    source.sale_price,
    source.current_price,
    source.price,
    source.amount,
    source.currency_price,
    source.cost,
    source.price_rub,
    source.sum,
    source.display_price
  ];

  for (const candidate of directCandidates) {
    const parsed = extractNumber(candidate);
    if (parsed > 0) {
      return Math.round(parsed * 100) / 100;
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
  const basePrice = resolveListingBasePrice(source);
  const id = extractText(source.id ?? source.item_id ?? source.itemId ?? source.listing_id ?? "");
  const title = extractText(
    source.title_en ?? source.title ?? source.item_title ?? source.name ?? source.heading,
    "Untitled listing"
  );
  const imageUrl = extractImageUrl(source);
  const game = resolveGameLabel(source);
  const category = resolveCategoryLabel(source, game);
  const specs = extractSpecs(source);
  const description = extractDescription(source) || buildDescriptionFallback(source, specs);

  return {
    id,
    title,
    imageUrl,
    price: basePrice,
    basePrice,
    currency: extractCurrency(source),
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

  return texts.some((text) => BLOCKED_MARKET_LINK_PATTERN.test(text));
}

function extractCurrency(item: Record<string, unknown>) {
  const currencyRaw = extractText(item.currency ?? item.currency_code ?? item.curr, "USD");
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
  if (currencyRaw) {
    return currencyRaw.toUpperCase();
  }

  const priceTextCandidates = [
    extractText(item.price, ""),
    extractText(item.amount, ""),
    extractText(item.currency_price, ""),
    extractText(item.price_rub, ""),
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

function buildSearchUrl(endpoint: string, query: string, options: SearchOptions) {
  const url = new URL(normalizeEndpoint(endpoint));
  const normalizedQuery = query.trim();
  const localOnlySupplierKeys = new Set([
    "ma",
    "online",
    "vac",
    "first_owner",
    "media_followers_min",
    "media_verified",
    "media_platform"
  ]);
  if (normalizedQuery) {
    url.searchParams.set("q", normalizedQuery);
    url.searchParams.set("query", normalizedQuery);
    url.searchParams.set("search", normalizedQuery);
  }
  const normalizedGame = options.game?.trim();
  const normalizedCategory = options.category?.trim();
  if (normalizedGame) {
    url.searchParams.set("game", normalizedGame);
    url.searchParams.set("platform", normalizedGame);
  }
  if (normalizedCategory) {
    url.searchParams.set("category", normalizedCategory);
    url.searchParams.set("cat", normalizedCategory);
  }
  url.searchParams.set("order_by", resolveSupplierSort(options.sort));
  const page = Number.isFinite(options.page ?? NaN) ? Math.max(1, Number(options.page)) : 1;
  const pageSize = Number.isFinite(options.pageSize ?? NaN)
    ? Math.min(60, Math.max(1, Number(options.pageSize)))
    : 15;
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(pageSize));
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("count", String(pageSize));

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
      if (localOnlySupplierKeys.has(normalizedKey)) {
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
      if (hasBlockedMarketplaceLink(buildListingSource(source))) {
        throw new Error("BLOCKED_LISTING");
      }
      const mapped = mapRawListing(source);
      if (!mapped.id) {
        mapped.id = listingId;
      }
      return mapped;
    }
    return null;
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
            (requested.includes("social") || requested.includes("media")) &&
            [
              "instagram",
              "tiktok",
              "telegram",
              "discord",
              "facebook",
              "twitter",
              "youtube",
              "snapchat"
            ].some((social) => slug.includes(social))
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

function applyLocalFilters(
  listings: MarketListing[],
  options: SearchOptions,
  queryTerm: string,
  forceScopeMatch = false
) {
  let output = listings.slice();
  const gameFilter = options.game?.trim().toLowerCase() ?? "";
  const categoryFilter = options.category?.trim().toLowerCase() ?? "";
  const hasKeywordQuery = Boolean(queryTerm.trim());
  const mediaFollowersMin = Number(options.supplierFilters?.media_followers_min ?? NaN);
  const mediaVerified = options.supplierFilters?.media_verified?.trim() ?? "";
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
      queryTokens.length <= 2
        ? queryTokens.length
        : Math.max(2, Math.ceil(queryTokens.length * 0.67));
    return matches >= requiredMatches;
  };

  const matchesGameToken = (item: MarketListing, token: string) => {
    const haystack = `${item.game} ${item.title} ${item.category} ${item.description}`.toLowerCase();
    if (token === "social" || token === "media") {
      return socialKeywords.some((keyword) => haystack.includes(keyword));
    }
    if (token === "fortnite") {
      return [
        "fortnite",
        "fn",
        "epicgames",
        "epic games",
        "save the world",
        "stw",
        "vbucks",
        "v-bucks",
        "battle pass",
        "leviathan"
      ].some((keyword) => haystack.includes(keyword));
    }
    if (token === "steam") {
      return (
        haystack.includes("steam") ||
        haystack.includes("cs2") ||
        haystack.includes("counter-strike") ||
        haystack.includes("dota") ||
        haystack.includes("rust") ||
        haystack.includes("pubg") ||
        haystack.includes("vac") ||
        haystack.includes("prime") ||
        haystack.includes("faceit")
      );
    }
    if (token === "siege") {
      return haystack.includes("siege") || haystack.includes("rainbow") || haystack.includes("r6");
    }
    if (token === "valorant") {
      return haystack.includes("valorant") || haystack.includes("riot");
    }
    if (token === "battlenet") {
      return (
        haystack.includes("battlenet") ||
        haystack.includes("battle.net") ||
        haystack.includes("blizzard") ||
        haystack.includes("overwatch") ||
        haystack.includes("warzone") ||
        haystack.includes("call of duty") ||
        haystack.includes("diablo") ||
        haystack.includes("world of warcraft") ||
        haystack.includes("wow")
      );
    }
    if (token === "telegram") {
      return haystack.includes("telegram") || haystack.includes("телеграм");
    }
    if (token === "discord") {
      return haystack.includes("discord") || haystack.includes("дискорд");
    }
    if (token === "cs2") {
      return (
        haystack.includes("cs2") ||
        haystack.includes("counter-strike") ||
        haystack.includes("counter strike") ||
        haystack.includes("csgo")
      );
    }
    return haystack.includes(token);
  };
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

  if (Number.isFinite(options.minPrice ?? NaN)) {
    output = output.filter((item) => item.basePrice >= Number(options.minPrice));
  }
  if (Number.isFinite(options.maxPrice ?? NaN)) {
    output = output.filter((item) => item.basePrice <= Number(options.maxPrice));
  }
  if ((hasKeywordQuery || forceScopeMatch) && gameFilter) {
    output = output.filter((item) => matchesGameToken(item, gameFilter));
  }
  if ((hasKeywordQuery || forceScopeMatch) && categoryFilter) {
    output = output.filter((item) => matchesGameToken(item, categoryFilter));
  }
  if (hasKeywordQuery) {
    output = output.filter((item) => matchesKeywordQuery(item));
  }
  if (categoryFilter in mediaPlatformKeywords) {
    const platformTokens = mediaPlatformKeywords[categoryFilter] ?? [];
    output = output.filter((item) => {
      const haystack = `${item.title} ${item.description} ${item.game} ${item.category}`.toLowerCase();
      return platformTokens.some((token) => haystack.includes(token));
    });
  }
  if (Number.isFinite(mediaFollowersMin) && mediaFollowersMin > 0) {
    output = output.filter((item) => extractFollowers(item) >= mediaFollowersMin);
  }
  if (mediaVerified === "1") {
    output = output.filter((item) => isVerifiedMedia(item));
  }
  if (mediaVerified === "0") {
    output = output.filter((item) => !isVerifiedMedia(item));
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

function buildSupplierQueryVariants(query: string) {
  const normalized = query.trim();
  if (!normalized) {
    return [""];
  }

  const tokens = Array.from(
    new Set(
      normalized
        .toLowerCase()
        .split(/[^a-z0-9а-яё]+/gi)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    )
  );

  const variants = new Set<string>([normalized]);
  if (tokens.length > 0) {
    variants.add(tokens.join(" "));
  }
  for (const token of tokens) {
    if (token.length >= 3) {
      variants.add(token);
    }
  }
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const pair = `${tokens[index]} ${tokens[index + 1]}`.trim();
    if (pair.length >= 4) {
      variants.add(pair);
    }
  }

  return Array.from(variants).filter(Boolean).slice(0, 3);
}

export async function searchListings(query: string, options: SearchOptions = {}): Promise<SearchResult> {
  const store = await readStore();
  const endpoint = getSearchEndpoint();
  const token = await getLztAccessToken();
  const trimmedQuery = query.trim();
  const hasBrowseScope = Boolean(options.game?.trim() || options.category?.trim());
  const page = Number.isFinite(options.page ?? NaN) ? Math.max(1, Number(options.page)) : 1;
  const pageSize = Number.isFinite(options.pageSize ?? NaN)
    ? Math.min(60, Math.max(1, Number(options.pageSize)))
    : 15;
  const fetchPageSize = Math.min(80, pageSize + 12);
  const normalizedOptions: SearchOptions = {
    ...options,
    page,
    pageSize: fetchPageSize
  };

  if (!trimmedQuery && !hasBrowseScope) {
    return {
      listings: [],
      hasMore: false,
      page,
      pageSize
    };
  }
  if (!token) {
    throw new Error("LZT_AUTH_MISSING");
  }

  try {
    const fetchFromEndpointForQueries = async (
      endpointTarget: string,
      pageOptions: SearchOptions,
      supplierQueries: string[]
    ) => {
      const normalizedQueries = supplierQueries.length > 0 ? supplierQueries : [""];
      const settled = await Promise.allSettled(
        normalizedQueries.map((supplierQuery) =>
          fetchListingsFromEndpoint({
            endpoint: endpointTarget,
            token,
            query: supplierQuery,
            options: pageOptions
          })
        )
      );
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
      forceScopeMatch = false,
      supplierQueries: string[] = [trimmedQuery]
    ) => {
      const pageOptions: SearchOptions = {
        ...normalizedOptions,
        page: targetPage
      };
      const primary = await fetchFromEndpointForQueries(endpoint, pageOptions, supplierQueries);
      const endpointScope = broadMode
        ? {
            ...options,
            game: null,
            category: null
          }
        : options;
      const categoryEndpoints = buildCategoryEndpoints(endpoint, endpointScope);
      const categoryResultsSettled = await Promise.allSettled(
        categoryEndpoints.map((categoryEndpoint) =>
          fetchFromEndpointForQueries(categoryEndpoint, pageOptions, supplierQueries)
        )
      );
      const categoryResults = categoryResultsSettled
        .filter(
          (entry): entry is PromiseFulfilledResult<MarketListing[]> =>
            entry.status === "fulfilled"
        )
        .map((entry) => entry.value);

      const combined = mergeUnique([primary, ...categoryResults].flat());
      return applyLocalFilters(combined, options, trimmedQuery, forceScopeMatch);
    };

    let activeSupplierQueries = [trimmedQuery];
    const initialForceScope = hasBrowseScope && !trimmedQuery;
    let filteredCurrentPage = await loadFilteredPage(page, false, initialForceScope);
    let usingBroadFallback = false;
    let usingScopeMatchFallback = initialForceScope;
    if (filteredCurrentPage.length === 0 && trimmedQuery) {
      const keywordVariants = buildSupplierQueryVariants(trimmedQuery);
      if (keywordVariants.length > 1) {
        activeSupplierQueries = keywordVariants;
        filteredCurrentPage = await loadFilteredPage(
          page,
          false,
          false,
          activeSupplierQueries
        );
      }
      if (filteredCurrentPage.length === 0) {
        usingBroadFallback = true;
        usingScopeMatchFallback = hasBrowseScope;
        filteredCurrentPage = await loadFilteredPage(
          page,
          true,
          usingScopeMatchFallback,
          activeSupplierQueries
        );
        if (filteredCurrentPage.length === 0 && usingScopeMatchFallback) {
          usingScopeMatchFallback = false;
          filteredCurrentPage = await loadFilteredPage(
            page,
            true,
            usingScopeMatchFallback,
            activeSupplierQueries
          );
        }
      }
    }
    if (filteredCurrentPage.length === 0 && hasBrowseScope && !trimmedQuery) {
      filteredCurrentPage = await loadFilteredPage(page, true, true);
      usingBroadFallback = true;
      usingScopeMatchFallback = true;
      if (filteredCurrentPage.length === 0) {
        filteredCurrentPage = await loadFilteredPage(page, true, false);
        usingScopeMatchFallback = false;
      }
    }
    const visibleWindow = filteredCurrentPage.slice(0, pageSize + 40);
    let hasMore = filteredCurrentPage.length > pageSize;
    if (!hasMore) {
      const filteredNextPage = await loadFilteredPage(
        page + 1,
        usingBroadFallback,
        usingScopeMatchFallback,
        activeSupplierQueries
      );
      hasMore = filteredNextPage.length > 0;
    }
    const enriched = await enrichListingsWithDetails(visibleWindow, token);
    const translated = await translateListingsToEnglish(enriched);
    const pagedListings = withMarkup(translated, store.settings.markupPercent).slice(0, pageSize);
    return {
      listings: pagedListings,
      hasMore,
      page,
      pageSize
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("LZT_AUTH_")) {
      throw error;
    }
    return {
      listings: [],
      hasMore: false,
      page,
      pageSize
    };
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
