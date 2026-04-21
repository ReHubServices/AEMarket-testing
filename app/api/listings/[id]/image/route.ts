import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
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

const NO_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1b1b1f"/><stop offset="100%" stop-color="#0f1012"/></linearGradient></defs><rect width="1200" height="675" fill="url(#g)"/><rect x="80" y="80" width="1040" height="515" rx="28" fill="none" stroke="#2f3137" stroke-width="2"/><text x="600" y="320" text-anchor="middle" fill="#d4d4d8" font-family="system-ui,Segoe UI,Arial" font-size="44" font-weight="600">No Image</text><text x="600" y="370" text-anchor="middle" fill="#71717a" font-family="system-ui,Segoe UI,Arial" font-size="22">Listing preview unavailable</text></svg>`;
type FetchedImage = {
  buffer: ArrayBuffer;
  contentType: string;
};

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

function collectLinksDeep(value: unknown, output: Set<string>, depth = 0, visited = new Set<unknown>()) {
  if (depth > 4 || value == null) {
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      output.add(trimmed);
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
      collectLinksDeep(entry, output, depth + 1, visited);
    }
    return;
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    collectLinksDeep(entry, output, depth + 1, visited);
  }
}

function normalizePossibleImageLink(raw: string, baseUrl: string) {
  const value = raw.trim().replace(/\\\//g, "/").replace(/&amp;/g, "&");
  if (!value) {
    return "";
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    if (value.startsWith("//")) {
      return `https:${value}`;
    }
    if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(value)) {
      return `https://${value}`;
    }
    return "";
  }
}

function isProbablyImageEndpoint(url: string) {
  const normalized = url.toLowerCase();
  if (!normalized) {
    return false;
  }
  if (/\.(png|jpe?g|webp|gif|bmp|avif|svg)(\?|#|$)/i.test(normalized)) {
    return true;
  }
  if (
    normalized.includes("/image") ||
    normalized.includes("nztcdn.com/files/") ||
    normalized.includes("lztcdn.com/")
  ) {
    return true;
  }
  return false;
}

async function fetchImageCandidate(
  url: string,
  headers: Record<string, string> = {},
  depth = 0
): Promise<FetchedImage | null> {
  if (depth > 3) {
    return null;
  }
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "image/*,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        ...headers
      },
      redirect: "follow",
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
      if (depth >= 3) {
        return null;
      }

      const text = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(buffer));
      if (!text.trim()) {
        return null;
      }

      const candidates = new Set<string>();
      const inlineLinks = text.match(/(?:https?:\/\/|\/\/|\/)[^\s"'<>\\]+/gi) ?? [];
      for (const link of inlineLinks) {
        const normalized = normalizePossibleImageLink(link, url);
        if (normalized && isProbablyImageEndpoint(normalized)) {
          candidates.add(normalized);
        }
      }

      const trimmed = text.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          const jsonLinks = new Set<string>();
          collectLinksDeep(parsed, jsonLinks);
          for (const link of jsonLinks) {
            const normalized = normalizePossibleImageLink(link, url);
            if (normalized && isProbablyImageEndpoint(normalized)) {
              candidates.add(normalized);
            }
          }
        } catch {
        }
      }

      for (const candidateUrl of candidates) {
        if (candidateUrl === url) {
          continue;
        }
        const resolved = await fetchImageCandidate(candidateUrl, headers, depth + 1);
        if (resolved) {
          return resolved;
        }
      }
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
          return {
            ...resolved,
            sourceUrl: candidateUrl,
            sourceStage: "html-image"
          };
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
          return {
            ...resolved,
            sourceUrl: candidateUrl,
            sourceStage: "detail-api-image"
          };
        }
        const fallbackResolved = await fetchImageCandidate(candidateUrl);
        if (fallbackResolved) {
          return {
            ...fallbackResolved,
            sourceUrl: candidateUrl,
            sourceStage: "detail-api-image-fallback"
          };
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
    maxRequests: 2400,
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
  const debug = request.nextUrl.searchParams.get("debug") === "1";

  const token = await getLztAccessToken();
  const query = type ? `?type=${encodeURIComponent(type)}` : "";
  const referer = `https://lzt.market/market/${normalizedId}`;
  const browserHeaders = {
    Referer: referer,
    Origin: "https://lzt.market"
  };
  const candidates: Array<{ url: string; headers?: Record<string, string> }> = [];
  const publicCandidates = [
    { url: `https://lzt.market/${normalizedId}/image${query}` },
    { url: `https://lzt.market/market/${normalizedId}/image${query}` },
    { url: `https://lolz.guru/market/${normalizedId}/image${query}` }
  ];
  const apiCandidates = token
    ? Array.from(
        new Set([
          `${getLztBaseUrl()}/${normalizedId}/image${query}`,
          `${getLztBaseUrl()}/market/${normalizedId}/image${query}`,
          `${getLztBaseUrl()}/item/${normalizedId}/image${query}`,
          `${getLztBaseUrl()}/items/${normalizedId}/image${query}`
        ])
      ).map((url) => ({
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          ...browserHeaders
        }
      }))
    : [];
  const publicCandidatesWithoutType = [
    { url: `https://lzt.market/${normalizedId}/image` },
    { url: `https://lzt.market/market/${normalizedId}/image` },
    { url: `https://lolz.guru/market/${normalizedId}/image` }
  ];
  const apiCandidatesWithoutType = token
    ? Array.from(
        new Set([
          `${getLztBaseUrl()}/${normalizedId}/image`,
          `${getLztBaseUrl()}/market/${normalizedId}/image`,
          `${getLztBaseUrl()}/item/${normalizedId}/image`,
          `${getLztBaseUrl()}/items/${normalizedId}/image`
        ])
      ).map((url) => ({
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          ...browserHeaders
        }
      }))
    : [];

  if (type) {
    candidates.push(
      ...publicCandidates.map((candidate) => ({ ...candidate, headers: browserHeaders }))
    );
    candidates.push(...apiCandidates);
    candidates.push(...apiCandidatesWithoutType);
    candidates.push(
      ...publicCandidatesWithoutType.map((candidate) => ({ ...candidate, headers: browserHeaders }))
    );
  } else {
    candidates.push(...apiCandidates);
    candidates.push(
      ...publicCandidates.map((candidate) => ({ ...candidate, headers: browserHeaders }))
    );
  }

  let resolved: { buffer: ArrayBuffer; contentType: string } | null = null;
  let resolvedSourceUrl = "";
  let resolvedSourceStage = "";
  const attemptedCandidates: string[] = [];
  for (const candidate of candidates) {
    attemptedCandidates.push(candidate.url);
    resolved = await fetchImageCandidate(candidate.url, candidate.headers ?? {});
    if (resolved) {
      resolvedSourceUrl = candidate.url;
      resolvedSourceStage = "candidate-image";
      break;
    }
  }
  if (!resolved && token) {
    const apiResolved = await fetchListingApiImageCandidate(normalizedId, type, token);
    if (apiResolved) {
      resolved = apiResolved;
      resolvedSourceUrl = apiResolved.sourceUrl;
      resolvedSourceStage = apiResolved.sourceStage;
    }
  }
  if (!resolved) {
    const htmlResolved = await fetchListingHtmlImageCandidate(normalizedId, type);
    if (htmlResolved) {
      resolved = htmlResolved;
      resolvedSourceUrl = htmlResolved.sourceUrl;
      resolvedSourceStage = htmlResolved.sourceStage;
    }
  }
  if (debug) {
    return ok({
      listingId: normalizedId,
      type: type || null,
      tokenPresent: Boolean(token),
      attemptedCandidates,
      resolved: Boolean(resolved),
      resolvedSourceStage: resolvedSourceStage || null,
      resolvedSourceUrl: resolvedSourceUrl || null,
      contentType: resolved?.contentType ?? null
    });
  }
  if (!resolved) {
    const directUrl = `https://lzt.market/${normalizedId}/image${query}`;
    const acceptHeader = (request.headers.get("accept") ?? "").toLowerCase();
    const isImageRequest =
      acceptHeader.includes("image/") ||
      request.headers.get("sec-fetch-dest")?.toLowerCase() === "image";
    if (isImageRequest) {
      return new Response(null, {
        status: 307,
        headers: {
          Location: directUrl,
          "Referrer-Policy": "no-referrer"
        }
      });
    }
    return new Response(NO_IMAGE_SVG, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=120"
      }
    });
  }

  return new Response(resolved.buffer, {
    status: 200,
    headers: {
      "Content-Type": resolved.contentType,
      "X-AE-Image-Source-Stage": resolvedSourceStage || "candidate-image",
      "Cache-Control": "public, max-age=180, stale-while-revalidate=600"
    }
  });
}
