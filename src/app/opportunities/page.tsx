import { KeywordOpportunities } from "@/components/KeywordOpportunities";
import { KeywordDetails } from "@/components/KeywordDetails";
import { PageHeader } from "@/components/PageHeader";
import { PagePriorityWorkspace } from "@/components/PagePriorityWorkspace";
import workspace from "@/components/SeoWorkspace.module.css";
import { KeywordGoals } from "@/components/KeywordGoals";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (params.view === "priority") return <main className={workspace.shell}>
    <PageHeader active="opportunities" />
    <div className={workspace.pageSection}><PagePriorityWorkspace /></div>
  </main>;
  if (params.view === "new") return <KeywordGoals />;
  if (params.view === "analysis" || params.details || params.targetUrl) return <KeywordOpportunities />;
  return <KeywordDetails initialBusiness={params.business === "FLATKEY_API" || params.business === "CLOUD_GPU" ? params.business : "all"}
    initialSearch={typeof params.keyword === "string" ? params.keyword : ""} initiallyOptimized={params.status === "optimized"}
    initialCrossLanguage={params.crossLanguage === "1"} />;
}
