const TEMPLATE_ROWS = [
  ["topic", "parent topic"],
  ["LLM API Routing", ""],
  ["Fallback Routing for LLM APIs", "LLM API Routing"],
  ["Speech-to-Text API Routing", "LLM API Routing"]
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
      "Content-Disposition": 'attachment; filename="topic-import-template.csv"',
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
