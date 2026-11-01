'use client'
import { Apple, Armchair, Backpack, BookOpen, Calculator, Clock, Cookie, Crown, Film, Gamepad2, Gift, Heart, IceCreamBowl, Music, NotebookPen, Package, Pencil, PenTool, Puzzle, Ruler, Scissors, Star, Ticket, Utensils, type LucideIcon } from 'lucide-react'
import type { ShopIconId } from '@/lib/shop'
import type { Locale, Localized } from '@/lib/types'

export const shopIcons = {
  pencil: { icon: Pencil, name: { zh: '铅笔', en: 'Pencil' } },
  book: { icon: BookOpen, name: { zh: '书本', en: 'Book' } },
  'pen-tool': { icon: PenTool, name: { zh: '钢笔', en: 'Pen' } },
  backpack: { icon: Backpack, name: { zh: '书包', en: 'Backpack' } },
  calculator: { icon: Calculator, name: { zh: '计算器', en: 'Calculator' } },
  ruler: { icon: Ruler, name: { zh: '直尺', en: 'Ruler' } },
  notebook: { icon: NotebookPen, name: { zh: '笔记本', en: 'Notebook' } },
  scissors: { icon: Scissors, name: { zh: '剪刀', en: 'Scissors' } },
  crown: { icon: Crown, name: { zh: '皇冠', en: 'Crown' } },
  armchair: { icon: Armchair, name: { zh: '座椅', en: 'Armchair' } },
  ticket: { icon: Ticket, name: { zh: '入场券', en: 'Ticket' } },
  clock: { icon: Clock, name: { zh: '时钟', en: 'Clock' } },
  gamepad: { icon: Gamepad2, name: { zh: '游戏手柄', en: 'Game controller' } },
  music: { icon: Music, name: { zh: '音乐', en: 'Music' } },
  film: { icon: Film, name: { zh: '电影', en: 'Film' } },
  puzzle: { icon: Puzzle, name: { zh: '拼图', en: 'Puzzle' } },
  apple: { icon: Apple, name: { zh: '苹果', en: 'Apple' } },
  cookie: { icon: Cookie, name: { zh: '饼干', en: 'Cookie' } },
  'ice-cream': { icon: IceCreamBowl, name: { zh: '冰淇淋', en: 'Ice cream' } },
  utensils: { icon: Utensils, name: { zh: '餐具', en: 'Utensils' } },
  gift: { icon: Gift, name: { zh: '礼物', en: 'Gift' } },
  star: { icon: Star, name: { zh: '星星', en: 'Star' } },
  heart: { icon: Heart, name: { zh: '爱心', en: 'Heart' } },
  package: { icon: Package, name: { zh: '礼盒', en: 'Package' } }
} satisfies Record<ShopIconId, { icon: LucideIcon; name: Localized }>

export function ShopIcon({ icon, locale, size = 24, className, decorative = false }: { icon: ShopIconId; locale: Locale; size?: number; className?: string; decorative?: boolean }) {
  const definition = shopIcons[icon]
  const Icon = definition.icon
  return <Icon size={size} className={className} role={decorative ? undefined : 'img'} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : definition.name[locale]} />
}
