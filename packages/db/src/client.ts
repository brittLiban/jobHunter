import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const DEFAULT_DATABASE_URL = "postgresql://jobhunter:jobhunter@localhost:5432/jobhunter";

export function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

declare global {
  // eslint-disable-next-line no-var
  var __jobhunterPrisma__: PrismaClient | undefined;
}

export const prisma = globalThis.__jobhunterPrisma__ ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__jobhunterPrisma__ = prisma;
}
