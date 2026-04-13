"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function LogoutButton({ className }: { className?: string }) {
  const [loading, setLoading] = useState(false);

  async function onLogout() {
    if (loading) {
      return;
    }

    setLoading(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        cache: "no-store"
      });
    } finally {
      window.location.replace("/");
    }
  }

  return (
    <Button className={className} variant="ghost" onClick={onLogout} disabled={loading}>
      {loading ? "Logging out..." : "Logout"}
    </Button>
  );
}
