// Browser timers use numeric handles; Node-based effect tests use Timeout.
type Timer = ReturnType<typeof setTimeout> | number;
type PollOptions = {
  visible?: () => boolean;
  setTimer?: (callback: () => void, delay: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};

// One pending-display retry belongs to one mounted effect. A shared read may
// finish after cleanup, so scheduling and execution both check that lifetime.
export function createPendingDisplayPoll(read: () => void, options: PollOptions = {}) {
  const visible = options.visible ?? (() => !document.hidden);
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let active = true, timer: Timer | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };
  const canRead = () => active && visible();
  return {
    isActive: () => active,
    canRead,
    cancel,
    update(pending: boolean) {
      cancel();
      if (!pending || !canRead()) return;
      timer = setTimer(() => {
        timer = undefined;
        if (canRead()) read();
      }, 5000);
    },
    dispose() { active = false; cancel(); },
  };
}
