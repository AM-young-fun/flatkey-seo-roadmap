import { researchReadAccess } from "@/lib/services/seo-research-read";
import { TopicType } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDemoDashboard } from "@/lib/demo-data";
import { isDatabaseConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createTopicSchema = z.object({
  siteDomain: z.enum(["flatkey.ai", "rackrate.org", "modelfit.cc"]).default("flatkey.ai"),
  text: z.string().trim().min(1).max(220),
  type: z.enum(["MAIN", "SUB_TOPIC"]).default("MAIN"),
  parentId: z.string().trim().min(1).nullable().optional()
});

export async function GET(request: Request) {
  const research = await researchReadAccess(request);
  if (research instanceof Response) return research;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({
      usingDemoData: true,
      topics: getDemoDashboard().topics
    });
  }

  const topics = await prisma.topic.findMany({
    where: research ? undefined : {
      active: true
    },
    include: research ? { sites: { select: { siteDomain: true } } } : undefined,
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
    topics
  }, research ? { headers: research } : undefined);
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

  const parsed = createTopicSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "Invalid topic payload"
      },
      {
        status: 400
      }
    );
  }

  const payload = parsed.data;
  const parentId = payload.type === "SUB_TOPIC" ? payload.parentId ?? null : null;

  if (parentId) {
    const parent = await prisma.topic.findUnique({
      where: {
        id: parentId
      }
    });

    if (!parent) {
      return NextResponse.json(
        {
          message: "Parent topic was not found"
        },
        {
          status: 400
        }
      );
    }

    if (parent.text === payload.text) {
      return NextResponse.json(
        {
          message: "Topic cannot be its own parent"
        },
        {
          status: 400
        }
      );
    }
  }

  const existingTopic = await prisma.topic.findUnique({
    where: {
      text: payload.text
    },
    select: {
      id: true
    }
  });

  const topic = await prisma.$transaction(async (transaction) => {
    const savedTopic = await transaction.topic.upsert({
      where: {
        text: payload.text
      },
      create: {
        text: payload.text,
        type: payload.type as TopicType,
        parentId,
        active: true
      },
      update: {
        type: payload.type as TopicType,
        parentId,
        active: true
      }
    });

    if (parentId) {
      await transaction.topicRelation.upsert({
        where: {
          parentId_childId: {
            parentId,
            childId: savedTopic.id
          }
        },
        create: {
          parentId,
          childId: savedTopic.id
        },
        update: {}
      });
    } else {
      await transaction.topicRelation.deleteMany({
        where: {
          childId: savedTopic.id
        }
      });
    }

    await transaction.siteTopic.upsert({ where: { siteDomain_topicId: { siteDomain: payload.siteDomain, topicId: savedTopic.id } }, create: { siteDomain: payload.siteDomain, topicId: savedTopic.id }, update: {} });
    return savedTopic;
  });

  return NextResponse.json(
    {
      topic,
      created: !existingTopic
    },
    {
      status: existingTopic ? 200 : 201
    }
  );
}
