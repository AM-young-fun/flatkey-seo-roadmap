export const HOTSPOT_WINDOW_MS: number;
export type HotspotPriority = { priority: "P0"; eventKey: string; basis: "event" | "rise"; at: string; expiresAt: string; official: { url: string; observedAt: string }; demand: { url: string; observedAt: string } };
export function activeHotspotPriority(task: unknown, now?: Date | string): HotspotPriority | null;
export function compareHotspotPriority(left: unknown, right: unknown, now?: Date | string): number;
