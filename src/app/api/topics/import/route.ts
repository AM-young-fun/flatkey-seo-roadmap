import { Prisma, TopicType } from "@prisma/client";
import { NextResponse } from "next/server";
import { parseCsv, cleanCsvCell } from "@/lib/csv";
import { isDatabaseConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CSV_BYTES = 1_000_000;
const HEADER_TOPIC_NAMES = new Set(["topic", "topics", "keyword", "keywords", "话题", "关键词"]);
const HEADER_PARENT_NAMES = new Set([
  "parent",
  "parent topic",
  "parent_topic",
  "parent keyword",
  "parent_keyword",
  "父话题",
  "父级话题",
  "父关键词",
  "父级关键词",
  "主话题",
  "主关键词"
]);

type ImportError = {
  row: number;
  topic?: string;
  parentTopic?: string;
  message: string;
};

type ImportEntry = {
  row: number;
  topic: string;
  parentTopic: string | null;
};

type TopicRecord = {
  id: string;
  text: string;
  type: TopicType;
  active: boolean;
  parentId: string | null;
};

function isHeaderRow(row: string[]): boolean {
  const firstCell = cleanCsvCell(row[0]).toLowerCase();
  const secondCell = cleanCsvCell(row[1]).toLowerCase();
  return HEADER_TOPIC_NAMES.has(firstCell) && HEADER_PARENT_NAMES.has(secondCell);
}

function parseImportEntries(csvText: string): {
  entries: ImportEntry[];
  errors: ImportError[];
  skipped: number;
} {
  const rows = parseCsv(csvText);
  const entries: ImportEntry[] = [];
  const errors: ImportError[] = [];
  const seenRelations = new Set<string>();
  let skipped = 0;
  const effectiveRows = rows.filter((row) => row.some((cell) => cleanCsvCell(cell).length > 0));
  const dataRows = effectiveRows[0] && isHeaderRow(effectiveRows[0]) ? effectiveRows.slice(1) : effectiveRows;
  const rowOffset = effectiveRows[0] && isHeaderRow(effectiveRows[0]) ? 2 : 1;

  dataRows.forEach((row, index) => {
    const rowNumber = index + rowOffset;
    const topic = cleanCsvCell(row[0]);
    const parentTopic = cleanCsvCell(row[1]);

    if (!topic) {
      errors.push({
        row: rowNumber,
        message: "话题不能为空"
      });
      return;
    }

    if (parentTopic && parentTopic === topic) {
      errors.push({
        row: rowNumber,
        topic,
        parentTopic,
        message: "话题不能指向自己"
      });
      return;
    }

    const relationKey = `${parentTopic || "*"}\u0000${topic}`;
    if (seenRelations.has(relationKey)) {
      skipped += 1;
      return;
    }

    seenRelations.add(relationKey);
    entries.push({
      row: rowNumber,
      topic,
      parentTopic: parentTopic || null
    });
  });

  return {
    entries,
    errors,
    skipped
  };
}

function needsUpdate(topic: TopicRecord, type: TopicType, parentId: string | null): boolean {
  return topic.type !== type || topic.parentId !== parentId || !topic.active;
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        message: "DATABASE_URL is not configured"
      },
      {
        status: 503
      }
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      {
        message: "需要上传 CSV 文件"
      },
      {
        status: 400
      }
    );
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      {
        message: "需要上传 CSV 文件"
      },
      {
        status: 400
      }
    );
  }

  if (file.size > MAX_CSV_BYTES) {
    return NextResponse.json(
      {
        message: "CSV 文件过大"
      },
      {
        status: 400
      }
    );
  }

  let parsedRows: ReturnType<typeof parseImportEntries>;

  try {
    parsedRows = parseImportEntries(await file.text());
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "CSV 格式无效"
      },
      {
        status: 400
      }
    );
  }

  if (parsedRows.entries.length === 0) {
    return NextResponse.json(
      {
        message: "CSV 没有有效话题行",
        created: 0,
        updated: 0,
        skipped: parsedRows.skipped + parsedRows.errors.length,
        errors: parsedRows.errors
      },
      {
        status: 400
      }
    );
  }

  let created = 0;
  let updated = 0;
  const importErrors = [...parsedRows.errors];
  const skipped = parsedRows.skipped;
  const createdTexts = new Set<string>();
  const topicByText = new Map<string, TopicRecord>();
  const allTexts = new Set<string>();
  const explicitMainTexts = new Set<string>();
  const parentTopics = new Set<string>();
  const primaryParentByText = new Map<string, string>();

  parsedRows.entries.forEach((entry) => {
    allTexts.add(entry.topic);

    if (entry.parentTopic) {
      allTexts.add(entry.parentTopic);
      parentTopics.add(entry.parentTopic);

      if (!primaryParentByText.has(entry.topic)) {
        primaryParentByText.set(entry.topic, entry.parentTopic);
      }
    } else {
      explicitMainTexts.add(entry.topic);
    }
  });

  const existingTopics = await prisma.topic.findMany({
    where: {
      text: {
        in: Array.from(allTexts)
      }
    },
    select: {
      id: true,
      text: true,
      type: true,
      active: true,
      parentId: true
    }
  });

  existingTopics.forEach((topic) => {
    topicByText.set(topic.text, topic);
  });

  function topicTypeFor(text: string): TopicType {
    return explicitMainTexts.has(text) || parentTopics.has(text) ? TopicType.MAIN : TopicType.SUB_TOPIC;
  }

  const missingTexts = Array.from(allTexts).filter((text) => !topicByText.has(text));

  if (missingTexts.length > 0) {
    const createResult = await prisma.topic.createMany({
      data: missingTexts.map((text) => ({
        text,
        type: topicTypeFor(text),
        active: true
      })),
      skipDuplicates: true
    });

    created = createResult.count;
    missingTexts.forEach((text) => createdTexts.add(text));
  }

  const importedTopics = await prisma.topic.findMany({
    where: {
      text: {
        in: Array.from(allTexts)
      }
    },
    select: {
      id: true,
      text: true,
      type: true,
      active: true,
      parentId: true
    }
  });

  topicByText.clear();
  importedTopics.forEach((topic) => {
    topicByText.set(topic.text, topic);
  });

  const topicUpdates: Array<{
    id: string;
    text: string;
    type: TopicType;
    parentId: string | null;
  }> = [];

  for (const text of allTexts) {
    const topic = topicByText.get(text);
    const primaryParentText = primaryParentByText.get(text);
    const primaryParentId = primaryParentText ? topicByText.get(primaryParentText)?.id ?? null : null;
    const type = topicTypeFor(text);

    if (!topic) {
      importErrors.push({
        row: 0,
        topic: text,
        message: "话题写入后未找到"
      });
      continue;
    }

    if (!needsUpdate(topic, type, primaryParentId)) {
      continue;
    }

    topicUpdates.push({
      id: topic.id,
      text,
      type,
      parentId: primaryParentId
    });

    if (!createdTexts.has(text)) {
      updated += 1;
    }
  }

  if (topicUpdates.length > 0) {
    const updateValues = topicUpdates.map((topic) =>
      Prisma.sql`(${topic.id}, ${topic.type}::"TopicType", ${topic.parentId}::TEXT)`
    );

    await prisma.$executeRaw`
      UPDATE "Topic" AS topic
      SET
        "type" = data."type",
        "parentId" = data."parentId",
        "active" = true,
        "updatedAt" = CURRENT_TIMESTAMP
      FROM (VALUES ${Prisma.join(updateValues)}) AS data("id", "type", "parentId")
      WHERE topic."id" = data."id"
    `;

    topicUpdates.forEach((topic) => {
      topicByText.set(topic.text, {
        id: topic.id,
        text: topic.text,
        type: topic.type,
        active: true,
        parentId: topic.parentId
      });
    });
  }

  const relationKeys = new Set<string>();
  const relationRows: Array<{ parentId: string; childId: string }> = [];

  for (const entry of parsedRows.entries) {
    if (!entry.parentTopic) {
      continue;
    }

    const parent = topicByText.get(entry.parentTopic);
    const child = topicByText.get(entry.topic);

    if (!parent || !child) {
      importErrors.push({
        row: entry.row,
        topic: entry.topic,
        parentTopic: entry.parentTopic,
        message: "父话题或子话题未找到"
      });
      continue;
    }

    const relationKey = `${parent.id}\u0000${child.id}`;
    if (relationKeys.has(relationKey)) {
      continue;
    }

    relationKeys.add(relationKey);
    relationRows.push({
      parentId: parent.id,
      childId: child.id
    });
  }

  if (relationRows.length > 0) {
    await prisma.topicRelation.createMany({
      data: relationRows,
      skipDuplicates: true
    });
  }

  return NextResponse.json({
    created,
    updated,
    skipped: skipped + importErrors.length,
    errors: importErrors
  });
}
