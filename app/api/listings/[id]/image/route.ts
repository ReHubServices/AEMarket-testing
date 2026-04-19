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
  if (!token) {
    return fail("Supplier API token missing", 503);
  }

  const upstreamUrl = new URL(`${getLztBaseUrl()}/${normalizedId}/image`);
  if (type) {
    upstreamUrl.searchParams.set("type", type);
  }

  const upstream = await fetch(upstreamUrl.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "image/*,*/*"
    },
    cache: "no-store"
  });

  if (!upstream.ok) {
    return fail("Listing image unavailable", upstream.status === 404 ? 404 : 502);
  }

  const contentType = upstream.headers.get("content-type") ?? "image/webp";
  const buffer = await upstream.arrayBuffer();
  if (!buffer.byteLength) {
    return fail("Empty image response", 502);
  }

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=180, stale-while-revalidate=600"
    }
  });
}
