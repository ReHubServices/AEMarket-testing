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

export function validateMutationRequest(
  request: NextRequest,
  options: MutationSecurityOptions = {}
): MutationSecurityResult {
  if (!isMutationMethod(request.method)) {
    return { ok: true };
  }

  const allowMissingOrigin = options.allowMissingOrigin !== false;
  const origin = request.headers.get("origin");
  const expectedOrigin = request.nextUrl.origin;

  if (origin) {
    let normalizedOrigin = "";
    try {
      normalizedOrigin = new URL(origin).origin;
    } catch {
      return { ok: false, status: 403, message: "Invalid request origin" };
    }
    if (normalizedOrigin !== expectedOrigin) {
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
