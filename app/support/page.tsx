import { redirect } from "next/navigation";
import { getViewerFromCookies } from "@/lib/viewer";
import { listAllSupportTickets, listUserSupportTickets } from "@/lib/support";
import { SupportCenter } from "@/components/support/support-center";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const viewer = await getViewerFromCookies();
  if (!viewer) {
    redirect("/login");
  }

  const tickets = viewer.isAdmin
    ? await listAllSupportTickets()
    : await listUserSupportTickets(viewer.id);

  return <SupportCenter viewer={viewer} initialTickets={tickets} />;
}
