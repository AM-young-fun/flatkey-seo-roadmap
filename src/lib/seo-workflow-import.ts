import { ACTION_KIND, WORKFLOW_SCHEMAS, workflowMutationSchema } from "./seo-workflow";

/** File import only stages reviewable work; approval decisions must use the explicit review UI. */
export function parseWorkflowReviewImport(input: unknown) {
  const values = Array.isArray(input) ? input : input && typeof input === "object" && "commands" in input ? (input as { commands: unknown }).commands : [input];
  if (!Array.isArray(values) || !values.length || values.length > 200) throw Error("每次导入 1–200 条执行记录");
  return values.map(value => {
    if (new TextEncoder().encode(JSON.stringify(value)).length > 512 * 1024) throw Error("单条记录不能超过 512 KB");
    const command = workflowMutationSchema.parse(value);
    if (command.claim) throw Error("文件导入不能携带自动执行租约");
    if (!["save_task", "save_issue", "save_approval", "record_historical_import"].includes(command.action)) throw Error("这里只导入待处理任务、问题、未批准审批单或历史归档");
    const record = WORKFLOW_SCHEMAS[ACTION_KIND[command.action]].parse(command.record);
    if (command.action === "save_approval") {
      const approval = WORKFLOW_SCHEMAS.approval.parse(record);
      if (!["draft", "pending"].includes(approval.status) || approval.decisions.length) throw Error("导入文件不能批准、拒绝或撤回审批；请在页面审批中明确操作");
    }
    if (command.action === "save_task") {
      const task = WORKFLOW_SCHEMAS.task.parse(record);
      if (["approved", "published", "verified", "observing"].includes(task.status) || task.approval) throw Error("不能导入已经批准或上线的任务状态；历史交付请使用历史归档");
    }
    // Validate normalized values, but preserve the exact wire payload so retrying
    // the same request through the CLI and UI keeps its idempotency hash.
    return command;
  });
}
