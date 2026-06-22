export type BillingItemPricingType = 'per_use' | 'per_minute' | 'per_second'

export type BillingItemDefinition = {
  key: BillingItemKey
  type: BillingItemPricingType
  price: number
  unit: 'call' | 'minute' | 'second'
  description: string
}

export const BILLING_ITEM = {
  EDITOR_SMART_CUT: 'editor_smart_cut',
  EDITOR_CAPTION_GENERATE: 'editor_caption_generate',
  EDITOR_AI_ENHANCE_SMART_CROP: 'editor_ai_enhance_smart_crop',
  EDITOR_AI_ENHANCE_RESTORE: 'editor_ai_enhance_restore',
  EDITOR_EXPORT: 'editor_export',
} as const

export type BillingItemKey = (typeof BILLING_ITEM)[keyof typeof BILLING_ITEM]

export const BILLING_ITEMS: Record<BillingItemKey, BillingItemDefinition> = {
  [BILLING_ITEM.EDITOR_SMART_CUT]: {
    key: BILLING_ITEM.EDITOR_SMART_CUT,
    type: 'per_use',
    price: 0.05,
    unit: 'call',
    description: 'Editor AI smart cut',
  },
  [BILLING_ITEM.EDITOR_CAPTION_GENERATE]: {
    key: BILLING_ITEM.EDITOR_CAPTION_GENERATE,
    type: 'per_minute',
    price: 0.02,
    unit: 'minute',
    description: 'Editor caption generation',
  },
  [BILLING_ITEM.EDITOR_AI_ENHANCE_SMART_CROP]: {
    key: BILLING_ITEM.EDITOR_AI_ENHANCE_SMART_CROP,
    type: 'per_second',
    price: 0.01,
    unit: 'second',
    description: 'Editor AI smart crop enhancement',
  },
  [BILLING_ITEM.EDITOR_AI_ENHANCE_RESTORE]: {
    key: BILLING_ITEM.EDITOR_AI_ENHANCE_RESTORE,
    type: 'per_second',
    price: 0.015,
    unit: 'second',
    description: 'Editor AI restore enhancement',
  },
  [BILLING_ITEM.EDITOR_EXPORT]: {
    key: BILLING_ITEM.EDITOR_EXPORT,
    type: 'per_minute',
    price: 0.01,
    unit: 'minute',
    description: 'Editor render export',
  },
}

export function getBillingItemDefinition(item: BillingItemKey): BillingItemDefinition {
  return BILLING_ITEMS[item]
}

export function calculateBillingItemCost(item: BillingItemKey, quantity = 1): number {
  const definition = getBillingItemDefinition(item)
  const normalizedQuantity = Math.max(0, Number.isFinite(Number(quantity)) ? Number(quantity) : 0)
  return Number((definition.price * normalizedQuantity).toFixed(6))
}
