import { redirect } from "next/navigation";
import { AddFundsPanel } from "@/components/wallet/add-funds-panel";
import { getViewerFromCookies } from "@/lib/viewer";

export const runtime = "nodejs";

export default async function AddFundsPage() {
  const viewer = await getViewerFromCookies();
  if (!viewer) {
    redirect("/login?next=/wallet/add-funds");
  }

  return (
    <main className="py-5 sm:py-8 md:py-12">
      <AddFundsPanel />
    </main>
  );
}
