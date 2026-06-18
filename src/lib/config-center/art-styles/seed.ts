import { prisma } from '@/lib/prisma'

const SYSTEM_ART_STYLES = [
  {
    id: 'system-american-comic',
    name: '漫画风',
    description: '日式动漫风格',
    promptZh: '日式动漫风格',
    promptEn: 'Japanese anime style',
    sortOrder: 10,
  },
  {
    id: 'system-chinese-comic',
    name: '精致国漫',
    description: '现代高质量漫画风格，动漫风格，细节丰富精致，线条锐利干净，质感饱满，超清，干净的画面风格，2D风格，动漫风格。',
    promptZh: '现代高质量漫画风格，动漫风格，细节丰富精致，线条锐利干净，质感饱满，超清，干净的画面风格，2D风格，动漫风格。',
    promptEn: 'Modern premium Chinese comic style, rich details, clean sharp line art, full texture, ultra-clear 2D anime aesthetics.',
    sortOrder: 20,
  },
  {
    id: 'system-japanese-anime',
    name: '日系动漫风',
    description: '现代日系动漫风格，赛璐璐上色，清晰干净的线条，视觉小说CG感。高质量2D风格',
    promptZh: '现代日系动漫风格，赛璐璐上色，清晰干净的线条，视觉小说CG感。高质量2D风格',
    promptEn: 'Modern Japanese anime style, cel shading, clean line art, visual-novel CG look, high-quality 2D style.',
    sortOrder: 30,
  },
  {
    id: 'system-realistic',
    name: '真人风格',
    description: '真实电影级画面质感，真实现实场景，色彩饱满通透，画面干净精致，真实感',
    promptZh: '真实电影级画面质感，真实现实场景，色彩饱满通透，画面干净精致，真实感',
    promptEn: 'Realistic cinematic look, real-world scene fidelity, rich transparent colors, clean and refined image quality.',
    sortOrder: 40,
  },
]

export interface SeedArtStylesOptions {
  force?: boolean
}

export interface SeedArtStylesResult {
  created: number
  existing: number
  total: number
}

export async function seedSystemArtStyles(
  options: SeedArtStylesOptions = {},
): Promise<SeedArtStylesResult> {
  const result: SeedArtStylesResult = {
    created: 0,
    existing: 0,
    total: 0,
  }

  for (const style of SYSTEM_ART_STYLES) {
    const existing = await prisma.artStyle.findUnique({
      where: { id: style.id },
      select: { id: true },
    })

    if (existing) {
      result.existing++
      if (options.force) {
        await prisma.artStyle.update({
          where: { id: style.id },
          data: {
            name: style.name,
            description: style.description,
            prompt: style.promptZh,
            sortOrder: style.sortOrder,
          },
        })
      }
    } else {
      await prisma.artStyle.create({
        data: {
          id: style.id,
          scope: 'system',
          ownerUserId: null,
          name: style.name,
          description: style.description,
          prompt: style.promptZh,
          previewImageUrl: null,
          sortOrder: style.sortOrder,
          enabled: true,
        },
      })
      result.created++
    }
  }

  result.total = result.created + result.existing
  return result
}
