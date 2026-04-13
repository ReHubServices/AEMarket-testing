import type { NextRequest } from "next/server";
import { getSessionFromCookies, getSessionFromRequest } from "@/lib/session";
import { getUserById, toPublicViewer } from "@/lib/auth";

export async function getViewerFromCookies() {
  const session = await getSessionFromCookies();
  if (!session) {
    return null;
  }
  const user = await getUserById(session.uid);
  if (!user) {
    return null;
  }
  return toPublicViewer(user);
}

export async function getViewerFromRequest(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return null;
  }
  const user = await getUserById(session.uid);
  if (!user) {
    return null;
  }
  return toPublicViewer(user);
}
