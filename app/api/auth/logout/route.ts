import { NextRequest, NextResponse } from "next/server";
import { getSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/session";
import { fail } from "@/lib/http";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const limiter = checkRateLimit({
    key: createRateKey(request, "auth_logout"),
    maxRequests: 60,
    windowMs: 60_000
  });
  if (!limiter.allowed) {
    return fail(`Too many requests. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...getSessionCookieOptions(),
    maxAge: 0
  });
  return response;
}
