import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import {
  FortniteSelectorKey,
  searchFortniteSelectorOptions
} from "@/lib/lzt-fortnite-selectors";

export const runtime = "nodejs";

type FortniteSelectorOption = {
  label: string;
  value: string;
};

const selectorTypeMap: Record<string, string[]> = {
  fortnite_outfits: ["outfit", "character"],
  fortnite_pickaxes: ["pickaxe", "harvestingtool"],
  fortnite_emotes: ["emote"],
  fortnite_gliders: ["glider"]
};

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompact(value: string) {
  return normalizeText(value).replace(/\s+/g, "");
}

function looksMachineLike(value: string) {
  return /^(?:[a-z]+_[a-z0-9_]+|[a-z]+[0-9]{2,})$/i.test(value.trim());
}

function toTitleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function humanizeNativeOption(value: string) {
  const original = value.trim();
  if (!original) {
    return "";
  }
  if (!looksMachineLike(original)) {
    return original;
  }

  let normalized = original.toLowerCase();
  normalized = normalized
    .replace(/^cid_/, "")
    .replace(/^eid_/, "")
    .replace(/^glider_/, "")
    .replace(/^character_/, "")
    .replace(/^a_\d+_/, "")
    .replace(/^\d+_/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return original;
  }
  return toTitleCase(normalized);
}

function buildNativeCandidatesFromCosmeticId(rawId: string) {
  const id = rawId.trim().toLowerCase();
  if (!id) {
    return [];
  }
  const candidates = new Set<string>();
  candidates.add(id);
  candidates.add(id.replace(/^cid_/, ""));
  candidates.add(id.replace(/^eid_/, ""));
  return Array.from(candidates).filter(Boolean);
}

function extractText(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function matchesSelectorType(item: Record<string, unknown>, selector: string) {
  const expected = selectorTypeMap[selector] ?? [];
  if (expected.length === 0) {
    return true;
  }

  const typeRecord =
    item.type && typeof item.type === "object"
      ? (item.type as Record<string, unknown>)
      : null;
  const raw = [
    extractText(typeRecord?.value),
    extractText(typeRecord?.displayValue),
    extractText(typeRecord?.backendValue),
    extractText(typeRecord?.name),
    extractText(item.type)
  ]
    .join(" ")
    .toLowerCase();

  if (!raw) {
    return true;
  }

  return expected.some((token) => raw.includes(token));
}

function scoreCandidate(query: string, candidate: string) {
  const normalizedQuery = normalizeText(query);
  const normalizedCandidate = normalizeText(candidate);
  if (!normalizedQuery || !normalizedCandidate) {
    return -1;
  }
  if (normalizedCandidate === normalizedQuery) {
    return 0;
  }
  if (normalizedCandidate.startsWith(normalizedQuery)) {
    return 1;
  }
  if (normalizedCandidate.includes(normalizedQuery)) {
    return 2;
  }
  const queryTokens = normalizedQuery.split(" ").filter((token) => token.length > 1);
  const candidateTokens = normalizedCandidate.split(" ").filter((token) => token.length > 1);
  const tokenStarts = queryTokens.every((queryToken) =>
    candidateTokens.some((candidateToken) => candidateToken.startsWith(queryToken))
  );
  if (tokenStarts) {
    return 3;
  }
  return -1;
}

export async function GET(request: NextRequest) {
  const limiter = checkRateLimit({
    key: createRateKey(request, "fortnite_cosmetics"),
    maxRequests: 120,
    windowMs: 60_000
  });
  if (!limiter.allowed) {
    return fail(`Rate limit exceeded. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const selector = request.nextUrl.searchParams.get("selector")?.trim() ?? "";
  if (query.length < 2) {
    return ok({ options: [] as FortniteSelectorOption[] });
  }
  const knownSelectorKeys = new Set<FortniteSelectorKey>([
    "fortnite_outfits",
    "fortnite_pickaxes",
    "fortnite_emotes",
    "fortnite_gliders"
  ]);
  const selectorKey = knownSelectorKeys.has(selector as FortniteSelectorKey)
    ? (selector as FortniteSelectorKey)
    : "fortnite_outfits";

  const lztOptions = await searchFortniteSelectorOptions(selectorKey, query, 220);
  const lookupByNormalized = new Map<string, string>();
  const lookupByCompact = new Map<string, string>();
  for (const option of lztOptions) {
    const normalized = normalizeText(option);
    const compact = normalizeCompact(option);
    if (normalized) {
      lookupByNormalized.set(normalized, option);
    }
    if (compact) {
      lookupByCompact.set(compact, option);
    }
  }
  const resolvedOptions = new Map<string, { option: FortniteSelectorOption; score: number }>();
  const addOption = (label: string, value: string, score: number) => {
    const normalizedLabel = normalizeText(label);
    const normalizedValue = value.trim();
    if (!normalizedLabel || !normalizedValue) {
      return;
    }
    const safeScore = score < 0 ? 9 : score;
    const key = `${normalizedLabel}::${normalizedValue.toLowerCase()}`;
    const existing = resolvedOptions.get(key);
    if (!existing || safeScore < existing.score) {
      resolvedOptions.set(key, {
        option: {
          label: label.trim(),
          value: normalizedValue
        },
        score: safeScore
      });
    }
  };

  for (const option of lztOptions) {
    const label = humanizeNativeOption(option);
    const score = Math.min(
      scoreCandidate(query, label) >= 0 ? scoreCandidate(query, label) : 9,
      scoreCandidate(query, option) >= 0 ? scoreCandidate(query, option) : 9
    );
    addOption(label, option, score);
  }

  const baseUrl = (process.env.FORTNITE_API_BASE_URL ?? "https://fortnite-api.com")
    .trim()
    .replace(/\/+$/, "");
  const apiKey = (process.env.FORTNITE_API_KEY ?? "").trim();
  const url = `${baseUrl}/v2/cosmetics/br/search/all?name=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(apiKey ? { Authorization: apiKey, "x-api-key": apiKey } : {})
      },
      cache: "no-store"
    });

    if (!response.ok) {
      return fail("Fortnite cosmetic lookup failed", 502);
    }

    const payload = (await response.json()) as { data?: unknown };
    const rows = Array.isArray(payload.data) ? payload.data : [];

    for (const row of rows) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const record = row as Record<string, unknown>;
      if (!matchesSelectorType(record, selectorKey)) {
        continue;
      }
      const name = extractText(record.name);
      if (!name || name.length < 2 || name.length > 64) {
        continue;
      }
      let nativeValue = "";
      const exactByName =
        lookupByNormalized.get(normalizeText(name)) ??
        lookupByCompact.get(normalizeCompact(name)) ??
        "";
      if (exactByName) {
        nativeValue = exactByName;
      } else {
        const cosmeticId = extractText(record.id);
        for (const candidate of buildNativeCandidatesFromCosmeticId(cosmeticId)) {
          const matched =
            lookupByNormalized.get(normalizeText(candidate)) ??
            lookupByCompact.get(normalizeCompact(candidate));
          if (matched) {
            nativeValue = matched;
            break;
          }
        }
      }
      if (!nativeValue) {
        continue;
      }
      const score = scoreCandidate(query, name);
      addOption(name, nativeValue, score >= 0 ? score : 4);
    }
  } catch {
    // Fall through to available native options when Fortnite API lookup fails.
  }

  const options = Array.from(resolvedOptions.values())
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }
      if (a.option.label.length !== b.option.label.length) {
        return a.option.label.length - b.option.label.length;
      }
      return a.option.label.localeCompare(b.option.label);
    })
    .slice(0, 220)
    .map((entry) => entry.option);

  if (options.length > 0) {
    return ok({ options });
  }
  return fail("Fortnite cosmetic lookup unavailable", 502);
}
