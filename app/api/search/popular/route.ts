import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { searchListings } from "@/lib/provider";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { readStore } from "@/lib/store";
import type { MarketListing } from "@/lib/types";

export const runtime = "nodejs";

const TOP_TERMS_LIMIT = 10;
const LISTINGS_LIMIT = 15;
const PER_TERM_PAGE_SIZE = 4;

type PopularTerm = {
  term: string;
  count: number;
};

function buildMixedListings(groups: MarketListing[][]) {
  const merged: MarketListing[] = [];
  const seen = new Set<string>();
  const maxDepth = Math.max(...groups.map((group) => group.length), 0);

  for (let depth = 0; depth < maxDepth; depth += 1) {
    for (const group of groups) {
      const listing = group[depth];
      if (!listing) {
        continue;
      }
      const normalizedId = listing.id.trim().toLowerCase();
      if (!normalizedId || seen.has(normalizedId)) {
        continue;
      }
      seen.add(normalizedId);
      merged.push(listing);
      if (merged.length >= LISTINGS_LIMIT) {
        return merged;
      }
    }
  }

  return merged;
}

export async function GET(request: NextRequest) {
  const limiter = checkRateLimit({
    key: createRateKey(request, "search-popular"),
    maxRequests: 45,
    windowMs: 60_000
  });
  if (!limiter.allowed) {
    return fail(`Rate limit exceeded. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }

  try {
    const store = await readStore();
    const topTerms: PopularTerm[] = store.searchStats
      .filter((entry) => entry.term.trim() && entry.count > 0)
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return Date.parse(right.lastSearchedAt) - Date.parse(left.lastSearchedAt);
      })
      .slice(0, TOP_TERMS_LIMIT)
      .map((entry) => ({
        term: entry.term.trim(),
        count: entry.count
      }));

    if (topTerms.length === 0) {
      return ok({
        terms: [],
        listings: []
      });
    }

    const searchResults = await Promise.allSettled(
      topTerms.map((entry) =>
        searchListings(entry.term, {
          sort: "relevance",
          page: 1,
          pageSize: PER_TERM_PAGE_SIZE
        })
      )
    );

    const listingGroups: MarketListing[][] = searchResults.map((result) =>
      result.status === "fulfilled" ? result.value.listings : []
    );
    const mixedListings = buildMixedListings(listingGroups);

    return ok({
      terms: topTerms,
      listings: mixedListings
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SEARCH_POPULAR_FAILED";
    if (message === "LZT_AUTH_MISSING") {
      return fail("Search provider is not configured", 503);
    }
    if (message === "LZT_AUTH_FAILED") {
      return fail("Search provider authorization failed", 401);
    }
    return fail("Popular listings unavailable", 502);
  }
}
