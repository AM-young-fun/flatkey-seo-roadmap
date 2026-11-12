import { KeywordOpportunities } from "@/components/KeywordOpportunities";
import { KeywordGoals } from "@/components/KeywordGoals";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // Keep existing detailed keyword/ranking deep links usable.
  return params.view === "analysis" || params.details ? <KeywordOpportunities /> : <KeywordGoals />;
}
