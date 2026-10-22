import { KeywordDetails } from "@/components/KeywordDetails";
import { REGION_CODES, type SearchRegionCode } from "@/lib/seo";
export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string; country?: string; keyword?: string; business?: string; crossLanguage?: string }> }) {
  const params = await searchParams;
  const country = REGION_CODES.includes(params.country as SearchRegionCode) ? params.country as SearchRegionCode : "all";
  return <KeywordDetails initiallyOptimized={params.status === "optimized"} initialCountry={country} initialSearch={params.keyword ?? ""}
    initialBusiness={params.business === "CLOUD_GPU" ? "CLOUD_GPU" : "FLATKEY_API"} initialCrossLanguage={params.crossLanguage === "1"} />;
}
