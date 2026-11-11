import { permanentRedirect } from "next/navigation";
import { keywordWorkspaceHref, type KeywordWorkspaceQuery } from "@/lib/keyword-workspace-routes";

export default async function Page({ searchParams }: { searchParams: Promise<KeywordWorkspaceQuery> }) {
  permanentRedirect(keywordWorkspaceHref(await searchParams, "keywords"));
}
