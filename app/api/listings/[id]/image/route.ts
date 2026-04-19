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

function detectImageContentType(bytes: Uint8Array, headerContentType: string) {
  const header = (headerContentType ?? "").toLowerCase();
  if (header.startsWith("image/")) {
    return header.split(";")[0] || "image/webp";
  }
  if (bytes.length >= 12) {
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return "image/png";
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "image/jpeg";
    }
    if (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38
    ) {
      return "image/gif";
    }
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return "image/webp";
    }
    if (
      bytes[4] === 0x66 &&
      bytes[5] === 0x74 &&
      bytes[6] === 0x79 &&
      bytes[7] === 0x70 &&
      bytes[8] === 0x61 &&
      bytes[9] === 0x76 &&
      bytes[10] === 0x69 &&
      bytes[11] === 0x66
    ) {
      return "image/avif";
    }
  }
  return "";
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
    const contentTypeHeader = (response.headers.get("content-type") ?? "").toLowerCase();
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) {
      return null;
    }
    const contentType = detectImageContentType(new Uint8Array(buffer), contentTypeHeader);
    if (!contentType) {
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
  const publicCandidates = [
    { url: `https://lzt.market/${normalizedId}/image${query}` },
    { url: `https://lzt.market/market/${normalizedId}/image${query}` },
    { url: `https://lolz.guru/market/${normalizedId}/image${query}` }
  ];
  const apiCandidate =
    token
      ? {
          url: `${getLztBaseUrl()}/${normalizedId}/image${query}`,
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      : null;

  if (type) {
    candidates.push(...publicCandidates);
    if (apiCandidate) {
      candidates.push(apiCandidate);
    }
  } else {
    if (apiCandidate) {
      candidates.push(apiCandidate);
    }
    candidates.push(...publicCandidates);
  }

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
