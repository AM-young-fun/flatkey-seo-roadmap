import { KeywordType, type SearchRegion } from "@prisma/client";
import { NextResponse } from "next/server";
import { parseCsv, cleanCsvCell } from "@/lib/csv";
import { isDatabaseConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { REGION_CODES, type SearchRegionCode } from "@/lib/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CSV_BYTES = 1_000_000;
const HEADER_KEYWORD_NAMES = new Set(["keyword", "keywords", "关键词"]);
const HEADER_TOPIC_NAMES = new Set(["topic", "所属话题", "话题", "parent topic", "topic name"]);
const VOLUME_HEADERS: Record<SearchRegionCode, Set<string>> = {
  US: new Set(["volume", "us_volume", "us volume", "美国声量", "声量"]),
  JP: new Set(["jp_volume", "jp volume", "日本声量"]),
  ES: new Set(["es_volume", "es volume", "西班牙声量"]),
  BR: new Set(["br_volume", "br volume", "巴西声量"])
};

type ImportError = {
  row: number;
  keyword?: string;
  topic?: string;
  message: string;
};

type ImportEntry = {
  row: number;
  keyword: string;
  topic: string;
  volumes: Partial<Record<SearchRegionCode, number>>;
};

type HeaderIndexes = {
  keyword: number;
  topic: number;
  volumes: Partial<Record<SearchRegionCode, number>>;
};

function parseVolume(value: string): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function headerIndexes(row: string[]): HeaderIndexes | null {
  const normalized = row.map((cell) => cleanCsvCell(cell).toLowerCase());
  const keywordIndex = normalized.findIndex((cell) => HEADER_KEYWORD_NAMES.has(cell));
  const topicIndex = normalized.findIndex((cell) => HEADER_TOPIC_NAMES.has(cell));

  if (keywordIndex === -1 || topicIndex === -1) {
    return null;
  }

  const volumes = REGION_CODES.reduce(
    (accumulator, region) => {
      const index = normalized.findIndex((cell) => VOLUME_HEADERS[region].has(cell));

      if (index !== -1) {
        accumulator[region] = index;
      }

      return accumulator;
    },
    {} as HeaderIndexes["volumes"]
  );

  return {
    keyword: keywordIndex,
    topic: topicIndex,
    volumes
  };
}

function parseImportEntries(csvText: string): {
  entries: ImportEntry[];
  errors: ImportError[];
  skipped: number;
} {
  const rows = parseCsv(csvText);
  const entries: ImportEntry[] = [];
  const errors: ImportError[] = [];
  const seenKeywords = new Set<string>();
  let skipped = 0;
  const effectiveRows = rows.filter((row) => row.some((cell) => cleanCsvCell(cell).length > 0));
  const header = effectiveRows[0] ? headerIndexes(effectiveRows[0]) : null;
  const indexes: HeaderIndexes = header ?? {
    keyword: 0,
    topic: 1,
    volumes: {
      US: 2,
      JP: 3,
      ES: 4,
      BR: 5
    }
  };
  const dataRows = header ? effectiveRows.slice(1) : effectiveRows;
  const rowOffset = header ? 2 : 1;

  dataRows.forEach((row, index) => {
    const rowNumber = index + rowOffset;
    const keyword = cleanCsvCell(row[indexes.keyword]);
    const topic = cleanCsvCell(row[indexes.topic]);

    if (!keyword) {
      errors.push({
        row: rowNumber,
        message: "关键词不能为空"
      });
      return;
    }

    if (!topic) {
      errors.push({
        row: rowNumber,
        keyword,
        message: "所属话题不能为空"
      });
      return;
    }

    const normalizedKeyword = keyword.toLowerCase();
    if (seenKeywords.has(normalizedKeyword)) {
      skipped += 1;
      return;
    }

    seenKeywords.add(normalizedKeyword);
    const volumes = REGION_CODES.reduce(
      (accumulator, region) => {
        const volumeIndex = indexes.volumes[region];
        const volume = volumeIndex === undefined ? null : parseVolume(cleanCsvCell(row[volumeIndex]));

        if (volume !== null) {
          accumulator[region] = volume;
        }

        return accumulator;
      },
      {} as ImportEntry["volumes"]
    );

    entries.push({
      row: rowNumber,
      keyword,
      topic,
      volumes
    });
  });

  return {
    entries,
    errors,
    skipped
  };
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
  const topicTexts = Array.from(new Set(parsedRows.entries.map((entry) => entry.topic)));
  const keywordTexts = Array.from(new Set(parsedRows.entries.map((entry) => entry.keyword)));

  const [topics, existingKeywords] = await Promise.all([
    prisma.topic.findMany({
      where: {
        text: {
          in: topicTexts
        },
        active: true
      },
      select: {
        id: true,
        text: true
      }
    }),
    prisma.keyword.findMany({
      where: {
        text: {
          in: keywordTexts
        }
      },
      select: {
        id: true,
        text: true
      }
    })
  ]);

  const topicByText = new Map(topics.map((topic) => [topic.text, topic]));
  const existingKeywordByText = new Map(existingKeywords.map((keyword) => [keyword.text, keyword]));
  const validEntries = parsedRows.entries.filter((entry) => {
    if (topicByText.has(entry.topic)) {
      return true;
    }

    importErrors.push({
      row: entry.row,
      keyword: entry.keyword,
      topic: entry.topic,
      message: "所属话题未找到，请先导入话题"
    });
    return false;
  });

  if (validEntries.length === 0) {
    return NextResponse.json(
      {
        message: "CSV 没有可写入的关键词",
        created: 0,
        updated: 0,
        skipped: parsedRows.skipped + importErrors.length,
        errors: importErrors
      },
      {
        status: 400
      }
    );
  }

  await prisma.$transaction(async (transaction) => {
    const savedKeywordIds: string[] = [];
    const volumeRows: Array<{
      keywordId: string;
      region: SearchRegion;
      volume: number;
      source: string;
    }> = [];

    for (const entry of validEntries) {
      const topic = topicByText.get(entry.topic);

      if (!topic) {
        continue;
      }

      const existingKeyword = existingKeywordByText.get(entry.keyword);
      const usVolume = entry.volumes.US ?? 0;
      const savedKeyword = await transaction.keyword.upsert({
        where: {
          text: entry.keyword
        },
        create: {
          text: entry.keyword,
          type: KeywordType.LONG_TAIL,
          topicId: topic.id,
          defaultVolume: usVolume,
          active: true
        },
        update: {
          topicId: topic.id,
          defaultVolume: usVolume,
          active: true
        },
        select: {
          id: true
        }
      });

      if (existingKeyword) {
        updated += 1;
      } else {
        created += 1;
      }

      savedKeywordIds.push(savedKeyword.id);
      REGION_CODES.forEach((region) => {
        const volume = entry.volumes[region];

        if (volume === undefined) {
          return;
        }

        volumeRows.push({
          keywordId: savedKeyword.id,
          region: region as SearchRegion,
          volume,
          source: "csv"
        });
      });
    }

    if (savedKeywordIds.length > 0) {
      await transaction.keywordVolume.deleteMany({
        where: {
          keywordId: {
            in: savedKeywordIds
          },
          source: "csv"
        }
      });
    }

    if (volumeRows.length > 0) {
      await transaction.keywordVolume.createMany({
        data: volumeRows
      });
    }
  });

  return NextResponse.json({
    created,
    updated,
    skipped: parsedRows.skipped + importErrors.length,
    errors: importErrors
  });
}
