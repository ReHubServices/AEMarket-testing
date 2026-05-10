import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { getViewerFromRequest } from "@/lib/viewer";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { validateMutationRequest } from "@/lib/request-security";
import { readStore } from "@/lib/store";
import { setSupportTicketStatus } from "@/lib/support";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const security = validateMutationRequest(request, { requireJson: true });
  if (!security.ok) {
    return fail(security.message, security.status);
  }

  const limiter = checkRateLimit({
    key: createRateKey(request, "support_ticket_status"),
    maxRequests: 20,
    windowMs: 60_000
  });
  if (!limiter.allowed) {
    return fail(`Rate limit exceeded. Retry in ${limiter.retryAfterSeconds}s`, 429);
  }

  const viewer = await getViewerFromRequest(request);
  if (!viewer) {
    return fail("Authentication required", 401);
  }

  const params = await context.params;
  const ticketId = params.id?.trim() ?? "";
  if (!ticketId) {
    return fail("Ticket ID is required", 400);
  }

  try {
    const body = (await request.json()) as { status?: "open" | "closed" };
    const status = body.status === "closed" ? "closed" : "open";

    const store = await readStore();
    const ticket = store.supportTickets.find((item) => item.id === ticketId);
    if (!ticket) {
      return fail("Ticket not found", 404);
    }

    const canManage = viewer.isAdmin || ticket.userId === viewer.id;
    if (!canManage) {
      return fail("Forbidden", 403);
    }

    if (!viewer.isAdmin && status === "closed") {
      return fail("Only support can close tickets", 403);
    }

    const updated = await setSupportTicketStatus({ ticketId, status });
    return ok({ ticket: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update status";
    return fail(message, 400);
  }
}
