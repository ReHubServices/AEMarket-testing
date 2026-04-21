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
      host.includes("prod-api.lzt.market")
    );
  } catch {
    return false;
  }
}

function toFortniteMarketImageUrl(url: string, type: "skins" | "pickaxes" | "dances" | "gliders") {
  const parsed = extractMarketImageMeta(url);
  if (!parsed) {
    return "";
  }
  return toListingImageProxyUrl(parsed.id, type);
}

function getPreferredFortnitePreviewUrl(url: string) {
  return toFortniteMarketImageUrl(url, "skins") || url;
}

export function getPresetListingImage(
  listing: Pick<MarketListing, "title" | "game" | "category">,
  options: ListingImageOptions = {}
) {
  if (options.forceTheme === "fortnite") {
    return "/listing-placeholder.svg";
  }
  const text = listingKeywords(listing);
  if (isFortniteLikeListing(listing)) {
    return "/listing-placeholder.svg";
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

function toListingImageProxyUrl(
  id: string,
  type?: "skins" | "pickaxes" | "dances" | "gliders" | "weapons" | "agents" | "buddies"
) {
  const params = new URLSearchParams();
  params.set("v", "20260421");
  if (type) {
    params.set("type", type);
  }
  const query = params.toString();
  return query ? `/api/listings/${id}/image?${query}` : `/api/listings/${id}/image`;
}

function extractMarketImageMeta(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(raw);
  } catch {
    if (raw.startsWith("/")) {
      try {
        parsed = new URL(`https://lzt.market${raw}`);
      } catch {
        parsed = null;
      }
    }
  }
  if (!parsed) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const lztMatch = path.match(/^\/(?:market\/)?(\d{5,})\/image$/i);
  const proxyMatch = path.match(/^\/api\/listings\/(\d{5,})\/image$/i);

  let id = "";
  if (lztMatch?.[1] && (host.includes("lzt.market") || host.includes("lolz.guru"))) {
    id = lztMatch[1];
  } else if (proxyMatch?.[1]) {
    id = proxyMatch[1];
  }
  if (!id) {
    return null;
  }

  const typeRaw = parsed.searchParams.get("type")?.trim().toLowerCase() ?? "";
  const allowedTypes = new Set(["skins", "pickaxes", "dances", "gliders", "weapons", "agents", "buddies"]);
  const type = allowedTypes.has(typeRaw) ? typeRaw : "";

  return {
    id,
    type
  };
}

function toProxyFromMarketImageUrl(
  url: string,
  preferredType?: "skins" | "pickaxes" | "dances" | "gliders" | "weapons" | "agents" | "buddies"
) {
  const parsed = extractMarketImageMeta(url);
  if (!parsed) {
    return "";
  }
  return toListingImageProxyUrl(
    parsed.id,
    preferredType ?? ((parsed.type as "skins" | "pickaxes" | "dances" | "gliders" | "weapons" | "agents" | "buddies" | "") || undefined)
  );
}

function marketImageById(id: string | undefined, fortniteMode: boolean) {
  const normalizedId = String(id ?? "").trim();
  if (!/^\d{5,}$/.test(normalizedId)) {
    return "";
  }
  return fortniteMode
    ? toListingImageProxyUrl(normalizedId, "skins")
    : toListingImageProxyUrl(normalizedId);
}

export function getListingImageWithOptions(
  listing: ListingImageSource,
  options: ListingImageOptions = {}
) {
  const fortniteLike = options.forceTheme === "fortnite" || isFortniteLikeListing(listing);
  const normalized = normalizeUrl(listing.imageUrl);
  const byIdImage = marketImageById(listing.id, fortniteLike);
  if (!normalized) {
    if (byIdImage) {
      return byIdImage;
    }
    return getPresetListingImage(listing, options);
  }
  const lower = normalized.toLowerCase();
  const blocked = BROKEN_IMAGE_HINTS.some((hint) => lower.includes(hint));
  if (blocked) {
    if (byIdImage) {
      return byIdImage;
    }
    return getPresetListingImage(listing, options);
  }
  if (!isLikelyDisplayImage(normalized)) {
    if (byIdImage) {
      return byIdImage;
    }
    return getPresetListingImage(listing, options);
  }
  const proxied = toProxyFromMarketImageUrl(
    normalized,
    options.preferFortniteSkins && fortniteLike ? "skins" : undefined
  );
  const resolved = proxied || normalized;
  if (options.preferFortniteSkins && fortniteLike) {
    const preferred = getPreferredFortnitePreviewUrl(resolved);
    if (preferred && isLikelyDisplayImage(preferred)) {
      return preferred;
    }
  }
  if (options.forceTheme === "fortnite" && !isTrustedSupplierImage(resolved)) {
    return "/fallbacks/fortnite.svg";
  }
  if (fortniteLike && !isTrustedSupplierImage(resolved)) {
    return "/fallbacks/fortnite.svg";
  }
  return resolved;
}

export function getListingImageGallery(
  listing: ListingImageSource,
  options: ListingImageOptions = {}
) {
  const fortniteLike = options.forceTheme === "fortnite" || isFortniteLikeListing(listing);
  const base = getListingImageWithOptions(listing, options);
  if (!base || base.startsWith("/fallbacks/") || base === "/listing-placeholder.svg") {
    return [base].filter(Boolean);
  }
  if (!fortniteLike) {
    return [base];
  }
  const numericId = String(listing.id ?? "").trim();
  const hasNumericId = /^\d{5,}$/.test(numericId);
  const orderedTypes: Array<"skins" | "pickaxes" | "dances" | "gliders"> = [
    "skins",
    "pickaxes",
    "dances",
    "gliders"
  ];
  if (hasNumericId) {
    return orderedTypes.map((type) => toListingImageProxyUrl(numericId, type));
  }
  return [base];
}
