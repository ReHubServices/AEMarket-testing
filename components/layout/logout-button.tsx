"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();

  async function onLogout() {
    await fetch("/api/auth/logout", {
      method: "POST"
    });
    router.refresh();
    router.push("/");
  }

  return (
    <Button className={className} variant="ghost" onClick={onLogout}>
      Logout
    </Button>
  );
}
