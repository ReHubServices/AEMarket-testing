import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { SearchSort, searchListings } from "@/lib/provider";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

function parseFlag(value: string | null) {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

const SUPPLIER_FILTER_KEYS = [
  "origin",
  "ma",
  "online",
  "guarantee",
  "no_reserve",
  "domain",
  "rank",
  "region",
  "hours_min",
  "hours_max",
  "steam_level_min",
  "steam_level_max",
  "vac",
  "first_owner"
] as const;

export async function GET(request: NextRequest) {
  const limiter = checkRateLimit({
    key: createRateKey(request, "search"),
    maxRequests: 90,
    windowMs: 60_000
  });
  if (!limiter.allowed) {
    return fail(`Rate limit exceeded. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const sortParam = request.nextUrl.searchParams.get("sort")?.trim() ?? "";
  const minPriceRaw = request.nextUrl.searchParams.get("minPrice");
  const maxPriceRaw = request.nextUrl.searchParams.get("maxPrice");
  const game = request.nextUrl.searchParams.get("game")?.trim() ?? "";
  const category = request.nextUrl.searchParams.get("category")?.trim() ?? "";
  const hasImage = parseFlag(request.nextUrl.searchParams.get("hasImage"));
  const hasDescription = parseFlag(request.nextUrl.searchParams.get("hasDescription"));
  const hasSpecs = parseFlag(request.nextUrl.searchParams.get("hasSpecs"));

  const sort: SearchSort =
    sortParam === "price_asc" ||
    sortParam === "price_desc" ||
    sortParam === "newest"
      ? sortParam
      : "relevance";
  const minPrice =
    minPriceRaw && Number.isFinite(Number(minPriceRaw)) ? Number(minPriceRaw) : null;
  const maxPrice =
    maxPriceRaw && Number.isFinite(Number(maxPriceRaw)) ? Number(maxPriceRaw) : null;
  const supplierFilters: Record<string, string> = {};
  for (const key of SUPPLIER_FILTER_KEYS) {
    const value = request.nextUrl.searchParams.get(key)?.trim();
    if (value) {
      supplierFilters[key] = value;
    }
  }

  try {
    const listings = await searchListings(query, {
      sort,
      minPrice,
      maxPrice,
      game: game || null,
      category: category || null,
      hasImage,
      hasDescription,
      hasSpecs,
      supplierFilters
    });
    return ok({
      listings: query ? listings : listings.slice(0, 30)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SEARCH_FAILED";
    if (message === "LZT_AUTH_MISSING") {
      return fail("LZT API token is not configured", 503);
    }
    if (message === "LZT_AUTH_FAILED") {
      return fail("LZT API authorization failed", 401);
    }
    return fail("Search unavailable", 502);
  }
}
