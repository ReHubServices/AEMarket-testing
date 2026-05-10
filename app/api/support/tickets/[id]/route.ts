import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { getViewerFromRequest } from "@/lib/viewer";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { validateMutationRequest } from "@/lib/request-security";
import { deleteSupportTicket } from "@/lib/support";

export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const security = validateMutationRequest(request, { requireJson: false });
  if (!security.ok) {
    return fail(security.message, security.status);
  }

  const limiter = checkRateLimit({
    key: createRateKey(request, "support_ticket_delete"),
    maxRequests: 20,
    windowMs: 60_000
  });
  if (!limiter.allowed) {
    return fail(`Rate limit exceeded. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }

  const viewer = await getViewerFromRequest(request);
  if (!viewer || !viewer.isAdmin) {
    return fail("Admin authentication required", 403);
  }

  const params = await context.params;
  const ticketId = params.id?.trim() ?? "";
  if (!ticketId) {
    return fail("Ticket ID is required", 400);
  }

  try {
    const deleted = await deleteSupportTicket(ticketId);
    return ok({ ticket: deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete ticket";
    return fail(message, message === "Ticket not found" ? 404 : 400);
  }
}
