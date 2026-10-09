import { NextResponse } from "next/server";
import { z } from "zod";
import { getDemoDashboard } from "@/lib/demo-data";
import { isDatabaseConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createKeywordSchema = z.object({
  text: z.string().trim().min(1).max(160),
  type: z.enum(["MAIN", "LONG_TAIL"]).default("MAIN"),
  parentId: z.string().trim().min(1).nullable().optional()
});

export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({
      usingDemoData: true,
      keywords: getDemoDashboard().keywords
    });
  }

  const keywords = await prisma.keyword.findMany({
    where: {
      active: true
    },
    orderBy: [
      {
        type: "asc"
      },
      {
        text: "asc"
      }
    ]
  });

  return NextResponse.json({
    usingDemoData: false,
    keywords
  });
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

  const parsed = createKeywordSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "Invalid keyword payload"
      },
      {
        status: 400
      }
    );
  }

  const payload = parsed.data;
  const parentId = payload.type === "LONG_TAIL" ? payload.parentId ?? null : null;

  if (parentId) {
    const parent = await prisma.keyword.findUnique({
      where: {
        id: parentId
      }
    });

    if (!parent) {
      return NextResponse.json(
        {
          message: "Parent keyword was not found"
        },
        {
          status: 400
        }
      );
    }

    if (parent.text === payload.text) {
      return NextResponse.json(
        {
          message: "Keyword cannot be its own parent"
        },
        {
          status: 400
        }
      );
    }
  }

  const existingKeyword = await prisma.keyword.findUnique({
    where: {
      text: payload.text
    },
    select: {
      id: true
    }
  });

  const keyword = await prisma.$transaction(async (transaction) => {
    const savedKeyword = await transaction.keyword.upsert({
      where: {
        text: payload.text
      },
      create: {
        text: payload.text,
        type: payload.type,
        parentId,
        active: true
      },
      update: {
        type: payload.type,
        parentId,
        active: true
      }
    });

    if (parentId) {
      await transaction.keywordRelation.upsert({
        where: {
          parentId_childId: {
            parentId,
            childId: savedKeyword.id
          }
        },
        create: {
          parentId,
          childId: savedKeyword.id
        },
        update: {}
      });
    } else {
      await transaction.keywordRelation.deleteMany({
        where: {
          childId: savedKeyword.id
        }
      });
    }

    return savedKeyword;
  });

  return NextResponse.json(
    {
      keyword,
      created: !existingKeyword
    },
    {
      status: existingKeyword ? 200 : 201
    }
  );
}
