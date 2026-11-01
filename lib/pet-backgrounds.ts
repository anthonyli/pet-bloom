import catalog from './data/backgrounds.json'
import type { Localized, Snapshot, Student } from './types'

export type BackgroundCategory = 'everyday' | 'chinese' | 'global'
export type BackgroundFilter = BackgroundCategory | 'all'
export interface PetBackground { id: string; category: BackgroundCategory; name: Localized; description: Localized; image: string }
export const petBackgrounds = catalog as PetBackground[]
export const versionFiveBackgroundIds = ['garden', 'starlight', 'beach', 'classroom'] as const
export const holidayBackgroundIds = [
  'spring-festival', 'lantern-festival', 'qingming', 'dragon-boat', 'qixi', 'ghost-festival', 'mid-autumn', 'double-ninth', 'laba', 'national-day', 'labour-day', 'childrens-day', 'teachers-day',
  'new-year', 'valentines-day', 'womens-day', 'earth-day', 'book-day', 'mothers-day', 'fathers-day', 'easter', 'halloween', 'thanksgiving', 'christmas', 'st-patricks-day', 'diwali', 'eid-al-fitr', 'hanukkah'
] as const
export const versionSevenBackgroundIds = [
  'lunar-new-years-eve', 'little-new-year', 'dragon-head-raising', 'winter-solstice', 'arbor-day', 'youth-day', 'cpc-founding-day', 'army-day', 'farmers-harvest-festival'
] as const
export const backgroundCategories: { id: BackgroundCategory; name: Localized }[] = [
  { id: 'everyday', name: { zh: '日常场景', en: 'Everyday' } },
  { id: 'chinese', name: { zh: '国内节日', en: 'Chinese holidays' } },
  { id: 'global', name: { zh: '国际与海外', en: 'International holidays' } }
]
export function equippedBackgroundId(student: Pick<Student, 'background_id' | 'festival_background_id'>) {
  return student.festival_background_id ?? student.background_id
}
export function expireFestivalBackgrounds(snapshot: Snapshot, serverNow: number): Snapshot {
  const availability = snapshot.festival_backgrounds
  const backgrounds = availability.valid_until <= serverNow ? [] : availability.backgrounds.filter(offer => offer.expires_at > serverNow)
  let changed = backgrounds.length !== availability.backgrounds.length
  const students = snapshot.students.map(student => {
    if (student.festival_background_id === null || (student.festival_background_expires_at !== null && student.festival_background_expires_at > serverNow)) return student
    changed = true
    return { ...student, festival_background_id: null, festival_background_expires_at: null }
  })
  return changed ? { ...snapshot, students, festival_backgrounds: { ...availability, backgrounds } } : snapshot
}
export const petBackgroundById = (id: string | null | undefined) => petBackgrounds.find(background => background.id === id)
export function filterPetBackgrounds(backgrounds: PetBackground[], category: BackgroundFilter, query: string) {
  const search = query.trim().toLocaleLowerCase()
  return backgrounds.filter(background => (category === 'all' || background.category === category) && (!search || `${background.name.zh} ${background.name.en} ${background.description.zh} ${background.description.en}`.toLocaleLowerCase().includes(search)))
}
