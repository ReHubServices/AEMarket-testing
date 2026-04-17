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
    return value.startsWith("http://") ? `https://${value.slice(7)}` : value;
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
};

function isFortniteLikeListing(listing: Pick<MarketListing, "title" | "game" | "category">) {
  const text = listingKeywords(listing);
  return [
    "fortnite",
    "epicgames",
    "epic games",
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
      host.includes("prod-api.lzt.market")
    );
  } catch {
    return false;
  }
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

export function getListingImageWithOptions(
  listing: Pick<MarketListing, "imageUrl" | "title" | "game" | "category">,
  options: ListingImageOptions = {}
) {
  const normalized = normalizeUrl(listing.imageUrl);
  if (!normalized) {
    return getPresetListingImage(listing, options);
  }
  const lower = normalized.toLowerCase();
  const blocked = BROKEN_IMAGE_HINTS.some((hint) => lower.includes(hint));
  if (blocked) {
    return getPresetListingImage(listing, options);
  }
  if (!isLikelyDisplayImage(normalized)) {
    return getPresetListingImage(listing, options);
  }
  if (options.forceTheme === "fortnite" && !isTrustedSupplierImage(normalized)) {
    return "/fallbacks/fortnite.svg";
  }
  if (isFortniteLikeListing(listing) && !isTrustedSupplierImage(normalized)) {
    return "/fallbacks/fortnite.svg";
  }
  return normalized;
}
