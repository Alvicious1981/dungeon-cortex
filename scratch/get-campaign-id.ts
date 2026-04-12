import { PrismaClient } from '../app/generated/prisma/client'
const prisma = new PrismaClient()
async function main() {
  const campaign = await prisma.campaign.findFirst()
  console.log('CAMPAIGN_ID:', campaign?.id)
  process.exit(0)
}
main()

