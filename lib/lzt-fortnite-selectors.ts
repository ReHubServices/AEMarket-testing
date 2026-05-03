import { getLztAccessToken } from "@/lib/lzt-auth";

export type FortniteSelectorKey =
  | "fortnite_outfits"
  | "fortnite_pickaxes"
  | "fortnite_emotes"
  | "fortnite_gliders";

export type FortniteSelectorResolution = {
  filters: Record<string, string>;
  fullyResolved: boolean;
  hadLookupData: boolean;
};

type SelectorOptions = Record<FortniteSelectorKey, string[]>;

const DEFAULT_LZT_API_BASE_URL = "https://prod-api.lzt.market";
const PARAMS_CACHE_TTL_MS = 15 * 60 * 1000;

const selectorParamNames: Record<FortniteSelectorKey, string> = {
  fortnite_outfits: "skin[]",
  fortnite_pickaxes: "pickaxe[]",
  fortnite_emotes: "dance[]",
  fortnite_gliders: "glider[]"
};

let paramsCache: { expiresAt: number; options: SelectorOptions } | null = null;
let inFlightOptions: Promise<SelectorOptions> | null = null;

function emptySelectorOptions(): SelectorOptions {
  return {
    fortnite_outfits: [],
    fortnite_pickaxes: [],
    fortnite_emotes: [],
    fortnite_gliders: []
  };
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompact(value: string) {
  return normalizeText(value).replace(/\s+/g, "");
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

function normalizeSupplierBaseUrl(value: string) {
  const raw = value.trim();
  if (!raw) {
    return DEFAULT_LZT_API_BASE_URL;
  }
  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_LZT_API_BASE_URL;
  }
}

function getLztBaseUrl() {
  return normalizeSupplierBaseUrl(process.env.LZT_API_BASE_URL ?? DEFAULT_LZT_API_BASE_URL);
}

function normalizeParamName(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function detectSelectorKey(paramName: string): FortniteSelectorKey | null {
  const normalized = normalizeParamName(paramName);
  if (normalized === "skin" || normalized === "skin[]") {
    return "fortnite_outfits";
  }
  if (normalized === "pickaxe" || normalized === "pickaxe[]") {
    return "fortnite_pickaxes";
  }
  if (normalized === "dance" || normalized === "dance[]") {
    return "fortnite_emotes";
  }
  if (normalized === "glider" || normalized === "glider[]") {
    return "fortnite_gliders";
  }
  return null;
}

function collectOptionStrings(source: unknown, output: string[], depth = 0) {
  if (source == null || depth > 5 || output.length >= 5000) {
    return;
  }
  if (typeof source === "string" || typeof source === "number" || typeof source === "boolean") {
    const text = extractText(source).trim();
    if (text.length >= 2 && text.length <= 96) {
      output.push(text);
    }
    return;
  }
  if (Array.isArray(source)) {
    for (const entry of source) {
      collectOptionStrings(entry, output, depth + 1);
      if (output.length >= 5000) {
        return;
      }
    }
    return;
  }
  if (typeof source !== "object") {
    return;
  }

  const record = source as Record<string, unknown>;
  const directFields = [
    "value",
    "name",
    "title",
    "label",
    "text",
    "display",
    "display_value",
    "displayValue",
    "en",
    "ru"
  ];
  for (const field of directFields) {
    if (!(field in record)) {
      continue;
    }
    const text = extractText(record[field]).trim();
    if (text.length >= 2 && text.length <= 96) {
      output.push(text);
    }
  }

  const nestedFields = ["values", "options", "items", "children", "variants", "enum", "allowed"];
  for (const field of nestedFields) {
    if (field in record) {
      collectOptionStrings(record[field], output, depth + 1);
    }
  }
}

function collectParamEntries(source: unknown, output: Array<Record<string, unknown>>, depth = 0) {
  if (source == null || depth > 6 || output.length >= 2000) {
    return;
  }
  if (Array.isArray(source)) {
    for (const entry of source) {
      collectParamEntries(entry, output, depth + 1);
      if (output.length >= 2000) {
        return;
      }
    }
    return;
  }
  if (typeof source !== "object") {
    return;
  }

  const record = source as Record<string, unknown>;
  const name = extractText(record.name ?? record.key ?? record.param ?? record.id);
  const selectorKey = detectSelectorKey(name);
  if (
    selectorKey &&
    (record.values != null ||
      record.options != null ||
      record.items != null ||
      record.allowed != null ||
      record.enum != null ||
      record.variants != null)
  ) {
    output.push(record);
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      collectParamEntries(value, output, depth + 1);
    }
  }
}

function parseSelectorOptions(payload: unknown): SelectorOptions {
  const output = emptySelectorOptions();
  const rawEntries: Array<Record<string, unknown>> = [];
  collectParamEntries(payload, rawEntries);

  for (const entry of rawEntries) {
    const name = extractText(entry.name ?? entry.key ?? entry.param ?? entry.id);
    const selectorKey = detectSelectorKey(name);
    if (!selectorKey) {
      continue;
    }

    const rawValues =
      entry.values ??
      entry.options ??
      entry.items ??
      entry.allowed ??
      entry.enum ??
      entry.variants;
    const candidates: string[] = [];
    collectOptionStrings(rawValues, candidates);
    if (candidates.length === 0) {
      continue;
    }

    const seen = new Set(output[selectorKey].map((value) => normalizeText(value)));
    for (const candidate of candidates) {
      const normalized = normalizeText(candidate);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      output[selectorKey].push(candidate.trim());
    }
  }

  return output;
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
  const compactQuery = normalizeCompact(query);
  const compactCandidate = normalizeCompact(candidate);
  if (compactQuery && compactCandidate && compactCandidate.includes(compactQuery)) {
    return 2;
  }
  const queryTokens = normalizedQuery.split(" ").filter((token) => token.length > 1);
  const candidateTokens = normalizedCandidate.split(" ").filter((token) => token.length > 1);
  if (
    queryTokens.length > 0 &&
    queryTokens.every((queryToken) =>
      candidateTokens.some(
        (candidateToken) =>
          candidateToken === queryToken ||
          candidateToken.startsWith(queryToken) ||
          queryToken.startsWith(candidateToken)
      )
    )
  ) {
    return 3;
  }
  return -1;
}

async function fetchSelectorOptionsFromApi(): Promise<SelectorOptions> {
  const token = await getLztAccessToken();
  if (!token) {
    return emptySelectorOptions();
  }

  const url = `${getLztBaseUrl()}/fortnite/params`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    return emptySelectorOptions();
  }

  const payload = (await response.json()) as unknown;
  return parseSelectorOptions(payload);
}

async function getAllSelectorOptions(): Promise<SelectorOptions> {
  const now = Date.now();
  if (paramsCache && paramsCache.expiresAt > now) {
    return paramsCache.options;
  }
  if (!inFlightOptions) {
    inFlightOptions = fetchSelectorOptionsFromApi()
      .then((options) => {
        paramsCache = {
          expiresAt: Date.now() + PARAMS_CACHE_TTL_MS,
          options
        };
        return options;
      })
      .finally(() => {
        inFlightOptions = null;
      });
  }
  return inFlightOptions;
}

export async function getFortniteSelectorOptions(selectorKey: FortniteSelectorKey) {
  const allOptions = await getAllSelectorOptions();
  return allOptions[selectorKey];
}

export async function searchFortniteSelectorOptions(
  selectorKey: FortniteSelectorKey,
  query: string,
  limit = 220
) {
  const options = await getFortniteSelectorOptions(selectorKey);
  const trimmedQuery = query.trim();
  if (!trimmedQuery || trimmedQuery.length < 2) {
    return [];
  }

  const unique = new Map<string, { value: string; score: number }>();
  for (const option of options) {
    const score = scoreCandidate(trimmedQuery, option);
    if (score < 0) {
      continue;
    }
    const key = normalizeText(option);
    const existing = unique.get(key);
    if (!existing || score < existing.score) {
      unique.set(key, { value: option, score });
    }
  }

  return Array.from(unique.values())
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }
      if (a.value.length !== b.value.length) {
        return a.value.length - b.value.length;
      }
      return a.value.localeCompare(b.value);
    })
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.value);
}

export async function resolveFortniteSelectorFilters(
  supplierFilters: Record<string, string>
): Promise<Record<string, string>> {
  const resolved = await resolveFortniteSelectorFiltersWithMeta(supplierFilters);
  return resolved.filters;
}

export async function resolveFortniteSelectorFiltersWithMeta(
  supplierFilters: Record<string, string>
): Promise<FortniteSelectorResolution> {
  const result = { ...supplierFilters };
  const keys = Object.keys(selectorParamNames) as FortniteSelectorKey[];
  const allOptions = await getAllSelectorOptions();
  let fullyResolved = true;
  let hadLookupData = false;

  for (const key of keys) {
    const raw = supplierFilters[key];
    if (!raw) {
      continue;
    }
    const values = raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (values.length === 0) {
      continue;
    }

    const selectorOptions = allOptions[key];
    if (!selectorOptions || selectorOptions.length === 0) {
      fullyResolved = false;
      continue;
    }
    hadLookupData = true;

    const normalizedLookup = new Map<string, string>();
    for (const option of selectorOptions) {
      normalizedLookup.set(normalizeText(option), option);
      normalizedLookup.set(normalizeCompact(option), option);
    }

    const resolvedValues: string[] = [];
    for (const term of values) {
      const normalized = normalizeText(term);
      const compact = normalizeCompact(term);
      const exact =
        normalizedLookup.get(normalized) ??
        normalizedLookup.get(compact);
      if (exact) {
        resolvedValues.push(exact);
        continue;
      }

      let bestMatch = "";
      let bestScore = Number.POSITIVE_INFINITY;
      for (const option of selectorOptions) {
        const score = scoreCandidate(term, option);
        if (score < 0) {
          continue;
        }
        if (score < bestScore) {
          bestScore = score;
          bestMatch = option;
        }
      }
      if (bestMatch) {
        resolvedValues.push(bestMatch);
      } else {
        fullyResolved = false;
        resolvedValues.push(term);
      }
    }

    const deduped = Array.from(
      new Map(
        resolvedValues.map((value) => [normalizeText(value), value])
      ).values()
    );
    result[key] = deduped.join(", ");
  }

  return {
    filters: result,
    fullyResolved,
    hadLookupData
  };
}
