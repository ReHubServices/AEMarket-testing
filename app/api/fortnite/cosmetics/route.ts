import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import {
  FortniteSelectorKey,
  searchFortniteSelectorOptions
} from "@/lib/lzt-fortnite-selectors";

export const runtime = "nodejs";

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

function looksLikeMachineCode(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return (
    /^[a-z]+_[a-z0-9_]+$/i.test(trimmed) ||
    /^[a-z]+[0-9]{2,}$/i.test(trimmed)
  );
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
    return ok({ options: [] as string[] });
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
  const mostlyMachineCodes =
    lztOptions.length > 0 &&
    lztOptions.filter((option) => looksLikeMachineCode(option)).length / lztOptions.length >= 0.7;
  if (lztOptions.length > 0 && !mostlyMachineCodes) {
    return ok({ options: lztOptions });
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
    const unique = new Map<string, { value: string; score: number }>();

    for (const row of rows) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const record = row as Record<string, unknown>;
      if (!matchesSelectorType(record, selector)) {
        continue;
      }
      const name = extractText(record.name);
      if (!name || name.length < 2 || name.length > 64) {
        continue;
      }
      const score = scoreCandidate(query, name);
      if (score < 0) {
        continue;
      }
      const key = normalizeText(name);
      const existing = unique.get(key);
      if (!existing || score < existing.score) {
        unique.set(key, { value: name, score });
      }
    }

    const options = Array.from(unique.values())
      .sort((a, b) => {
        if (a.score !== b.score) {
          return a.score - b.score;
        }
        if (a.value.length !== b.value.length) {
          return a.value.length - b.value.length;
        }
        return a.value.localeCompare(b.value);
      })
      .slice(0, 220)
      .map((entry) => entry.value);

    return ok({ options });
  } catch {
    return fail("Fortnite cosmetic lookup unavailable", 502);
  }
}
