import type { WorkflowStoredRow } from "./seo-workflow-state";

// The explicit workList read model never edits records or displays their body.
// Keep all identity, evidence, progress, approval and rollback inputs used by the
// list; full snapshots and taskId reads remain the source for editing/review.
export const WORK_LIST_TASK_DETAIL_KEYS = ["brief", "research", "approval", "acceptanceCriteria"];
export const WORK_LIST_APPROVAL_ITEM_DETAIL_KEYS = ["reviewContent", "beforeContent"];

const omit = (value: object, keys: string[]) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

/** Local-preview equivalent of the database JSON projection. */
export function workflowListRecords(rows: WorkflowStoredRow[]): WorkflowStoredRow[] {
  return rows.map(row => {
    if (row.kind === "task") return { ...row, record: omit(row.record, WORK_LIST_TASK_DETAIL_KEYS) as typeof row.record };
    if (row.kind === "approval" && "items" in row.record) return { ...row, record: {
      ...row.record,
      items: row.record.items.map(item => omit(item, WORK_LIST_APPROVAL_ITEM_DETAIL_KEYS)),
    } as typeof row.record };
    return row;
  });
}
