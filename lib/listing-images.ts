import { MarketListing } from "@/lib/types";

const BROKEN_IMAGE_HINTS = [
  "/listing-placeholder.svg",
  "/logo.png",
  "/logo.svg",
  "images.unsplash.com"
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

function listingKeywords(listing: Pick<MarketListing, "title" | "game" | "category">) {
  return `${listing.title} ${listing.game} ${listing.category}`.toLowerCase();
}

export function getPresetListingImage(
  listing: Pick<MarketListing, "title" | "game" | "category">
) {
  const text = listingKeywords(listing);
  if (text.includes("fortnite")) {
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
  const normalized = normalizeUrl(listing.imageUrl);
  if (!normalized) {
    return getPresetListingImage(listing);
  }
  const lower = normalized.toLowerCase();
  const blocked = BROKEN_IMAGE_HINTS.some((hint) => lower.includes(hint));
  if (blocked) {
    return getPresetListingImage(listing);
  }
  return normalized;
}
