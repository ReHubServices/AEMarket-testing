import { redirect } from "next/navigation";
import { UserAuthForm } from "@/components/auth/user-auth-form";
import { getViewerFromCookies } from "@/lib/viewer";

export const runtime = "nodejs";

export default async function LoginPage() {
  const viewer = await getViewerFromCookies();
  if (viewer) {
    redirect("/dashboard");
  }

  return (
    <main className="py-5 sm:py-8 md:py-12">
      <UserAuthForm mode="login" />
    </main>
  );
}
