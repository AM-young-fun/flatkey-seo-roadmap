import { PrismaClient } from "@prisma/client";

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
              url: (() => {
                const url = new URL(process.env.DATABASE_URL);
                if (!url.searchParams.has("connection_limit"))
                  url.searchParams.set("connection_limit", "3");
                if (!url.searchParams.has("pool_timeout"))
                  url.searchParams.set("pool_timeout", "20");
                return url.toString();
              })(),
            },
          },
        }
      : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
