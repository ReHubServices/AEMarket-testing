import { NextRequest } from "next/server";
import { handleVenpayrWebhook } from "../venpayr/handler";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handleVenpayrWebhook(request, "webhook_card_setup");
}
