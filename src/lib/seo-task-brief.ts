import type { WorkflowTask } from "./seo-workflow";

/** Internal prose stays Chinese; quoted queries, URLs and technical identifiers may retain their language. */
export function isChineseTaskProse(value: string, minimumHan = 8): boolean {
  const prose = value.replace(/https?:\/\/\S+|`[^`]*`|「[^」]*」|“[^”]*”|"[^"]*"/gu, " ")
    .replace(/\b(?:Flatkey|ModelFit|RackRate|NVIDIA|CUDA|GSC|GA4|SEO|API|GPU|LLM|VRAM|SSE|WebSocket|KV|LoRA|QLoRA|GGUF|Safetensors|vLLM)\b/giu, " ");
  const han = prose.match(/\p{Script=Han}/gu)?.length ?? 0;
  const foreign = prose.match(/(?!\p{Script=Han})\p{Letter}/gu)?.length ?? 0;
  return han >= minimumHan && han >= foreign;
}
const generic = (text: string) => /^(?:优化|提升|提高|改善|完善|补充)(?:优化|提升|提高|改善|完善|补充|页面|内容|seo|搜索|排名|流量|转化|效果|体验|关键词|质量|结构|点击率|表现|可见度|的|和|与|及)+$/iu.test(text.replace(/[\s\p{P}\p{S}]/gu, ""));
export function taskNeedsChineseBrief(task: WorkflowTask): boolean {
  return ["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(task.siteDomain)
    && task.channel !== "product" && task.channel !== "github" && !task.id.startsWith("codex-thread:");
}

export function workflowTaskBriefProblems(task: WorkflowTask): string[] {
  const brief = task.brief;
  if (!brief) return ["缺少中文任务说明 brief"];
  const problems: string[] = [];
  if (!isChineseTaskProse(task.title, 1)) problems.push("任务标题须用中文，原语言关键词可加引号保留");
  if (!isChineseTaskProse(brief.reason, 16) || generic(brief.reason)) problems.push("为什么做须用中文解释数据说明的问题，不能只列指标");
  if (!/(?:说明|反映|存在|导致|但|因此|需要|缺少|缺乏|尚未|未能|无法|待核|样本|不足|意图|已有|区别)/u.test(brief.reason)) problems.push("为什么做缺少问题解释或事实限制");
  if (!brief.problem || !isChineseTaskProse(brief.problem) || generic(brief.problem)) problems.push("须明确具体问题 brief.problem");
  if (!isChineseTaskProse(brief.plan, 12) || generic(brief.plan)) problems.push("具体方案须用中文说明处理动作");
  if (!brief.evidence?.length) problems.push("任务原因须关联真实来源 brief.evidence");
  if (!brief.actions?.length) problems.push("须列出具体修改与验证 brief.actions");
  for (const [index, action] of (brief.actions ?? []).entries()) {
    if (!action.target.trim() || !isChineseTaskProse(action.change) || generic(action.change)
      || !isChineseTaskProse(action.verify) || generic(action.verify)) problems.push(`第 ${index + 1} 项须写清目标页面/模块、中文修改内容及验证方法`);
  }
  if (task.nextAction && !isChineseTaskProse(task.nextAction, 1)) problems.push("任务执行说明须用中文");
  if (task.acceptanceCriteria.some(item => !isChineseTaskProse(item, 1))) problems.push("验收要求须用中文");
  return problems;
}
