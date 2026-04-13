import { NextRequest } from "next/server";
import { getViewerFromRequest } from "@/lib/viewer";
import { fail, ok } from "@/lib/http";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const limiter = checkRateLimit({
    key: createRateKey(request, "auth_me"),
    maxRequests: 120,
    windowMs: 60_000
  });
  if (!limiter.allowed) {
    return fail(`Too many requests. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }

  const viewer = await getViewerFromRequest(request);
  return ok({ user: viewer });
}
