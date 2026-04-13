import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/auth/admin-login-form";
import { getViewerFromCookies } from "@/lib/viewer";
import { ensureAdminUser } from "@/lib/auth";

export const runtime = "nodejs";

export default async function AdminLoginPage() {
  await ensureAdminUser();
  const viewer = await getViewerFromCookies();
  if (viewer?.isAdmin) {
    redirect("/admin");
  }

  return (
    <main className="py-8 md:py-12">
      <AdminLoginForm />
    </main>
  );
}
