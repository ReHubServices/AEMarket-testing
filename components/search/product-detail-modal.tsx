"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketListing, PublicViewer } from "@/lib/types";
import { getListingImage, getPresetListingImage } from "@/lib/listing-images";

function formatPrice(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(value);
}

type ProductDetailModalProps = {
  listing: MarketListing | null;
  viewer: PublicViewer | null;
  onClose: () => void;
  onBuy: (listingId: string) => void;
  buying: boolean;
  descriptionLoading?: boolean;
  descriptionError?: string | null;
};

export function ProductDetailModal({
  listing,
  viewer,
  onClose,
  onBuy,
  buying,
  descriptionLoading = false,
  descriptionError = null
}: ProductDetailModalProps) {
  if (!listing) {
    return null;
  }
  const specs = Array.isArray(listing.specs) ? listing.specs : [];

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/65 p-3 backdrop-blur-md md:items-center md:p-6">
      <div className="glass-panel mx-auto w-full max-w-4xl overflow-hidden rounded-3xl">
        <div className="relative grid gap-0 md:grid-cols-[1.15fr_1fr]">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/45 text-zinc-200 transition hover:bg-black/70"
            type="button"
          >
            <X size={16} />
          </button>

          <div className="h-72 md:h-full">
            <img
              src={getListingImage(listing)}
              alt={listing.title}
              className="h-full w-full object-cover"
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = getPresetListingImage(listing);
              }}
            />
          </div>

          <div className="space-y-6 p-6 md:p-8">
            <div className="space-y-3">
              <p className="inline-flex rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-xs text-zinc-300">
                {listing.game} - {listing.category}
              </p>
              <h2 className="font-[var(--font-space-grotesk)] text-2xl font-bold text-white">
                {listing.title}
              </h2>
              {descriptionLoading && (
                <p className="text-sm leading-6 text-zinc-400">Loading full description...</p>
              )}
              {!descriptionLoading && descriptionError && (
                <p className="text-sm leading-6 text-red-200">{descriptionError}</p>
              )}
              {!descriptionLoading && !descriptionError && (
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">
                  {listing.description || "Listing details are being synchronized."}
                </p>
              )}
              {!descriptionLoading && !descriptionError && specs.length > 0 && (
                <div className="grid gap-2 rounded-2xl border border-white/15 bg-black/30 p-3">
                  {specs.slice(0, 14).map((spec, index) => (
                    <div
                      key={`${spec.label}-${spec.value}-${index}`}
                      className="grid grid-cols-[140px_1fr] gap-3 text-xs md:text-sm"
                    >
                      <p className="text-zinc-400">{spec.label}</p>
                      <p className="break-words text-zinc-200">{spec.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-2xl border border-white/15 bg-black/30 p-4 text-sm">
              <div className="flex items-center justify-between text-zinc-300">
                <span>Price</span>
                <span className="font-[var(--font-space-grotesk)] text-xl font-bold text-white">
                  {formatPrice(listing.price, listing.currency)}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button onClick={() => onBuy(listing.id)} disabled={buying}>
                {buying ? "Redirecting..." : viewer ? "Buy Now" : "Login To Buy"}
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
