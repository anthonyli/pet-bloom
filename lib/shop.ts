export const shopCategoryIds = ['stationery', 'privilege', 'entertainment', 'food', 'other'] as const
export type ShopCategory = typeof shopCategoryIds[number]
export const shopIconIds = ['pencil', 'book', 'pen-tool', 'backpack', 'calculator', 'ruler', 'notebook', 'scissors', 'crown', 'armchair', 'ticket', 'clock', 'gamepad', 'music', 'film', 'puzzle', 'apple', 'cookie', 'ice-cream', 'utensils', 'gift', 'star', 'heart', 'package'] as const
export type ShopIconId = typeof shopIconIds[number]
export const shopCategories: { id: ShopCategory; name: { zh: string; en: string }; icons: readonly ShopIconId[] }[] = [
  { id: 'stationery', name: { zh: '文具', en: 'Stationery' }, icons: ['pencil', 'book', 'pen-tool', 'backpack', 'calculator', 'ruler', 'notebook', 'scissors'] },
  { id: 'privilege', name: { zh: '特权', en: 'Privileges' }, icons: ['crown', 'armchair', 'ticket', 'clock'] },
  { id: 'entertainment', name: { zh: '娱乐', en: 'Fun' }, icons: ['gamepad', 'music', 'film', 'puzzle'] },
  { id: 'food', name: { zh: '美食', en: 'Treats' }, icons: ['apple', 'cookie', 'ice-cream', 'utensils'] },
  { id: 'other', name: { zh: '其他', en: 'Other' }, icons: ['gift', 'star', 'heart', 'package'] }
]
export const MAX_ITEM_IMAGE_BYTES = 2 * 1024 * 1024
export const MAX_STORED_IMAGE_BYTES = 256 * 1024
export const MAX_CLASS_IMAGE_BYTES = 10 * 1024 * 1024
// Leave headroom beneath Vercel's 4.5 MB request/response limit.
export const MAX_BACKUP_MB = process.env.NEXT_PUBLIC_CLOUD_DEPLOYMENT === 'true' ? 4 : 50
export const MAX_BACKUP_BYTES = MAX_BACKUP_MB * 1024 * 1024
