import { GrowthTopicWorkspace } from "@/components/GrowthTopicWorkspace";

export const metadata = { title: "话题关键词 · Flatkey SEO" };

export default async function Page({ params }: { params: Promise<{ topicId: string }> }) {
  const { topicId } = await params;
  return <GrowthTopicWorkspace topicId={topicId} />;
}
