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

function normalizeCandidateImageUrl(value: string) {
  const raw = value.trim().replace(/&amp;/g, "&");
  if (!raw) {
    return "";
  }
  if (raw.startsWith("//")) {
    return `https:${raw}`;
  }
  if (raw.startsWith("http://")) {
    return `https://${raw.slice(7)}`;
  }
  if (raw.startsWith("https://")) {
    return raw;
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(raw)) {
    return `https://${raw}`;
  }
  return "";
}

function looksLikeImageUrl(value: string) {
  const normalized = value.toLowerCase();
  if (!normalized) {
    return false;
  }
  if (/\.(png|jpe?g|webp|gif|bmp|avif)(\?|#|$)/i.test(normalized)) {
    return true;
  }
  if (normalized.includes("nztcdn.com/files/") || normalized.includes("lztcdn.com/")) {
    return true;
  }
  return normalized.includes("/image?type=");
}

function extractImageCandidatesFromHtml(html: string) {
  const normalizedHtml = html.replace(/\\\//g, "/");
  const urls =
    normalizedHtml.match(
      /(?:https?:\/\/|\/\/|[a-z0-9.-]+\.[a-z]{2,}\/)[^\s"'<>\\]+/gi
    ) ?? [];
  const unique = new Set<string>();
  for (const url of urls) {
    const normalized = normalizeCandidateImageUrl(url);
    if (!normalized) {
      continue;
    }
    if (!looksLikeImageUrl(normalized)) {
      continue;
    }
    unique.add(normalized);
  }
  return Array.from(unique);
}

async function fetchListingHtmlImageCandidate(normalizedId: string, type: string) {
  const pageCandidates = [
    `https://lzt.market/${normalizedId}`,
    `https://lzt.market/market/${normalizedId}`,
    `https://lolz.guru/market/${normalizedId}`
  ];
  const typeToken = type.trim().toLowerCase();

  for (const pageUrl of pageCandidates) {
    try {
      const response = await fetch(pageUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        },
        cache: "no-store"
      });
      if (!response.ok) {
        continue;
      }

      const html = await response.text();
      if (!html) {
        continue;
      }

      const extracted = extractImageCandidatesFromHtml(html);
      if (!extracted.length) {
        continue;
      }

      const prioritized = typeToken
        ? [
            ...extracted.filter((url) =>
              url.toLowerCase().includes(`/image?type=${encodeURIComponent(typeToken)}`.toLowerCase())
            ),
            ...extracted.filter((url) => url.toLowerCase().includes(`type=${typeToken}`)),
            ...extracted
          ]
        : extracted;

      const deduped = Array.from(new Set(prioritized));
      for (const candidateUrl of deduped) {
        const resolved = await fetchImageCandidate(candidateUrl);
        if (resolved) {
          return resolved;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

function collectImageUrlsDeep(
  value: unknown,
  output: Set<string>,
  depth = 0,
  visited = new Set<unknown>()
) {
  if (depth > 5 || value == null) {
    return;
  }

  if (typeof value === "string") {
    const normalized = normalizeCandidateImageUrl(value);
    if (normalized && looksLikeImageUrl(normalized)) {
      output.add(normalized);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  if (visited.has(value)) {
    return;
  }
  visited.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectImageUrlsDeep(entry, output, depth + 1, visited);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  const prioritizedKeys = [
    "image",
    "image_url",
    "imageUrl",
    "preview",
    "preview_url",
    "thumbnail",
    "thumbnail_url",
    "cover",
    "cover_url",
    "photo",
    "photos",
    "images",
    "gallery",
    "attachments",
    "media",
    "url",
    "src"
  ];

  for (const key of prioritizedKeys) {
    if (!(key in record)) {
      continue;
    }
    collectImageUrlsDeep(record[key], output, depth + 1, visited);
  }

  for (const entry of Object.values(record)) {
    collectImageUrlsDeep(entry, output, depth + 1, visited);
  }
}

async function fetchListingApiImageCandidate(normalizedId: string, type: string, token: string) {
  const base = getLztBaseUrl();
  const detailUrls = Array.from(
    new Set([
      `${base}/${normalizedId}`,
      `${base}/item/${normalizedId}`,
      `${base}/items/${normalizedId}`,
      `${base}/market/${normalizedId}`
    ])
  );
  const typeToken = type.trim().toLowerCase();

  for (const detailUrl of detailUrls) {
    try {
      const response = await fetch(detailUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        },
        cache: "no-store"
      });
      if (!response.ok) {
        continue;
      }

      const data = (await response.json()) as unknown;
      const extracted = new Set<string>();
      collectImageUrlsDeep(data, extracted);
      if (!extracted.size) {
        continue;
      }

      const all = Array.from(extracted);
      const prioritized = typeToken
        ? [
            ...all.filter((url) => url.toLowerCase().includes(`type=${typeToken}`)),
            ...all
          ]
        : all;

      const deduped = Array.from(new Set(prioritized));
      for (const candidateUrl of deduped) {
        const resolved = await fetchImageCandidate(candidateUrl, {
          Authorization: `Bearer ${token}`
        });
        if (resolved) {
          return resolved;
        }
        const fallbackResolved = await fetchImageCandidate(candidateUrl);
        if (fallbackResolved) {
          return fallbackResolved;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
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
  const publicCandidatesWithoutType = [
    { url: `https://lzt.market/${normalizedId}/image` },
    { url: `https://lzt.market/market/${normalizedId}/image` },
    { url: `https://lolz.guru/market/${normalizedId}/image` }
  ];
  const apiCandidateWithoutType =
    token
      ? {
          url: `${getLztBaseUrl()}/${normalizedId}/image`,
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
    if (apiCandidateWithoutType) {
      candidates.push(apiCandidateWithoutType);
    }
    candidates.push(...publicCandidatesWithoutType);
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
  if (!resolved && token) {
    resolved = await fetchListingApiImageCandidate(normalizedId, type, token);
  }
  if (!resolved) {
    resolved = await fetchListingHtmlImageCandidate(normalizedId, type);
  }
  if (!resolved) {
    const fallbackUrl = `https://lzt.market/market/${normalizedId}/image${query}`;
    return Response.redirect(fallbackUrl, 302);
  }

  return new Response(resolved.buffer, {
    status: 200,
    headers: {
      "Content-Type": resolved.contentType,
      "Cache-Control": "public, max-age=180, stale-while-revalidate=600"
    }
  });
}
