"use client";

import { ReactNode, useEffect } from "react";
import { Button } from "@/components/ui/button";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
};

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
  children
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) {
        onCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loading, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
      <div className="glass-panel w-full max-w-md rounded-3xl p-6">
        <h3 className="font-[var(--font-space-grotesk)] text-xl font-semibold text-white">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-6 text-zinc-300">{description}</p>
        {children}
        <div className="mt-6 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-10"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            className={`h-10 ${
              destructive
                ? "border border-red-400/30 bg-red-500/80 text-white hover:bg-red-500"
                : ""
            }`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Processing..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
