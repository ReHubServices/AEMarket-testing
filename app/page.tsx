import { MarketSearch } from "@/components/search/market-search";
import { getViewerFromCookies } from "@/lib/viewer";

export default async function HomePage() {
  const viewer = await getViewerFromCookies();
  return <MarketSearch viewer={viewer} />;
}
