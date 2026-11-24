"use strict";

const HOTSPOT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PREFIX = "seo-hotspot-v1;";
const fields = new Set(["event", "at", "basis", "role", "verified"]);

function timestamp(value) {
  if (typeof value !== "string") return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second, offset] = match;
  if (+month < 1 || +month > 12 || +day < 1 || +day > new Date(Date.UTC(+year, +month, 0)).getUTCDate()
    || +hour > 23 || +minute > 59 || +second > 59
    || offset !== "Z" && (+offset.slice(1, 3) > 23 || +offset.slice(4, 6) > 59)) return NaN;
  return Date.parse(value);
}

function sourceUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    // Tracking and fragments do not turn one source into independent corroboration.
    url.hash = "";
    url.hostname = url.hostname.replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|gclid|fbclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

function parseEvidence(evidence, nowMs) {
  if (!evidence || typeof evidence.label !== "string" || evidence.label.length > 300
    || !evidence.label.startsWith(PREFIX)) return null;
  const values = {};
  for (const part of evidence.label.slice(PREFIX.length).split(";")) {
    const index = part.indexOf("=");
    const key = part.slice(0, index);
    if (index < 1 || !fields.has(key) || Object.hasOwn(values, key)) return null;
    values[key] = part.slice(index + 1);
  }
  if (Object.keys(values).length !== fields.size || values.verified !== "1"
    || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(values.event)
    || !["event", "rise"].includes(values.basis) || !["official", "demand"].includes(values.role)) return null;
  const at = timestamp(values.at);
  const observedAt = timestamp(evidence.observedAt);
  const url = sourceUrl(evidence.url);
  if (!url || !Number.isFinite(at) || !Number.isFinite(observedAt)
    || at > observedAt || observedAt > nowMs || nowMs - at > HOTSPOT_WINDOW_MS
    || nowMs - observedAt > HOTSPOT_WINDOW_MS) return null;
  return { eventKey: values.event, at, basis: values.basis, role: values.role, observedAt, url };
}

// This validates trusted research metadata; it cannot establish official ownership,
// the truth of a release, or demand independence. Researchers must verify sources.
// Eligibility, capacity, leases and publication approval stay with their existing gates.
function activeHotspotPriority(task, now = new Date()) {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return null;
  const groups = new Map();
  const evidence = [task?.evidence, task?.brief?.evidence, task?.research?.evidence]
    .flatMap(value => Array.isArray(value) ? value : []);
  for (const row of evidence) {
    const parsed = parseEvidence(row, nowMs);
    if (!parsed) continue;
    const key = JSON.stringify([parsed.eventKey, parsed.at, parsed.basis]);
    const group = groups.get(key) ?? { official: [], demand: [] };
    group[parsed.role].push(parsed);
    groups.set(key, group);
  }
  const candidates = [];
  for (const group of groups.values()) {
    group.official.sort((a, b) => b.observedAt - a.observedAt || a.url.localeCompare(b.url));
    group.demand.sort((a, b) => b.observedAt - a.observedAt || a.url.localeCompare(b.url));
    for (const official of group.official) {
      const demand = group.demand.find(row => row.url !== official.url);
      if (!demand) continue;
      candidates.push({ priority: "P0", eventKey: official.eventKey, basis: official.basis,
        at: new Date(official.at).toISOString(), expiresAt: new Date(official.at + HOTSPOT_WINDOW_MS).toISOString(),
        official: { url: official.url, observedAt: new Date(official.observedAt).toISOString() },
        demand: { url: demand.url, observedAt: new Date(demand.observedAt).toISOString() } });
      break;
    }
  }
  candidates.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.eventKey.localeCompare(b.eventKey));
  return candidates[0] ?? null;
}

function compareHotspotPriority(leftTask, rightTask, now = new Date()) {
  return Number(Boolean(activeHotspotPriority(rightTask, now))) - Number(Boolean(activeHotspotPriority(leftTask, now)));
}

module.exports = { HOTSPOT_WINDOW_MS, activeHotspotPriority, compareHotspotPriority };
