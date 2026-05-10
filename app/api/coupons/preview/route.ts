import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { getListingById } from "@/lib/provider";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { validateMutationRequest } from "@/lib/request-security";
import { readStore } from "@/lib/store";
import { normalizeMoney } from "@/lib/pricing";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const security = validateMutationRequest(request, { requireJson: true });
  if (!security.ok) {
    return fail(security.message, security.status);
  }

  const limiter = checkRateLimit({
    key: createRateKey(request, "coupon_preview"),
    maxRequests: 30,
    windowMs: 60_000
  });
  if (!limiter.allowed) {
    return fail(`Rate limit exceeded. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }

  try {
    const body = (await request.json()) as { listingId?: string; couponCode?: string };
    const listingId = String(body.listingId ?? "").trim();
    const couponCode = String(body.couponCode ?? "")
      .trim()
      .toUpperCase();

    if (!listingId) {
      return fail("Listing ID is required", 400);
    }
    if (!couponCode) {
      return fail("Coupon code is required", 400);
    }

    const [store, listing] = await Promise.all([readStore(), getListingById(listingId)]);
    if (!listing) {
      return fail("Listing not found", 404);
    }

    const coupon = store.coupons.find((item) => item.code === couponCode && item.isActive);
    if (!coupon) {
      return fail("Coupon code is invalid.", 400);
    }
    if (coupon.expiresAt) {
      const expiresAtMs = Date.parse(coupon.expiresAt);
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
        return fail("Coupon has expired.", 400);
      }
    }
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      return fail("Coupon usage limit reached.", 400);
    }

    const discountAmount = Math.min(
      listing.price,
      Math.max(0, normalizeMoney((listing.price * coupon.discountPercent) / 100))
    );
    const discountedPrice = normalizeMoney(Math.max(0.01, listing.price - discountAmount));

    return ok({
      code: coupon.code,
      discountPercent: coupon.discountPercent,
      discountAmount,
      originalPrice: listing.price,
      discountedPrice,
      currency: listing.currency
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to preview coupon";
    return fail(message, 400);
  }
}
