import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.campaign.findMany({ include: { encounters: true } })
  .then((c: any) => console.log(JSON.stringify(c, null, 2)))
  .catch((e: any) => console.error(e))
  .finally(() => prisma.$disconnect());
