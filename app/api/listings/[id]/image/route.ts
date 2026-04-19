import { NextRequest } from "next/server";
import { fail } from "@/lib/http";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { getLztAccessToken } from "@/lib/lzt-auth";

export const runtime = "nodejs";

const ALLOWED_TYPES = new Set([
  "skins",
  "pickaxes",
  "dances",
  "gliders",
  "weapons",
  "agents",
  "buddies"
]);

function getLztBaseUrl() {
  return (process.env.LZT_API_BASE_URL ?? "https://prod-api.lzt.market").trim().replace(/\/+$/, "");
}

async function fetchImageCandidate(url: string, headers: Record<string, string> = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "image/*,*/*",
        ...headers
      },
      cache: "no-store"
    });
    if (!response.ok) {
      return null;
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      return null;
    }
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) {
      return null;
    }
    return {
      buffer,
      contentType
    };
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const limiter = checkRateLimit({
    key: createRateKey(request, "listing_image_proxy"),
    maxRequests: 240,
    windowMs: 60_000
  });
  if (!limiter.allowed) {
    return fail(`Rate limit exceeded. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }

  const { id } = await context.params;
  const normalizedId = String(id ?? "").trim();
  if (!/^\d{5,}$/.test(normalizedId)) {
    return fail("Invalid listing ID", 400);
  }

  const typeRaw = String(request.nextUrl.searchParams.get("type") ?? "")
    .trim()
    .toLowerCase();
  const type = typeRaw && ALLOWED_TYPES.has(typeRaw) ? typeRaw : "";

  const token = await getLztAccessToken();
  const query = type ? `?type=${encodeURIComponent(type)}` : "";
  const candidates: Array<{ url: string; headers?: Record<string, string> }> = [];
  if (token) {
    candidates.push({
      url: `${getLztBaseUrl()}/${normalizedId}/image${query}`,
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
  }
  candidates.push({ url: `https://lzt.market/${normalizedId}/image${query}` });
  candidates.push({ url: `https://lzt.market/market/${normalizedId}/image${query}` });
  candidates.push({ url: `https://lolz.guru/market/${normalizedId}/image${query}` });

  let resolved: { buffer: ArrayBuffer; contentType: string } | null = null;
  for (const candidate of candidates) {
    resolved = await fetchImageCandidate(candidate.url, candidate.headers ?? {});
    if (resolved) {
      break;
    }
  }
  if (!resolved) {
    return fail("Listing image unavailable", 404);
  }

  return new Response(resolved.buffer, {
    status: 200,
    headers: {
      "Content-Type": resolved.contentType,
      "Cache-Control": "public, max-age=180, stale-while-revalidate=600"
    }
  });
}
