import { seedPromptConfig } from '@/lib/config-center/prompts/seed'

seedPromptConfig()
  .then((result) => {
    console.log(`Seeded prompt config: ${result.definitions} definitions, ${result.files} files`)
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
