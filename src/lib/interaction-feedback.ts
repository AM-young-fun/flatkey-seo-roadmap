export type FeedbackKind = "navigation" | "read" | "action";
export type FeedbackNotice = { id: number; tone: "success" | "error"; message: string };
type Activity = { id: number; kind: FeedbackKind; label: string; startedAt: number };
type Snapshot = { activities: readonly Activity[]; notice: FeedbackNotice | null };
const empty: Snapshot = { activities: [], notice: null };

// Tab-local UI state only. No HTTP interception, retries or analytics events.
export function createInteractionFeedback(now = Date.now) {
  let snapshot = empty, sequence = 0;
  const listeners = new Set<() => void>();
  const update = (next: Snapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
  return {
    snapshot: () => snapshot,
    serverSnapshot: () => empty,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    begin(kind: FeedbackKind, label: string) {
      const id = ++sequence;
      update({ ...snapshot, notice: kind === "action" ? null : snapshot.notice, activities: [...snapshot.activities, { id, kind, label, startedAt: now() }] });
      let finished = false;
      return () => {
        if (finished) return;
        finished = true;
        update({ ...snapshot, activities: snapshot.activities.filter(activity => activity.id !== id) });
      };
    },
    notify(tone: FeedbackNotice["tone"], message: string) {
      update({ ...snapshot, notice: { id: ++sequence, tone, message } });
    },
    dismiss(id: number) {
      if (snapshot.notice?.id === id) update({ ...snapshot, notice: null });
    },
  };
}
export const interactionFeedback = createInteractionFeedback();
export const actionSucceeded = (message: string) => interactionFeedback.notify("success", message);
export const actionFailed = (message: string) => interactionFeedback.notify("error", message);
