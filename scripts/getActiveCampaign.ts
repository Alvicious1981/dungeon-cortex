import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const campaign = await prisma.campaign.findFirst({
    where: {
      encounters: {
        some: {
          status: 'active'
        }
      }
    },
    select: {
      id: true,
    }
  });
  console.log(campaign ? campaign.id : 'NO_ACTIVE_CAMPAIGNS');
}

main().finally(() => prisma.$disconnect());
