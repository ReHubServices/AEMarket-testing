import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { updateStore } from "@/lib/store";
import { getViewerFromRequest } from "@/lib/viewer";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { validateMutationRequest } from "@/lib/request-security";

type EntityType = "user" | "order" | "transaction";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest) {
  const security = validateMutationRequest(request, { requireJson: true });
  if (!security.ok) {
    return fail(security.message, security.status);
  }

  const limiter = checkRateLimit({
    key: createRateKey(request, "admin_manage_delete"),
    maxRequests: 30,
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
    const body = (await request.json()) as { entity?: EntityType; id?: string };
    const entity = body.entity;
    const id = body.id?.trim();

    if (!entity || !id) {
      return fail("Entity and ID are required", 400);
    }

    const result = await updateStore((store) => {
      if (entity === "user") {
        const target = store.users.find((item) => item.id === id);
        if (!target) {
          throw new Error("User not found");
        }
        if (target.isAdmin) {
          throw new Error("Admin user cannot be deleted");
        }

        store.users = store.users.filter((item) => item.id !== id);
        const orderIds = new Set(
          store.orders.filter((order) => order.userId === id).map((order) => order.id)
        );
        store.orders = store.orders.filter((order) => order.userId !== id);
        store.transactions = store.transactions.filter(
          (tx) => tx.userId !== id && (!tx.orderId || !orderIds.has(tx.orderId))
        );
        return { deleted: "user", id };
      }

      if (entity === "order") {
        const exists = store.orders.some((item) => item.id === id);
        if (!exists) {
          throw new Error("Order not found");
        }
        store.orders = store.orders.filter((item) => item.id !== id);
        store.transactions = store.transactions.filter((item) => item.orderId !== id);
        return { deleted: "order", id };
      }

      if (entity === "transaction") {
        const exists = store.transactions.some((item) => item.id === id);
        if (!exists) {
          throw new Error("Transaction not found");
        }
        store.transactions = store.transactions.filter((item) => item.id !== id);
        return { deleted: "transaction", id };
      }

      throw new Error("Unsupported entity");
    });

    return ok(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed";
    return fail(message, 400);
  }
}
