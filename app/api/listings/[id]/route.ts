import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { getListingById } from "@/lib/provider";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const limiter = checkRateLimit({
    key: createRateKey(request, "listing_detail"),
    maxRequests: 120,
    windowMs: 60_000
  });
  if (!limiter.allowed) {
    return fail(`Rate limit exceeded. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return fail("Listing ID is required", 400);
  }

  const listing = await getListingById(id);
  if (!listing) {
    return fail("Listing not found", 404);
  }

  return ok({ listing });
}
