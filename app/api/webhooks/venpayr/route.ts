import { NextRequest } from "next/server";
import { handleVenpayrWebhook } from "./handler";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handleVenpayrWebhook(request, "webhook_venpayr");
}
