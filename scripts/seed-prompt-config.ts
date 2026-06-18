import { seedPromptConfig } from '@/lib/config-center/prompts/seed'
import { seedSystemArtStyles } from '@/lib/config-center/art-styles/seed'
import { prisma } from '@/lib/prisma'

async function main() {
  try {
    const promptResult = await seedPromptConfig()
    console.log(`Seeded prompt config: ${promptResult.definitions} definitions, ${promptResult.files} files`)

    const artStyleResult = await seedSystemArtStyles()
    console.log(`Seeded art styles: ${artStyleResult.created} created, ${artStyleResult.existing} existing, ${artStyleResult.total} total`)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

void main()
