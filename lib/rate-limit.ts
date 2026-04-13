import type { NextRequest } from "next/server";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "unknown";
}

function cleanupExpired(now: number) {
  if (buckets.size < 5000) {
    return;
  }
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function checkRateLimit(input: {
  key: string;
  maxRequests: number;
  windowMs: number;
}) {
  const now = Date.now();
  cleanupExpired(now);

  const existing = buckets.get(input.key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(input.key, {
      count: 1,
      resetAt: now + input.windowMs
    });
    return {
      allowed: true,
      remaining: Math.max(0, input.maxRequests - 1),
      retryAfterSeconds: Math.ceil(input.windowMs / 1000)
    };
  }

  if (existing.count >= input.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
    };
  }

  existing.count += 1;
  buckets.set(input.key, existing);
  return {
    allowed: true,
    remaining: Math.max(0, input.maxRequests - existing.count),
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
  };
}

export function createRateKey(request: NextRequest, scope: string, extra?: string) {
  const ip = getClientIp(request);
  return extra ? `${scope}:${ip}:${extra}` : `${scope}:${ip}`;
}
