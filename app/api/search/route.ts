import { NextRequest, NextResponse } from "next/server";
import { fallbackListings, type MarketListing } from "@/lib/market";

function searchFallback(query: string): MarketListing[] {
  if (!query) {
    return fallbackListings;
  }

  const normalized = query.toLowerCase();
  return fallbackListings.filter((listing) =>
    [listing.title, listing.game, listing.category, listing.seller]
      .join(" ")
      .toLowerCase()
      .includes(normalized)
  );
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const endpoint = process.env.LZT_API_SEARCH_URL;
  const token = process.env.LZT_API_TOKEN;

  if (!endpoint || !token) {
    return NextResponse.json({ listings: searchFallback(query) });
  }

  try {
    const upstream = await fetch(`${endpoint}?query=${encodeURIComponent(query)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if (!upstream.ok) {
      return NextResponse.json({ listings: searchFallback(query) });
    }

    const raw = await upstream.json();
    const listings: MarketListing[] = Array.isArray(raw?.items)
      ? raw.items.map((item: Record<string, unknown>) => ({
          id: String(item.id ?? ""),
          title: String(item.title ?? "Untitled listing"),
          imageUrl: String(item.image ?? ""),
          price: Number(item.price ?? 0),
          currency: String(item.currency ?? "USD"),
          game: String(item.game ?? "Unknown"),
          category: String(item.category ?? "Account"),
          seller: String(item.seller ?? "Unknown seller"),
          rating: Number(item.rating ?? 0),
          description: String(item.description ?? "")
        }))
      : [];

    return NextResponse.json({ listings: query ? listings : listings.slice(0, 24) });
  } catch {
    return NextResponse.json({ listings: searchFallback(query) });
  }
}
