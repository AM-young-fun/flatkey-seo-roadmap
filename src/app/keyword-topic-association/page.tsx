import { KeywordTopicAssociation } from "@/components/KeywordTopicAssociation";
import { topicAssociationIdentitySchema } from "@/lib/site-topic-association";

export const metadata = { title: "关键词话题关联 · Flatkey SEO" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const input = await searchParams;
  const parsed = topicAssociationIdentitySchema.safeParse(input);
  return <KeywordTopicAssociation identity={parsed.success ? parsed.data : null} />;
}
