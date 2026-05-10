import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { updateStore } from "@/lib/store";
import { getViewerFromRequest } from "@/lib/viewer";
import { checkRateLimit, createRateKey } from "@/lib/rate-limit";
import { validateMutationRequest } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const security = validateMutationRequest(request, { requireJson: true });
  if (!security.ok) {
    return fail(security.message, security.status);
  }

  const limiter = checkRateLimit({
    key: createRateKey(request, "admin_content_post"),
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
      homeTitle?: string;
      homeSubtitle?: string;
      announcementText?: string;
      announcementEnabled?: boolean;
      supportAutoReplyText?: string;
    };

    const homeTitle = typeof body.homeTitle === "string" ? body.homeTitle.trim() : "";
    const homeSubtitle = typeof body.homeSubtitle === "string" ? body.homeSubtitle.trim() : "";
    const announcementText =
      typeof body.announcementText === "string" ? body.announcementText.trim() : "";
    const announcementEnabled = Boolean(body.announcementEnabled);
    const supportAutoReplyText =
      typeof body.supportAutoReplyText === "string" ? body.supportAutoReplyText.trim() : "";

    if (!homeTitle) {
      return fail("Title is required", 400);
    }
    if (!homeSubtitle) {
      return fail("Subtitle is required", 400);
    }
    if (homeTitle.length > 120) {
      return fail("Title is too long", 400);
    }
    if (homeSubtitle.length > 400) {
      return fail("Subtitle is too long", 400);
    }
    if (announcementText.length > 1200) {
      return fail("Announcement is too long", 400);
    }
    if (supportAutoReplyText.length > 2000) {
      return fail("Support auto reply is too long", 400);
    }

    const settings = await updateStore((store) => {
      store.settings.homeTitle = homeTitle;
      store.settings.homeSubtitle = homeSubtitle;
      store.settings.announcementText = announcementText;
      store.settings.announcementEnabled = announcementEnabled;
      store.settings.supportAutoReplyText = supportAutoReplyText;
      return store.settings;
    });

    return ok({ settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save content";
    return fail(message, 400);
  }
}
