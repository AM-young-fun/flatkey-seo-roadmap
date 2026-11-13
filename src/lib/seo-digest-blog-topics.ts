const topics = [
  { label: "GPU 租赁与显存规划", match: /(?:gpu|vram|cuda|blackwell|b300|inference-server|server-gpu|servidor-gpu|rent-gpu)/i, followUp: "按模型规模补显存估算、GPU 选型和租赁成本示例。" },
  { label: "API 价格与 Token 成本", match: /(?:pricing|price|cost|token|billing|precio|custo)/i, followUp: "补按真实用量计算成本、预算和限额的教程。" },
  { label: "API 接入与平台选型", match: /(?:api|gateway|router|alternative|provider|integration)/i, followUp: "补同一任务下的供应商对比、接入示例和迁移步骤。" },
  { label: "图像、视频与提示词", match: /(?:prompt|seedance|image|video|midjourney|sora)/i, followUp: "补可复现的提示词、成品和常见失败案例。" },
  { label: "模型对比与使用", match: /(?:model|claude|gemini|gpt|deepseek|llm|qwen|kimi)/i, followUp: "补具体场景下的模型选择和实测对比。" },
] as const;

export function rankBlogTopics(pages: { url: string; value: number }[]) {
  const groups = new Map<string, { label: string; followUp: string | null; pages: number; value: number }>();
  for (const page of pages.slice(0, 10)) {
    const slug = new URL(page.url).pathname.split("/").filter(Boolean).at(-1) ?? "";
    const topic = topics.find(entry => entry.match.test(slug));
    const label = topic?.label ?? "需人工归类";
    const group = groups.get(label) ?? { label, followUp: topic?.followUp ?? null, pages: 0, value: 0 };
    group.pages++;
    group.value += page.value;
    groups.set(label, group);
  }
  return [...groups.values()].sort((a, b) => b.pages - a.pages || b.value - a.value);
}
