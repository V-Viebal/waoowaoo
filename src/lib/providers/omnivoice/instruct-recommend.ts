import { validateOmnivoiceInstruct } from './instruct-vocabulary'
import type { CharacterProfileData } from '@/types/character-profile'

export interface RecommendInstructResult {
  /** 规范化后的合法 OmniVoice instruct,如 "男、中年、低音调"。 */
  instruct: string
  /** llm = LLM 输出合法直接用;fallback = LLM 不可用,由 profileData 兜底。 */
  source: 'llm' | 'fallback'
}

function mapGender(gender: string | undefined): '男' | '女' {
  const g = (gender ?? '').toLowerCase()
  if (g.includes('女') || g.includes('female') || g.includes('woman')) return '女'
  return '男'
}

function mapAge(ageRange: string | undefined): '儿童' | '少年' | '青年' | '中年' | '老年' {
  const a = (ageRange ?? '').toLowerCase()
  if (a.includes('儿童') || a.includes('child') || a.includes('kid')) return '儿童'
  if (a.includes('少年') || a.includes('teen')) return '少年'
  if (a.includes('青年') || a.includes('young')) return '青年'
  if (a.includes('中年') || a.includes('middle')) return '中年'
  if (a.includes('老') || a.includes('elder') || a.includes('senior')) return '老年'
  return '青年'
}

function fallbackInstruct(profileData: CharacterProfileData | null): string {
  if (!profileData) return '男、青年'
  return `${mapGender(profileData.gender)}、${mapAge(profileData.age_range)}`
}

/**
 * 把 LLM 的声音特征输出解析成合法的 OmniVoice instruct。
 *
 * - LLM 输出经 validateOmnivoiceInstruct 校验:合法 → 直接用(source=llm)。
 * - 不合法(越表/空/中英混用)→ 用 profileData 的 gender+age 兜底(source=fallback)。
 * - 兜底永远产出合法 instruct,保证下游 OmniVoice 调用不会因 instruct 非法失败。
 */
export function parseAndValidateRecommendation(
  llmOutput: string,
  profileData: CharacterProfileData | null,
): RecommendInstructResult {
  const validation = validateOmnivoiceInstruct(llmOutput)
  if (validation.ok) {
    return { instruct: validation.normalized, source: 'llm' }
  }
  return { instruct: fallbackInstruct(profileData), source: 'fallback' }
}
