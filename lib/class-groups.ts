export const MAX_GROUPS_PER_CLASS = 200

export function defaultGroupName(locale: 'zh' | 'en', index: number) {
  return locale === 'en' ? `Group ${index}` : `第 ${index} 组`
}
