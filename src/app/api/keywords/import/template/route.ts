const TEMPLATE_ROWS = [
  ["keyword", "topic", "us_volume", "jp_volume", "es_volume", "br_volume", "volume_observed_at"],
  ["llm api routing", "LLM API Routing", "", "", "", "", ""],
  ["llm api fallback routing", "Fallback Routing for LLM APIs", "", "", "", "", ""],
  ["speech to text api routing", "Speech-to-Text API Routing", "", "", "", "", ""]
];

function csvEscape(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const csv = TEMPLATE_ROWS.map((row) => row.map(csvEscape).join(",")).join("\r\n");

  return new Response(`\uFEFF${csv}\r\n`, {
    headers: {
      "Content-Disposition": 'attachment; filename="keyword-volume-import-template.csv"',
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
