
/**
 * 画风服务工具函数
 *
 * 提供静态和动态的画风查找功能，适配 React 组件和普通函数场景
 *
 * 命名约定：
 * - 系统风格 ID: system-{styleValue} 如 system-realistic
 * - 用户风格 ID: 自定义
 */

import { ART_STYLES } from '@/lib/constants'

/**
 * 将数据库风格 ID 转换为常量 value（向后兼容）
 * 通过命名约定实现：system-realistic → realistic（去掉 system- 前缀）
 */
export function normalizeArtStyleId(styleId: string | null | undefined): string | null {
  if (styleId == null) return null // null or undefined
  if (styleId === '') return ''
  // 通过命名约定去掉 system- 前缀
  if (styleId.startsWith('system-')) {
    return styleId.slice(7)
  }
  return styleId
}

/**
 * 获取画风标签（同步版本，适用于非 React 组件环境）
 * 使用静态常量作为后备
 * 对于不在常量中的自定义风格，返回原始 ID
 */
export function getArtStyleLabelSync(styleId: string | null | undefined, fallback?: string): string {
  if (!styleId) return fallback ?? ''
  const normalizedId = normalizeArtStyleId(styleId)
  const style = ART_STYLES.find((s) => s.value === normalizedId)
  return style?.label ?? fallback ?? styleId
}

/**
 * 获取画风 prompt（同步版本，适用于非 React 组件环境）
 * 使用静态常量作为后备
 */
export function getArtStylePromptSync(
  styleId: string | null | undefined,
  locale: 'zh' | 'en' = 'zh',
): string {
  if (!styleId) return ''
  const normalizedId = normalizeArtStyleId(styleId)
  const style = ART_STYLES.find((s) => s.value === normalizedId)
  if (!style) return ''
  return locale === 'en' ? style.promptEn : style.promptZh
}

/**
 * 检查是否为系统预定义画风
 */
export function isSystemArtStyle(styleId: string | null | undefined): boolean {
  if (!styleId) return false
  return styleId.startsWith('system-') || ART_STYLES.some((s) => s.value === styleId)
}

// ============================================================================
//  异步服务端函数（可访问数据库）
// ============================================================================

/**
 * 获取所有可用的画风列表（服务端异步版本）
 */
export async function getAvailableArtStyles(userId: string) {
  const { prisma } = await import('@/lib/prisma')

  const styles = await prisma.artStyle.findMany({
    where: {
      enabled: true,
      OR: [
        { scope: 'system' },
        { scope: 'user', ownerUserId: userId },
      ],
    },
    orderBy: [
      { scope: 'asc' },
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
    ],
  })

  return styles.map((style) => ({
    id: style.id,
    name: style.name,
    value: style.id,
    label: style.name,
    description: style.description,
    prompt: style.prompt,
    sortOrder: style.sortOrder,
    scope: style.scope,
  }))
}

/**
 * 根据 ID 获取画风（服务端异步版本）
 */
export async function getArtStyleById(
  styleId: string | null | undefined,
  userId?: string,
) {
  if (!styleId) return null

  const { prisma } = await import('@/lib/prisma')

  const where: Record<string, unknown> = { id: styleId, enabled: true }
  if (userId) {
    where.OR = [
      { scope: 'system' },
      { scope: 'user', ownerUserId: userId },
    ]
  }

  const style = await prisma.artStyle.findFirst({ where })
  if (!style) return null

  return {
    id: style.id,
    name: style.name,
    label: style.name,
    description: style.description,
    prompt: style.prompt,
    sortOrder: style.sortOrder,
    scope: style.scope,
  }
}

/**
 * 获取画风标签（服务端异步版本）
 */
export async function getArtStyleLabel(
  styleId: string | null | undefined,
  userId?: string,
  fallback = '自定义风格',
): Promise<string> {
  if (!styleId) return fallback

  const style = await getArtStyleById(styleId, userId)
  if (style) return style.label

  // 回退到同步版本（处理系统风格的兼容）
  const staticLabel = getArtStyleLabelSync(styleId)
  return staticLabel !== styleId ? staticLabel : fallback
}

/**
 * 获取画风 prompt（服务端异步版本）
 */
export async function getArtStylePrompt(
  styleId: string | null | undefined,
  userId?: string,
  locale: 'zh' | 'en' = 'zh',
): Promise<string> {
  if (!styleId) return ''

  const style = await getArtStyleById(styleId, userId)
  if (style) return style.prompt

  // 回退到同步版本（处理系统风格的兼容）
  return getArtStylePromptSync(styleId, locale)
}

/**
 * 验证艺术风格 ID 是否有效（服务端异步版本）
 * 检查数据库中是否存在该艺术风格，包括：
 * - 系统预定义风格 (system-*)
 * - 用户自定义风格 (UUID)
 * - 兼容旧格式风格值 (american-comic 等)
 */
export async function validateArtStyleValue(
  styleId: string | null | undefined,
  userId?: string,
): Promise<boolean> {
  if (!styleId) return false
  if (typeof styleId !== 'string') return false

  // 1. 先检查数据库
  const style = await getArtStyleById(styleId, userId)
  if (style) return true

  // 2. 兼容旧格式（不带 system- 前缀的系统风格值）
  const normalizedId = normalizeArtStyleId(styleId)
  const { isArtStyleValue } = await import('@/lib/constants')
  if (isArtStyleValue(normalizedId)) return true

  return false
}

