import { NextRequest } from "next/server";

type MutationSecurityOptions = {
  requireJson?: boolean;
  allowMissingOrigin?: boolean;
};

type MutationSecurityResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

function isMutationMethod(method: string) {
  const normalized = method.toUpperCase();
  return (
    normalized === "POST" ||
    normalized === "PUT" ||
    normalized === "PATCH" ||
    normalized === "DELETE"
  );
}

function isTrustedFetchSite(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "same-origin" || normalized === "same-site" || normalized === "none";
}

function normalizeHost(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function readTrustedOrigins() {
  const raw = (process.env.TRUSTED_ORIGINS ?? process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const trusted = new Set<string>();
  for (const entry of raw) {
    try {
      trusted.add(new URL(entry).origin.toLowerCase());
    } catch {
      continue;
    }
  }
  return trusted;
}

function splitHeaderValues(value: string | null) {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildExpectedOrigins(request: NextRequest) {
  const origins = new Set<string>();
  const hosts = new Set<string>();
  const forwardedHosts = splitHeaderValues(request.headers.get("x-forwarded-host"));
  const directHost = request.headers.get("host");
  const forwardedProtoRaw = splitHeaderValues(request.headers.get("x-forwarded-proto"))[0] ?? "";
  const forwardedProto =
    forwardedProtoRaw.toLowerCase() === "https" || forwardedProtoRaw.toLowerCase() === "http"
      ? forwardedProtoRaw.toLowerCase()
      : "";

  const nextUrlHost = normalizeHost(request.nextUrl.host);
  if (nextUrlHost) {
    hosts.add(nextUrlHost);
  }
  if (directHost) {
    hosts.add(normalizeHost(directHost));
  }
  for (const forwardedHost of forwardedHosts) {
    hosts.add(normalizeHost(forwardedHost));
  }

  const nextUrlOrigin = request.nextUrl.origin.trim().toLowerCase();
  if (nextUrlOrigin) {
    origins.add(nextUrlOrigin);
  }
  for (const host of hosts) {
    const normalizedHost = normalizeHost(host);
    if (!normalizedHost) {
      continue;
    }
    origins.add(`https://${normalizedHost}`);
    origins.add(`http://${normalizedHost}`);
    if (forwardedProto) {
      origins.add(`${forwardedProto}://${normalizedHost}`);
    }
  }

  return { origins, hosts };
}

export function validateMutationRequest(
  request: NextRequest,
  options: MutationSecurityOptions = {}
): MutationSecurityResult {
  if (!isMutationMethod(request.method)) {
    return { ok: true };
  }

  const allowMissingOrigin = options.allowMissingOrigin !== false;
  const origin = request.headers.get("origin");
  const expected = buildExpectedOrigins(request);
  const trustedOrigins = readTrustedOrigins();

  if (origin) {
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      return { ok: false, status: 403, message: "Invalid request origin" };
    }
    const normalizedOrigin = parsedOrigin.origin.toLowerCase();
    const normalizedHost = normalizeHost(parsedOrigin.host);
    if (
      !expected.origins.has(normalizedOrigin) &&
      !trustedOrigins.has(normalizedOrigin) &&
      !expected.hosts.has(normalizedHost)
    ) {
      return { ok: false, status: 403, message: "Untrusted request origin" };
    }
  } else if (!allowMissingOrigin) {
    return { ok: false, status: 403, message: "Missing request origin" };
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !isTrustedFetchSite(fetchSite)) {
    return { ok: false, status: 403, message: "Cross-site request blocked" };
  }

  if (options.requireJson) {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/json")) {
      return { ok: false, status: 415, message: "Content-Type must be application/json" };
    }
  }

  return { ok: true };
}
