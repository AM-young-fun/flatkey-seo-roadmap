/* global console, process */

import { Prisma, PrismaClient, TopicType } from "@prisma/client";

const prisma = new PrismaClient();
const deactivateKeywords = process.argv.includes("--deactivate-keywords");

async function main() {
  const [keywords, relations] = await Promise.all([
    prisma.keyword.findMany({
      select: {
        id: true,
        text: true,
        type: true,
        parentId: true
      }
    }),
    prisma.keywordRelation.findMany({
      select: {
        parentId: true,
        childId: true
      }
    })
  ]);

  if (keywords.length === 0) {
    console.log("No keywords to migrate.");
    return;
  }

  const keywordById = new Map(keywords.map((keyword) => [keyword.id, keyword]));
  const parentIds = new Set(relations.map((relation) => relation.parentId));

  function topicTypeFor(keyword) {
    return keyword.type === "MAIN" || parentIds.has(keyword.id) ? TopicType.MAIN : TopicType.SUB_TOPIC;
  }

  const createResult = await prisma.topic.createMany({
    data: keywords.map((keyword) => ({
      text: keyword.text,
      type: topicTypeFor(keyword),
      active: true
    })),
    skipDuplicates: true
  });

  const topics = await prisma.topic.findMany({
    where: {
      text: {
        in: keywords.map((keyword) => keyword.text)
      }
    },
    select: {
      id: true,
      text: true
    }
  });
  const topicByText = new Map(topics.map((topic) => [topic.text, topic]));

  const updateValues = [];
  for (const keyword of keywords) {
    const topic = topicByText.get(keyword.text);
    const parentKeyword = keyword.parentId ? keywordById.get(keyword.parentId) : null;
    const parentTopic = parentKeyword ? topicByText.get(parentKeyword.text) : null;

    if (!topic) {
      continue;
    }

    updateValues.push(
      Prisma.sql`(${topic.id}, ${topicTypeFor(keyword)}::"TopicType", ${parentTopic?.id ?? null}::TEXT)`
    );
  }

  if (updateValues.length > 0) {
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
  }

  const relationKeys = new Set();
  const relationRows = relations.flatMap((relation) => {
    const parentKeyword = keywordById.get(relation.parentId);
    const childKeyword = keywordById.get(relation.childId);
    const parentTopic = parentKeyword ? topicByText.get(parentKeyword.text) : null;
    const childTopic = childKeyword ? topicByText.get(childKeyword.text) : null;

    if (!parentTopic || !childTopic || parentTopic.id === childTopic.id) {
      return [];
    }

    const relationKey = `${parentTopic.id}:${childTopic.id}`;
    if (relationKeys.has(relationKey)) {
      return [];
    }

    relationKeys.add(relationKey);
    return [
      {
        parentId: parentTopic.id,
        childId: childTopic.id
      }
    ];
  });

  const relationResult =
    relationRows.length > 0
      ? await prisma.topicRelation.createMany({
          data: relationRows,
          skipDuplicates: true
        })
      : { count: 0 };

  if (deactivateKeywords) {
    await prisma.keyword.updateMany({
      where: {
        topicId: null
      },
      data: {
        active: false
      }
    });
  }

  console.log(
    JSON.stringify(
      {
        keywords: keywords.length,
        topicsCreated: createResult.count,
        topicsUpdated: updateValues.length,
        relationsCreated: relationResult.count,
        deactivatedKeywords: deactivateKeywords
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
