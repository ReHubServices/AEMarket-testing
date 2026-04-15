import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/auth/admin-login-form";
import { getViewerFromCookies } from "@/lib/viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const viewer = await getViewerFromCookies();
  if (viewer?.isAdmin) {
    redirect("/admin");
  }

  return (
    <main className="py-5 sm:py-8 md:py-12">
      <AdminLoginForm />
    </main>
  );
}
