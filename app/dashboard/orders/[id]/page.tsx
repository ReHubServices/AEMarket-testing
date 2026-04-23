import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getViewerFromCookies } from "@/lib/viewer";
import { getUserOrderById } from "@/lib/order-flow";
import { Button } from "@/components/ui/button";
import { LinkifiedText } from "@/components/ui/linkified-text";

export const runtime = "nodejs";

function formatPrice(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(value);
}

export default async function OrderDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await getViewerFromCookies();
  if (!viewer) {
    redirect("/login?next=/dashboard");
  }

  const { id } = await params;
  const orderId = id.trim();
  if (!orderId) {
    notFound();
  }

  const order = await getUserOrderById(viewer.id, orderId);
  if (!order) {
    notFound();
  }
  const deliveredItems = Array.isArray(order.delivery?.deliveredItems)
    ? order.delivery.deliveredItems
    : [];

  return (
    <main className="space-y-6">
      <section className="glass-panel rounded-3xl p-6 md:p-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Purchased Item</p>
            <h1 className="font-[var(--font-space-grotesk)] text-2xl font-bold text-white md:text-3xl">
              {order.title}
            </h1>
            <p className="text-sm text-zinc-300">
              {order.game} - {order.category}
            </p>
          </div>
          <div className="text-left md:text-right">
            <p className="text-sm text-zinc-400">{order.status.replace("_", " ")}</p>
            <p className="font-[var(--font-space-grotesk)] text-2xl font-bold text-white">
              {formatPrice(order.finalPrice, order.currency)}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <Link href="/dashboard">
            <Button variant="ghost" className="h-9 px-3 text-sm">Back to Dashboard</Button>
          </Link>
        </div>
      </section>

      {order.delivery && (
        <section className="glass-panel rounded-3xl p-5 md:p-6">
          <h2 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-white">
            Delivered Items
          </h2>
          <p className="mt-1 text-sm text-zinc-300">
            Full delivery data from supplier response.
          </p>

          <div className="mt-4 grid gap-3 rounded-2xl border border-white/15 bg-black/35 p-4 text-sm md:grid-cols-2">
            <div>
              <p className="text-zinc-400">Account Username</p>
              <LinkifiedText text={order.delivery.accountUsername} className="font-medium text-white" />
            </div>
            <div>
              <p className="text-zinc-400">Account Password</p>
              <LinkifiedText text={order.delivery.accountPassword} className="font-medium text-white" />
            </div>
            <div>
              <p className="text-zinc-400">Account Email</p>
              <LinkifiedText
                text={order.delivery.accountEmail || "Not provided"}
                className="font-medium text-white"
              />
            </div>
            <div>
              <p className="text-zinc-400">Notes</p>
              <LinkifiedText
                text={order.delivery.notes || "No additional notes"}
                className="font-medium text-white"
              />
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-white/15 bg-black/35">
            <div className="max-h-[65dvh] overflow-auto">
              <div className="space-y-2 p-3 sm:hidden">
                {deliveredItems.map((item, index) => (
                  <div
                    key={`${item.label}-${item.value}-${index}`}
                    className="rounded-xl border border-white/10 bg-black/30 p-3"
                  >
                    <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                      {item.label}
                    </p>
                    <LinkifiedText text={item.value} className="mt-1 text-sm text-white" />
                  </div>
                ))}
                {deliveredItems.length === 0 && (
                  <div className="px-1 py-2 text-sm text-zinc-300">
                    No delivery items were returned for this order.
                  </div>
                )}
              </div>

              <div className="hidden sm:block">
                <div className="grid grid-cols-[1.2fr_1fr] border-b border-white/10 px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-400">
                  <p>Field</p>
                  <p>Value</p>
                </div>
                {deliveredItems.map((item, index) => (
                  <div
                    key={`${item.label}-${item.value}-${index}`}
                    className="grid grid-cols-[1.2fr_1fr] gap-4 border-b border-white/5 px-4 py-2 text-sm last:border-b-0"
                  >
                    <p className="text-zinc-300">{item.label}</p>
                    <LinkifiedText text={item.value} className="text-white" />
                  </div>
                ))}
                {deliveredItems.length === 0 && (
                  <div className="px-4 py-3 text-sm text-zinc-300">
                    No delivery items were returned for this order.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
