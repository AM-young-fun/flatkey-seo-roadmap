import type { GrowthTarget, GrowthTopic } from "@/lib/growth-types";

export type KeywordPoint = { target: GrowthTarget; topic: GrowthTopic | null; x: number; y: number; radius: number; clusterId: string };
export type TopicCircle = { id: string; topic: GrowthTopic | null; x: number; y: number; radius: number; count: number };
const originalWord = (word: string) => word.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
/** Geometry depends on topic/word identity, never rank, array order, or a random force simulation. */
export function keywordCircleLayout(targets: GrowthTarget[], topics: GrowthTopic[]): { points: KeywordPoint[]; clusters: TopicCircle[] } {
  const words = new Map<string, GrowthTarget>();
  for (const target of [...targets].sort((a, b) => a.id.localeCompare(b.id))) {
    const word = originalWord(target.keyword); if (!words.has(word)) words.set(word, target);
  }
  const groups = new Map<string, { topic: GrowthTopic | null; rows: GrowthTarget[] }>();
  for (const target of words.values()) {
    const topic = topics.find(topic => topic.site === target.site && topic.topicId === target.topicId) ?? null;
    const id = topic?.id ?? `${target.site}:unassigned`;
    const group = groups.get(id) ?? { topic, rows: [] }; group.rows.push(target); groups.set(id, group);
  }
  const circles: TopicCircle[] = [];
  const ordered = [...groups].sort((a, b) => b[1].rows.length - a[1].rows.length || a[0].localeCompare(b[0]));
  for (const [id, group] of ordered) {
    const radius = Math.max(10, Math.sqrt(group.rows.length) * 6.8 + 5);
    let x = 0, y = 0;
    for (let step = 0; step < 40000; step++) {
      const angle = step * 2.399963229728653, distance = Math.sqrt(step) * 3.8;
      x = Math.cos(angle) * distance; y = Math.sin(angle) * distance;
      if (circles.every(circle => Math.hypot(circle.x - x, circle.y - y) >= circle.radius + radius + 5)) break;
    }
    circles.push({ id, topic: group.topic, x, y, radius, count: group.rows.length });
  }
  const bound = Math.max(1, ...circles.map(circle => Math.hypot(circle.x, circle.y) + circle.radius)), scale = 272 / bound;
  const clusters = circles.map(circle => ({ ...circle, x: 300 + circle.x * scale, y: 300 + circle.y * scale, radius: circle.radius * scale }));
  const points = circles.flatMap(circle => {
    const rows = groups.get(circle.id)!.rows.sort((a, b) => originalWord(a.keyword).localeCompare(originalWord(b.keyword)) || a.id.localeCompare(b.id));
    return rows.map((target, index) => {
      const angle = index * 2.399963229728653, distance = Math.sqrt((index + .5) / rows.length) * (circle.radius - 6);
      return { target, topic: circle.topic, clusterId: circle.id, x: 300 + (circle.x + Math.cos(angle) * distance) * scale, y: 300 + (circle.y + Math.sin(angle) * distance) * scale, radius: Math.min(5, Math.max(1.8, 3.5 * scale)) };
    });
  });
  return { points, clusters };
}
