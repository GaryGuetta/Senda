import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  console.log("Clearing database...");
  await prisma.review.deleteMany();
  await prisma.trail.deleteMany();
  console.log("Done ✓ — base vidée, prête pour import GPX");
}

main().catch(console.error).finally(() => prisma.$disconnect());
