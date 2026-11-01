import type { Localized } from '@/lib/types'

export interface BadgeDefinition {
  level: number
  name: Localized
  image: string
}

export const badgeLevels: readonly BadgeDefinition[] = [
  { level: 2, name: { zh: '初步成长', en: 'First Steps' }, image: '/badges/lv2.png' },
  { level: 3, name: { zh: '渐入佳境', en: 'Finding Rhythm' }, image: '/badges/lv3.png' },
  { level: 4, name: { zh: '稳步成长', en: 'Steady Growth' }, image: '/badges/lv4.png' },
  { level: 5, name: { zh: '进阶伙伴', en: 'Growing Companion' }, image: '/badges/lv5.png' },
  { level: 6, name: { zh: '坚定前行', en: 'Going Strong' }, image: '/badges/lv6.png' },
  { level: 7, name: { zh: '闪耀时刻', en: 'Shining Bright' }, image: '/badges/lv7.png' },
  { level: 8, name: { zh: '毕业荣誉', en: 'Graduation Honor' }, image: '/badges/lv8.png' }
]
