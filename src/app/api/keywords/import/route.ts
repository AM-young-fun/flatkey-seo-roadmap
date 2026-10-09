import { KeywordType, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { parseCsv, cleanCsvCell } from "@/lib/csv";
import { isDatabaseConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CSV_BYTES = 1_000_000;
const HEADER_KEYWORD_NAMES = new Set(["keyword", "keywords", "关键词"]);
const HEADER_PARENT_NAMES = new Set([
  "parent",
  "parent keyword",
  "parent_keyword",
  "父关键词",
  "父级关键词",
  "主关键词"
]);

type ImportError = {
  row: number;
  keyword?: string;
  parentKeyword?: string;
  message: string;
};

type ImportEntry = {
  row: number;
  keyword: string;
  parentKeyword: string | null;
};

type KeywordRecord = {
  id: string;
  text: string;
  type: KeywordType;
  active: boolean;
  parentId: string | null;
};

function isHeaderRow(row: string[]): boolean {
  const firstCell = cleanCsvCell(row[0]).toLowerCase();
  const secondCell = cleanCsvCell(row[1]).toLowerCase();
  return HEADER_KEYWORD_NAMES.has(firstCell) && HEADER_PARENT_NAMES.has(secondCell);
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
    const keyword = cleanCsvCell(row[0]);
    const parentKeyword = cleanCsvCell(row[1]);

    if (!keyword) {
      errors.push({
        row: rowNumber,
        message: "关键词不能为空"
      });
      return;
    }

    if (parentKeyword && parentKeyword === keyword) {
      errors.push({
        row: rowNumber,
        keyword,
        parentKeyword,
        message: "关键词不能指向自己"
      });
      return;
    }

    const relationKey = `${parentKeyword || "*"}\u0000${keyword}`;
    if (seenRelations.has(relationKey)) {
      skipped += 1;
      return;
    }

    seenRelations.add(relationKey);
    entries.push({
      row: rowNumber,
      keyword,
      parentKeyword: parentKeyword || null
    });
  });

  return {
    entries,
    errors,
    skipped
  };
}

function needsUpdate(
  keyword: KeywordRecord,
  type: KeywordType,
  parentId: string | null
): boolean {
  return keyword.type !== type || keyword.parentId !== parentId || !keyword.active;
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
        message: "CSV 没有有效关键词行",
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
  const keywordByText = new Map<string, KeywordRecord>();
  const allTexts = new Set<string>();
  const explicitMainTexts = new Set<string>();
  const parentKeywords = new Set<string>();
  const primaryParentByText = new Map<string, string>();

  parsedRows.entries.forEach((entry) => {
    allTexts.add(entry.keyword);

    if (entry.parentKeyword) {
      allTexts.add(entry.parentKeyword);
      parentKeywords.add(entry.parentKeyword);

      if (!primaryParentByText.has(entry.keyword)) {
        primaryParentByText.set(entry.keyword, entry.parentKeyword);
      }
    } else {
      explicitMainTexts.add(entry.keyword);
    }
  });

  const existingKeywords = await prisma.keyword.findMany({
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

  existingKeywords.forEach((keyword) => {
    keywordByText.set(keyword.text, keyword);
  });

  function keywordTypeFor(text: string): KeywordType {
    return explicitMainTexts.has(text) || parentKeywords.has(text)
      ? KeywordType.MAIN
      : KeywordType.LONG_TAIL;
  }

  const missingTexts = Array.from(allTexts).filter((text) => !keywordByText.has(text));

  if (missingTexts.length > 0) {
    const createResult = await prisma.keyword.createMany({
      data: missingTexts.map((text) => ({
        text,
        type: keywordTypeFor(text),
        active: true
      })),
      skipDuplicates: true
    });

    created = createResult.count;
    missingTexts.forEach((text) => createdTexts.add(text));
  }

  const importedKeywords = await prisma.keyword.findMany({
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

  keywordByText.clear();
  importedKeywords.forEach((keyword) => {
    keywordByText.set(keyword.text, keyword);
  });

  const keywordUpdates: Array<{
    id: string;
    text: string;
    type: KeywordType;
    parentId: string | null;
  }> = [];

  for (const text of allTexts) {
    const keyword = keywordByText.get(text);
    const primaryParentText = primaryParentByText.get(text);
    const primaryParentId = primaryParentText
      ? keywordByText.get(primaryParentText)?.id ?? null
      : null;
    const type = keywordTypeFor(text);

    if (!keyword) {
      importErrors.push({
        row: 0,
        keyword: text,
        message: "关键词写入后未找到"
      });
      continue;
    }

    if (!needsUpdate(keyword, type, primaryParentId)) {
      continue;
    }

    keywordUpdates.push({
      id: keyword.id,
      text,
      type,
      parentId: primaryParentId
    });

    if (!createdTexts.has(text)) {
      updated += 1;
    }
  }

  if (keywordUpdates.length > 0) {
    const updateValues = keywordUpdates.map((keyword) =>
      Prisma.sql`(${keyword.id}, ${keyword.type}::"KeywordType", ${keyword.parentId}::TEXT)`
    );

    await prisma.$executeRaw`
      UPDATE "Keyword" AS keyword
      SET
        "type" = data."type",
        "parentId" = data."parentId",
        "active" = true,
        "updatedAt" = CURRENT_TIMESTAMP
      FROM (VALUES ${Prisma.join(updateValues)}) AS data("id", "type", "parentId")
      WHERE keyword."id" = data."id"
    `;

    keywordUpdates.forEach((keyword) => {
      keywordByText.set(keyword.text, {
        id: keyword.id,
        text: keyword.text,
        type: keyword.type,
        active: true,
        parentId: keyword.parentId
      });
    });
  }

  const relationKeys = new Set<string>();
  const relationRows: Array<{ parentId: string; childId: string }> = [];

  for (const entry of parsedRows.entries) {
    if (!entry.parentKeyword) {
      continue;
    }

    const parent = keywordByText.get(entry.parentKeyword);
    const child = keywordByText.get(entry.keyword);

    if (!parent || !child) {
      importErrors.push({
        row: entry.row,
        keyword: entry.keyword,
        parentKeyword: entry.parentKeyword,
        message: "父关键词或子关键词未找到"
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
    await prisma.keywordRelation.createMany({
      data: relationRows,
      skipDuplicates: true
    });
  }

  const result = {
    created,
    updated,
    skipped: skipped + importErrors.length,
    errors: importErrors
  };

  return NextResponse.json(result);
}
