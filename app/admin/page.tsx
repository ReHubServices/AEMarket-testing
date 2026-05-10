import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { getViewerFromCookies } from "@/lib/viewer";
import { getAdminOverview } from "@/lib/order-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const viewer = await getViewerFromCookies();
  if (!viewer?.isAdmin) {
    redirect("/admin/login");
  }

  const data = await getAdminOverview();

  return (
    <AdminDashboard
      stats={data.stats}
      settings={data.settings}
      coupons={data.coupons}
      users={data.users}
      orders={data.orders}
      transactions={data.transactions}
    />
  );
}
