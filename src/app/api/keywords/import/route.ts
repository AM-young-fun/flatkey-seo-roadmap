import { KeywordType } from "@prisma/client";
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
} {
  const rows = parseCsv(csvText);
  const entries: ImportEntry[] = [];
  const errors: ImportError[] = [];
  const seenKeywords = new Set<string>();
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

    if (seenKeywords.has(keyword)) {
      errors.push({
        row: rowNumber,
        keyword,
        message: "CSV 内关键词重复"
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

    seenKeywords.add(keyword);
    entries.push({
      row: rowNumber,
      keyword,
      parentKeyword: parentKeyword || null
    });
  });

  return {
    entries,
    errors
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
        skipped: parsedRows.errors.length,
        errors: parsedRows.errors
      },
      {
        status: 400
      }
    );
  }

  const result = await prisma.$transaction(async (transaction) => {
    let created = 0;
    let updated = 0;
    const importErrors = [...parsedRows.errors];
    const createdTexts = new Set<string>();
    const keywordByText = new Map<string, KeywordRecord>();
    const allTexts = new Set<string>();

    parsedRows.entries.forEach((entry) => {
      allTexts.add(entry.keyword);
      if (entry.parentKeyword) {
        allTexts.add(entry.parentKeyword);
      }
    });

    const existingKeywords = await transaction.keyword.findMany({
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

    async function createKeyword(
      text: string,
      type: KeywordType,
      parentId: string | null
    ): Promise<KeywordRecord> {
      const keyword = await transaction.keyword.create({
        data: {
          text,
          type,
          parentId,
          active: true
        },
        select: {
          id: true,
          text: true,
          type: true,
          active: true,
          parentId: true
        }
      });

      created += 1;
      createdTexts.add(text);
      keywordByText.set(text, keyword);
      return keyword;
    }

    async function setKeyword(
      text: string,
      type: KeywordType,
      parentId: string | null
    ): Promise<KeywordRecord> {
      const existing = keywordByText.get(text);

      if (!existing) {
        return createKeyword(text, type, parentId);
      }

      if (!needsUpdate(existing, type, parentId)) {
        return existing;
      }

      const keyword = await transaction.keyword.update({
        where: {
          id: existing.id
        },
        data: {
          type,
          parentId,
          active: true
        },
        select: {
          id: true,
          text: true,
          type: true,
          active: true,
          parentId: true
        }
      });

      if (!createdTexts.has(text)) {
        updated += 1;
      }

      keywordByText.set(text, keyword);
      return keyword;
    }

    const parentKeywords = new Set(
      parsedRows.entries
        .map((entry) => entry.parentKeyword)
        .filter((parentKeyword): parentKeyword is string => Boolean(parentKeyword))
    );

    for (const parentKeyword of parentKeywords) {
      if (!keywordByText.has(parentKeyword)) {
        await createKeyword(parentKeyword, KeywordType.MAIN, null);
      }
    }

    for (const entry of parsedRows.entries) {
      if (!entry.parentKeyword) {
        await setKeyword(entry.keyword, KeywordType.MAIN, null);
        continue;
      }

      const parent = keywordByText.get(entry.parentKeyword);

      if (!parent) {
        importErrors.push({
          row: entry.row,
          keyword: entry.keyword,
          parentKeyword: entry.parentKeyword,
          message: "父关键词未找到"
        });
        continue;
      }

      await setKeyword(entry.keyword, KeywordType.LONG_TAIL, parent.id);
    }

    return {
      created,
      updated,
      skipped: importErrors.length,
      errors: importErrors
    };
  });

  return NextResponse.json(result);
}
