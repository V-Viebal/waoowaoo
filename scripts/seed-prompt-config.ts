import { seedPromptConfig } from '@/lib/config-center/prompts/seed'
import { prisma } from '@/lib/prisma'

async function main() {
  try {
    const result = await seedPromptConfig()
    console.log(`Seeded prompt config: ${result.definitions} definitions, ${result.files} files`)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

void main()
