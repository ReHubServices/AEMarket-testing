import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewerFromCookies } from "@/lib/viewer";
import { getUserOrders } from "@/lib/order-flow";
import { Button } from "@/components/ui/button";
import { WalletReturnStatus } from "@/components/wallet/wallet-return-status";

export const runtime = "nodejs";

function formatPrice(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(value);
}

export default async function DashboardPage() {
  const viewer = await getViewerFromCookies();
  if (!viewer) {
    redirect("/login?next=/dashboard");
  }

  const orders = await getUserOrders(viewer.id);
  const latestCompleted = orders.find((order) => order.status === "completed");

  return (
    <main className="space-y-6">
      <section className="glass-panel rounded-3xl p-6 md:p-8">
        <h1 className="font-[var(--font-space-grotesk)] text-2xl font-bold text-white md:text-3xl">
          Account Dashboard
        </h1>
        <p className="mt-2 text-zinc-300">
          Manage purchases, delivery details, and balance activity.
        </p>
        <div className="mt-5 inline-flex rounded-2xl border border-white/15 bg-black/35 px-5 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Balance</p>
            <p className="font-[var(--font-space-grotesk)] text-2xl font-bold text-white">
              {formatPrice(viewer.balance, "USD")}
            </p>
          </div>
        </div>
        <div className="mt-4">
          <a href="/wallet/add-funds">
            <Button className="w-full sm:w-auto">Add Funds</Button>
          </a>
        </div>
      </section>

      <WalletReturnStatus />

      {latestCompleted && (
        <section className="glass-panel rounded-2xl border border-emerald-300/20 bg-emerald-950/20 p-4">
          <p className="text-sm text-emerald-100">
            Latest purchase delivered. Open{" "}
            <Link
              href={`/dashboard/orders/${encodeURIComponent(latestCompleted.id)}`}
              className="font-semibold underline underline-offset-2"
            >
              View Order
            </Link>{" "}
            to see full delivered items.
          </p>
        </section>
      )}

      <section className="glass-panel rounded-3xl p-5 md:p-6">
        <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-white">
          Orders
        </h2>

        {orders.length === 0 && (
          <p className="mt-4 text-sm text-zinc-300">No orders yet.</p>
        )}

        <div className="mt-4 space-y-4">
          {orders.map((order) => (
            <div key={order.id} className="rounded-2xl border border-white/15 bg-black/35 p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">{order.id}</p>
                  <p className="mt-1 font-[var(--font-space-grotesk)] text-lg font-semibold text-white">
                    {order.title}
                  </p>
                  <p className="text-sm text-zinc-300">
                    {order.game} - {order.category}
                  </p>
                </div>
                <div className="text-left md:text-right">
                  <p className="text-sm text-zinc-400">{order.status.replace("_", " ")}</p>
                  <p className="font-[var(--font-space-grotesk)] text-xl font-bold text-white">
                    {formatPrice(order.finalPrice, order.currency)}
                  </p>
                </div>
              </div>

              {order.status === "completed" && (
                <div className="mt-4 flex flex-col items-start justify-between gap-3 rounded-xl border border-white/15 bg-black/40 px-4 py-3 sm:flex-row sm:items-center">
                  <p className="text-sm text-zinc-300">
                    Delivery ready
                  </p>
                  <Link href={`/dashboard/orders/${encodeURIComponent(order.id)}`}>
                    <Button className="h-9 px-3 text-sm">View Order</Button>
                  </Link>
                </div>
              )}

              {order.status === "failed" && order.failureReason && (
                <p className="mt-4 rounded-xl border border-red-300/20 bg-red-950/20 px-3 py-2 text-sm text-red-100">
                  {order.failureReason}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
