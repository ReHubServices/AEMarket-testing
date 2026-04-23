"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LinkifiedText } from "@/components/ui/linkified-text";
import { MarketListing, PublicViewer } from "@/lib/types";
import {
  getListingImageGallery,
  getListingImageWithOptions,
  getPresetListingImage
} from "@/lib/listing-images";

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
  const hasListing = Boolean(listing);
  const safeListing = listing ?? {
    id: "",
    title: "",
    imageUrl: "",
    price: 0,
    basePrice: 0,
    currency: "USD",
    game: "",
    category: "",
    description: "",
    specs: []
  };
  const specs = Array.isArray(safeListing.specs) ? safeListing.specs : [];
  const hiddenSpecTokens = [
    "fortnite skin count",
    "fortnite pickaxe count",
    "fortnite dance count",
    "fortnite glider count",
    "fortnite shop skins count",
    "fortnite shop pickaxes count",
    "fortnite shop dances count",
    "fortnite shop gliders count"
  ];
  const visibleSpecs = specs.filter((spec) => {
    const label = String(spec.label ?? "").trim().toLowerCase();
    return !hiddenSpecTokens.some((token) => label.includes(token));
  });
  const gallery = useMemo(
    () =>
      getListingImageGallery(safeListing, {
        forceTheme: imageTheme === "fortnite" ? "fortnite" : undefined,
        preferFortniteSkins: true
      }),
    [imageTheme, safeListing]
  );
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [failedImageIndexes, setFailedImageIndexes] = useState<number[]>([]);
  const [imageLoading, setImageLoading] = useState(true);

  const getNextValidIndex = (startIndex: number, direction: 1 | -1) => {
    if (gallery.length <= 1) {
      return startIndex;
    }
    for (let step = 1; step < gallery.length; step += 1) {
      const next = (startIndex + step * direction + gallery.length) % gallery.length;
      if (!failedImageIndexes.includes(next)) {
        return next;
      }
    }
    return startIndex;
  };

  useEffect(() => {
    setActiveImageIndex(0);
    setFailedImageIndexes([]);
  }, [safeListing.id, gallery.length]);

  useEffect(() => {
    if (activeImageIndex > gallery.length - 1) {
      setActiveImageIndex(0);
    }
  }, [activeImageIndex, gallery.length]);

  const activeImage =
    gallery[activeImageIndex] ||
    getListingImageWithOptions(safeListing, {
      forceTheme: imageTheme === "fortnite" ? "fortnite" : undefined,
      preferFortniteSkins: true
    });

  useEffect(() => {
    setImageLoading(true);
  }, [activeImage, safeListing.id]);

  const hasMultipleImages = gallery.length > 1;
  const goToPreviousImage = () => {
    if (!hasMultipleImages) {
      return;
    }
    setActiveImageIndex((previous) => getNextValidIndex(previous, -1));
  };
  const goToNextImage = () => {
    if (!hasMultipleImages) {
      return;
    }
    setActiveImageIndex((previous) => getNextValidIndex(previous, 1));
  };

  if (!hasListing || !listing) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/65 p-2 backdrop-blur-md md:items-center md:p-6">
      <div className="glass-panel mx-auto max-h-[96dvh] w-full max-w-4xl overflow-hidden rounded-2xl md:max-h-[92dvh] md:rounded-3xl">
        <div className="relative grid max-h-[96dvh] gap-0 overflow-y-auto overscroll-contain md:max-h-[92dvh] md:grid-cols-[1.15fr_1fr]">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/45 text-zinc-200 transition hover:bg-black/70 md:right-4 md:top-4"
            type="button"
          >
            <X size={16} />
          </button>

          <div
            className="relative flex h-56 items-center justify-center overflow-hidden bg-black/50 sm:h-64 md:h-full"
            onClick={(event) => {
              if (!hasMultipleImages) {
                return;
              }
              const bounds = event.currentTarget.getBoundingClientRect();
              const clickX = event.clientX - bounds.left;
              const isRightHalf = clickX >= bounds.width / 2;
              if (isRightHalf) {
                goToNextImage();
              } else {
                goToPreviousImage();
              }
            }}
          >
            <img
              src={activeImage}
              alt={safeListing.title}
              className={`h-full w-full object-contain transition-opacity duration-200 ${imageLoading ? "opacity-60" : "opacity-100"}`}
              onLoad={() => {
                setImageLoading(false);
              }}
              onError={(event) => {
                event.currentTarget.onerror = null;
                setImageLoading(false);
                const nextFailed = failedImageIndexes.includes(activeImageIndex)
                  ? failedImageIndexes
                  : [...failedImageIndexes, activeImageIndex];
                setFailedImageIndexes(nextFailed);
                if (hasMultipleImages && nextFailed.length < gallery.length) {
                  const nextIndex = (() => {
                    for (let step = 1; step < gallery.length; step += 1) {
                      const next = (activeImageIndex + step) % gallery.length;
                      if (!nextFailed.includes(next)) {
                        return next;
                      }
                    }
                    return activeImageIndex;
                  })();
                  if (nextIndex !== activeImageIndex) {
                    setActiveImageIndex(nextIndex);
                    return;
                  }
                }
                event.currentTarget.src = "/listing-placeholder.svg";
              }}
            />
            {imageLoading && (
              <div className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/55 px-3 py-1 text-[11px] text-zinc-100">
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-100 [animation-delay:-200ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-100 [animation-delay:-100ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-100" />
                </span>
                <span>Loading</span>
              </div>
            )}
            {hasMultipleImages && (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    goToPreviousImage();
                  }}
                  className="absolute left-3 top-1/2 z-10 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/45 text-zinc-100 transition hover:bg-black/70"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    goToNextImage();
                  }}
                  className="absolute right-3 top-1/2 z-10 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/45 text-zinc-100 transition hover:bg-black/70"
                >
                  <ChevronRight size={18} />
                </button>
                <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/20 bg-black/45 px-2.5 py-1 text-[11px] text-zinc-100">
                  {activeImageIndex + 1}/{gallery.length}
                </div>
              </>
            )}
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
                <LinkifiedText
                  text={listing.description || "Listing details are being synchronized."}
                  className="text-sm leading-6 text-zinc-300"
                />
              )}
              {!descriptionLoading && !descriptionError && visibleSpecs.length > 0 && (
                <div className="grid gap-2 rounded-2xl border border-white/15 bg-black/30 p-3">
                  {visibleSpecs.slice(0, 14).map((spec, index) => (
                    <div
                      key={`${spec.label}-${spec.value}-${index}`}
                      className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-[130px_1fr] sm:gap-3 md:text-sm"
                    >
                      <p className="text-zinc-400">{spec.label}</p>
                      <LinkifiedText text={spec.value} className="text-zinc-200" />
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
