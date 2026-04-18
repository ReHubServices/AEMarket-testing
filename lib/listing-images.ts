import { MarketListing } from "@/lib/types";

const BROKEN_IMAGE_HINTS = [
  "/listing-placeholder.svg",
  "/logo.png",
  "/logo.svg",
  "images.unsplash.com",
  "unsplash.com"
];

function normalizeUrl(raw: string | null | undefined) {
  const value = String(raw ?? "").trim();
  if (!value) {
    return "";
  }
  if (value.startsWith("//")) {
    return `https:${value}`;
  }
  if (
    value.startsWith("https://") ||
    value.startsWith("http://") ||
    value.startsWith("data:image/") ||
    value.startsWith("/")
  ) {
    if (
      value.startsWith("/") &&
      (/^\/\d+\/image(?:\?|$)/i.test(value) || /^\/market\/\d+\/image(?:\?|$)/i.test(value))
    ) {
      return `https://lzt.market${value}`;
    }
    return value.startsWith("http://") ? `https://${value.slice(7)}` : value;
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(value)) {
    return `https://${value}`;
  }
  return "";
}

function isLikelyDisplayImage(url: string) {
  const normalized = url.toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("data:image/")) {
    return true;
  }
  if (/\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?|#|$)/i.test(normalized)) {
    return true;
  }
  if (
    normalized.includes("/image") ||
    normalized.includes("/images/") ||
    normalized.includes("/photo") ||
    normalized.includes("/thumb") ||
    normalized.includes("/preview") ||
    normalized.includes("/attachment") ||
    normalized.includes("nztcdn.com/files/")
  ) {
    return true;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (host.includes("nztcdn.com") || host.includes("lztcdn.com")) {
      return true;
    }
    if (path.includes("/attachments/") || path.includes("/uploads/")) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function listingKeywords(listing: Pick<MarketListing, "title" | "game" | "category">) {
  return `${listing.title} ${listing.game} ${listing.category}`.toLowerCase();
}

type ListingImageOptions = {
  forceTheme?: "fortnite";
  preferFortniteSkins?: boolean;
};

type ListingImageSource = Pick<MarketListing, "imageUrl" | "title" | "game" | "category"> & {
  id?: string;
};

function isFortniteLikeListing(listing: Pick<MarketListing, "title" | "game" | "category">) {
  const text = listingKeywords(listing);
  return [
    "fortnite",
    "vbucks",
    "v-bucks",
    "battle pass",
    "save the world",
    "stw",
    "pickaxe",
    "outfit",
    "emote",
    "glider",
    "leviathan"
  ].some((token) => text.includes(token));
}

function isTrustedSupplierImage(url: string) {
  if (!url) {
    return false;
  }
  if (url.startsWith("/")) {
    return true;
  }
  if (url.startsWith("data:image/")) {
    return true;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host.includes("nztcdn.com") ||
      host.includes("lztcdn.com") ||
      host.includes("lzt.market") ||
      host.includes("prod-api.lzt.market") ||
      host.includes("fortnite-api.com")
    );
  } catch {
    return false;
  }
}

function toFortniteMarketImageUrl(url: string, type: "skins" | "pickaxes" | "dances" | "gliders") {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (!(host.includes("lzt.market") || host.includes("lolz.guru"))) {
    return "";
  }
  if (!/\/(?:market\/)?\d+\/image$/.test(path)) {
    return "";
  }
  parsed.searchParams.set("type", type);
  return parsed.toString();
}

function getPreferredFortnitePreviewUrl(url: string) {
  return toFortniteMarketImageUrl(url, "skins") || url;
}

export function getPresetListingImage(
  listing: Pick<MarketListing, "title" | "game" | "category">,
  options: ListingImageOptions = {}
) {
  if (options.forceTheme === "fortnite") {
    return "/fallbacks/fortnite.svg";
  }
  const text = listingKeywords(listing);
  if (isFortniteLikeListing(listing)) {
    return "/fallbacks/fortnite.svg";
  }
  if (text.includes("valorant")) {
    return "/fallbacks/valorant.svg";
  }
  if (text.includes("chatgpt") || text.includes("chat gpt") || text.includes("openai")) {
    return "/fallbacks/chatgpt.svg";
  }
  if (text.includes("instagram") || text.includes("insta")) {
    return "/fallbacks/instagram.svg";
  }
  if (text.includes("tiktok") || text.includes("tik tok")) {
    return "/fallbacks/tiktok.svg";
  }
  return "/fallbacks/default.svg";
}

export function getListingImage(listing: Pick<MarketListing, "imageUrl" | "title" | "game" | "category">) {
  return getListingImageWithOptions(listing, {});
}

function fortniteImageById(id: string | undefined) {
  const normalizedId = String(id ?? "").trim();
  if (!/^\d+$/.test(normalizedId)) {
    return "";
  }
  return `https://lzt.market/${normalizedId}/image?type=skins`;
}

export function getListingImageWithOptions(
  listing: ListingImageSource,
  options: ListingImageOptions = {}
) {
  const normalized = normalizeUrl(listing.imageUrl);
  const fortniteById = isFortniteLikeListing(listing) ? fortniteImageById(listing.id) : "";
  if (!normalized) {
    if (fortniteById) {
      return fortniteById;
    }
    return getPresetListingImage(listing, options);
  }
  const lower = normalized.toLowerCase();
  const blocked = BROKEN_IMAGE_HINTS.some((hint) => lower.includes(hint));
  if (blocked) {
    if (fortniteById) {
      return fortniteById;
    }
    return getPresetListingImage(listing, options);
  }
  if (!isLikelyDisplayImage(normalized)) {
    if (fortniteById) {
      return fortniteById;
    }
    return getPresetListingImage(listing, options);
  }
  if (options.preferFortniteSkins && isFortniteLikeListing(listing)) {
    const preferred = getPreferredFortnitePreviewUrl(normalized);
    if (preferred && isLikelyDisplayImage(preferred)) {
      return preferred;
    }
  }
  if (options.forceTheme === "fortnite" && !isTrustedSupplierImage(normalized)) {
    if (fortniteById) {
      return fortniteById;
    }
    return "/fallbacks/fortnite.svg";
  }
  if (isFortniteLikeListing(listing) && !isTrustedSupplierImage(normalized)) {
    if (fortniteById) {
      return fortniteById;
    }
    return "/fallbacks/fortnite.svg";
  }
  return normalized;
}

export function getListingImageGallery(
  listing: ListingImageSource,
  options: ListingImageOptions = {}
) {
  const base = getListingImageWithOptions(listing, options);
  if (!base || base.startsWith("/fallbacks/") || base === "/listing-placeholder.svg") {
    return [base].filter(Boolean);
  }
  if (!isFortniteLikeListing(listing)) {
    return [base];
  }
  const orderedTypes: Array<"skins" | "pickaxes" | "dances" | "gliders"> = [
    "skins",
    "pickaxes",
    "dances",
    "gliders"
  ];
  const gallery = orderedTypes
    .map((type) => toFortniteMarketImageUrl(base, type))
    .filter(Boolean);
  if (gallery.length === 0) {
    return [base];
  }
  return Array.from(new Set(gallery));
}
