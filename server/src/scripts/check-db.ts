import { prisma } from "../lib/prisma.js";

async function checkDatabase() {
  try {
    const result = await prisma.$queryRaw<
      { version: string }[]
    >`SELECT version()`;

    console.log("Database connection successful!");
    console.log(result[0]?.version);
  } catch (error) {
    console.error("Database connection failed:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabase();