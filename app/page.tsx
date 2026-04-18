import { MarketSearch } from "@/components/search/market-search";
import { readStore } from "@/lib/store";
import { getViewerFromCookies } from "@/lib/viewer";

export default async function HomePage() {
  const viewer = await getViewerFromCookies();
  const store = await readStore();
  return (
    <MarketSearch
      viewer={viewer}
      homeTitle={store.settings.homeTitle}
      homeSubtitle={store.settings.homeSubtitle}
      announcementEnabled={store.settings.announcementEnabled}
      announcementText={store.settings.announcementText}
    />
  );
}
