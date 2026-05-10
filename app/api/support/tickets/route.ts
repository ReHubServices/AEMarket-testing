import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { getViewerFromRequest } from "@/lib/viewer";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { validateMutationRequest } from "@/lib/request-security";
import { createSupportTicket, listAllSupportTickets, listUserSupportTickets } from "@/lib/support";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const viewer = await getViewerFromRequest(request);
  if (!viewer) {
    return fail("Authentication required", 401);
  }

  const scope = request.nextUrl.searchParams.get("scope")?.trim().toLowerCase() ?? "";
  if (scope === "all" && viewer.isAdmin) {
    const tickets = await listAllSupportTickets();
    return ok({ tickets });
  }

  const tickets = await listUserSupportTickets(viewer.id);
  return ok({ tickets });
}

export async function POST(request: NextRequest) {
  const security = validateMutationRequest(request, { requireJson: true });
  if (!security.ok) {
    return fail(security.message, security.status);
  }

  const viewer = await getViewerFromRequest(request);
  if (!viewer) {
    return fail("Authentication required", 401);
  }
  if (!viewer.isAdmin) {
    const limiter = checkRateLimit({
      key: createRateKey(request, "support_ticket_create"),
      maxRequests: 3,
      windowMs: 10 * 60_000
    });
    if (!limiter.allowed) {
      return fail(`Rate limit exceeded. Retry in ${limiter.retryAfterSeconds}s`, 429);
    }
  }

  try {
    const body = (await request.json()) as { subject?: string; message?: string };
    const ticket = await createSupportTicket({
      userId: viewer.id,
      username: viewer.username,
      subject: String(body.subject ?? ""),
      message: String(body.message ?? "")
    });
    return ok({ ticket }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create ticket";
    return fail(message, 400);
  }
}
