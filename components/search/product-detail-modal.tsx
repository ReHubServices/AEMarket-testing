"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketListing, PublicViewer } from "@/lib/types";
import { getListingImageWithOptions, getPresetListingImage } from "@/lib/listing-images";

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
  imageTheme?: "fortnite" | null;
};

export function ProductDetailModal({
  listing,
  viewer,
  onClose,
  onBuy,
  buying,
  descriptionLoading = false,
  descriptionError = null,
  imageTheme = null
}: ProductDetailModalProps) {
  if (!listing) {
    return null;
  }
  const specs = Array.isArray(listing.specs) ? listing.specs : [];

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/65 p-2 backdrop-blur-md md:items-center md:p-6">
      <div className="glass-panel mx-auto max-h-[96vh] w-full max-w-4xl overflow-hidden rounded-2xl md:max-h-[92vh] md:rounded-3xl">
        <div className="relative grid max-h-[96vh] gap-0 overflow-y-auto md:max-h-[92vh] md:grid-cols-[1.15fr_1fr]">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/45 text-zinc-200 transition hover:bg-black/70 md:right-4 md:top-4"
            type="button"
          >
            <X size={16} />
          </button>

          <div className="h-56 sm:h-64 md:h-full">
            <img
              src={getListingImageWithOptions(listing, {
                forceTheme: imageTheme === "fortnite" ? "fortnite" : undefined
              })}
              alt={listing.title}
              className="h-full w-full object-cover"
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = getPresetListingImage(listing, {
                  forceTheme: imageTheme === "fortnite" ? "fortnite" : undefined
                });
              }}
            />
          </div>

          <div className="space-y-5 p-4 sm:p-6 md:space-y-6 md:p-8">
            <div className="space-y-3">
              <p className="inline-flex rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-xs text-zinc-300">
                {listing.game} - {listing.category}
              </p>
              <h2 className="font-[var(--font-space-grotesk)] text-xl font-bold text-white sm:text-2xl">
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
                      className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-[130px_1fr] sm:gap-3 md:text-sm"
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

            <div className="sticky bottom-0 -mx-4 border-t border-white/15 bg-black/65 p-4 backdrop-blur sm:-mx-6 sm:px-6 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-0">
              <div className="flex flex-col gap-2">
                <Button onClick={() => onBuy(listing.id)} disabled={buying}>
                  {buying ? "Processing..." : viewer ? "Buy Now" : "Login To Buy"}
                </Button>
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
