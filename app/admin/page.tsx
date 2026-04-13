import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { getViewerFromCookies } from "@/lib/viewer";
import { ensureAdminUser } from "@/lib/auth";
import { getAdminOverview } from "@/lib/order-flow";

export const runtime = "nodejs";

export default async function AdminPage() {
  await ensureAdminUser();
  const viewer = await getViewerFromCookies();
  if (!viewer?.isAdmin) {
    redirect("/admin/login");
  }

  const data = await getAdminOverview();

  return (
    <AdminDashboard
      stats={data.stats}
      settings={data.settings}
      users={data.users}
      orders={data.orders}
      transactions={data.transactions}
    />
  );
}
