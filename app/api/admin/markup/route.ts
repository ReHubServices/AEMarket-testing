import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { readStore } from "@/lib/store";
import { updateMarkupPercent } from "@/lib/order-flow";
import { getViewerFromRequest } from "@/lib/viewer";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { validateMutationRequest } from "@/lib/request-security";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const limiter = checkRateLimit({
    key: createRateKey(request, "admin_markup_get"),
    maxRequests: 60,
    windowMs: 60_000
  });
  if (!limiter.allowed) {
    return fail(`Rate limit exceeded. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }

  const viewer = await getViewerFromRequest(request);
  if (!viewer || !viewer.isAdmin) {
    return fail("Unauthorized", 401);
  }

  const store = await readStore();
  return ok({
    markupPercent: store.settings.markupPercent
  });
}

export async function POST(request: NextRequest) {
  const security = validateMutationRequest(request, { requireJson: true });
  if (!security.ok) {
    return fail(security.message, security.status);
  }

  const limiter = checkRateLimit({
    key: createRateKey(request, "admin_markup_post"),
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
    const body = (await request.json()) as { markupPercent?: number };
    const markupPercent = Number(body.markupPercent);
    await updateMarkupPercent(markupPercent);
    return ok({ markupPercent });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid payload";
    return fail(message, 400);
  }
}
