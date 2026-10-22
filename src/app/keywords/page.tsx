import { KeywordDetails } from "@/components/KeywordDetails";
export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams;
  return <KeywordDetails initiallyOptimized={params.status === "optimized"} />;
}
