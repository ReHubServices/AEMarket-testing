import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { SearchSort, searchListings } from "@/lib/provider";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

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

  try {
    const listings = await searchListings(query, {
      sort,
      minPrice,
      maxPrice
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
