import { NextRequest } from "next/server";
import { createId } from "@/lib/ids";
import { fail, ok } from "@/lib/http";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { validateMutationRequest } from "@/lib/request-security";
import { readStore, updateStore } from "@/lib/store";
import { getViewerFromRequest } from "@/lib/viewer";

export const runtime = "nodejs";

function parseExpiresAt(raw: unknown) {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  const value = raw.trim();
  const hasZoneSuffix = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const dateOnlyMatch = value.match(/^(\d{4}-\d{2}-\d{2})$/);
  const dateTimeNoZoneMatch = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/);

  const toIso = (source: string) => {
    const parsed = Date.parse(source);
    if (Number.isNaN(parsed)) {
      return null;
    }
    return new Date(parsed).toISOString();
  };

  if (hasZoneSuffix) {
    return toIso(value);
  }

  if (dateOnlyMatch) {
    const now = new Date();
    const cstClock = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const hh = String(cstClock.getUTCHours()).padStart(2, "0");
    const mm = String(cstClock.getUTCMinutes()).padStart(2, "0");
    const ss = String(cstClock.getUTCSeconds()).padStart(2, "0");
    return toIso(`${dateOnlyMatch[1]}T${hh}:${mm}:${ss}-06:00`);
  }

  if (dateTimeNoZoneMatch) {
    const [, day, hm, sec] = dateTimeNoZoneMatch;
    const seconds = sec ?? "00";
    return toIso(`${day}T${hm}:${seconds}-06:00`);
  }

  return toIso(value);
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerFromRequest(request);
  if (!viewer || !viewer.isAdmin) {
    return fail("Unauthorized", 401);
  }
  const store = await readStore();
  return ok({ coupons: store.coupons });
}

export async function POST(request: NextRequest) {
  const security = validateMutationRequest(request, { requireJson: true });
  if (!security.ok) {
    return fail(security.message, security.status);
  }
  const limiter = checkRateLimit({
    key: createRateKey(request, "admin_coupon_create"),
    maxRequests: 20,
    windowMs: 60_000
  });
  if (!limiter.allowed) {
    return fail(`Rate limit exceeded. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }
  const viewer = await getViewerFromRequest(request);
  if (!viewer || !viewer.isAdmin) {
    return fail("Unauthorized", 401);
  }

  try {
    const body = (await request.json()) as {
      code?: string;
      discountPercent?: number;
      usageLimit?: number | null;
      expiresAt?: string | null;
    };
    const code = String(body.code ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    const discountPercent = Number(body.discountPercent ?? NaN);
    const usageLimitRaw = body.usageLimit;
    const usageLimit =
      usageLimitRaw === null || usageLimitRaw === undefined || usageLimitRaw === 0
        ? null
        : Math.floor(Number(usageLimitRaw));
    const expiresAt = parseExpiresAt(body.expiresAt);

    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      return fail("Coupon code must be 3-32 chars (A-Z, 0-9, _ or -)", 400);
    }
    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 95) {
      return fail("Discount percent must be between 1 and 95", 400);
    }
    if (usageLimit !== null && (!Number.isFinite(usageLimit) || usageLimit <= 0)) {
      return fail("Usage limit must be a positive number", 400);
    }

    const now = new Date().toISOString();
    const coupon = await updateStore((store) => {
      if (store.coupons.some((item) => item.code === code)) {
        throw new Error("COUPON_EXISTS");
      }
      const created = {
        id: createId("cpn"),
        code,
        discountPercent,
        isActive: true,
        usageLimit,
        usedCount: 0,
        expiresAt,
        createdAt: now,
        updatedAt: now
      };
      store.coupons.push(created);
      return created;
    });

    return ok({ coupon }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create coupon";
    if (message === "COUPON_EXISTS") {
      return fail("Coupon already exists", 409);
    }
    return fail(message, 400);
  }
}

export async function DELETE(request: NextRequest) {
  const security = validateMutationRequest(request, { requireJson: true });
  if (!security.ok) {
    return fail(security.message, security.status);
  }
  const viewer = await getViewerFromRequest(request);
  if (!viewer || !viewer.isAdmin) {
    return fail("Unauthorized", 401);
  }

  try {
    const body = (await request.json()) as { id?: string };
    const id = String(body.id ?? "").trim();
    if (!id) {
      return fail("Coupon ID is required", 400);
    }

    await updateStore((store) => {
      const before = store.coupons.length;
      store.coupons = store.coupons.filter((item) => item.id !== id);
      if (store.coupons.length === before) {
        throw new Error("COUPON_NOT_FOUND");
      }
    });
    return ok({ deleted: id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete coupon";
    if (message === "COUPON_NOT_FOUND") {
      return fail("Coupon not found", 404);
    }
    return fail(message, 400);
  }
}
