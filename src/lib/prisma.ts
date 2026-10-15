import { PrismaClient } from "@prisma/client";
import { buildDatabaseUrl } from "@/lib/database-url.cjs";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(process.env.DATABASE_URL
      ? {
          datasources: {
            db: {
              url: buildDatabaseUrl(process.env.DATABASE_URL, process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV)),
            },
          },
        }
      : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

// Next route bundles can load this module separately in the same warm process.
// Reuse one pool in production as well as development.
globalForPrisma.prisma = prisma;
