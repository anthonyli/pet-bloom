import type { Locale, Pet, PetCollection, PetKind } from './types'
export type CollectionFilter = 'all' | PetCollection
export type KindFilter = 'all' | PetKind
export const petCollections: { id: CollectionFilter; name: { zh: string; en: string } }[] = [
  { id: 'all', name: { zh: '全部伙伴', en: 'All companions' } },
  { id: 'fairy', name: { zh: '精灵系', en: 'Fairy' } },
  { id: 'shanhai', name: { zh: '山海系', en: 'Shanhai' } },
  { id: 'anime', name: { zh: '动画系', en: 'Animation' } },
  { id: 'cute', name: { zh: '萌宠系', en: 'Cute companions' } },
  { id: 'zodiac', name: { zh: '十二生肖', en: 'Chinese zodiac' } }
]
export const petKinds: { id: KindFilter; name: { zh: string; en: string } }[] = [
  { id: 'all', name: { zh: '全部动物类型', en: 'All animal types' } },
  { id: 'dog', name: { zh: '犬类伙伴', en: 'Dogs' } },
  { id: 'cat', name: { zh: '猫咪伙伴', en: 'Cats' } },
  { id: 'bird', name: { zh: '飞羽伙伴', en: 'Birds' } },
  { id: 'small', name: { zh: '小型萌宠', en: 'Small companions' } },
  { id: 'farm', name: { zh: '牧场伙伴', en: 'Farm animals' } },
  { id: 'wild', name: { zh: '自然伙伴', en: 'Wildlife' } },
  { id: 'mythical', name: { zh: '神话异兽', en: 'Mythical creatures' } }
]
export function filterPetCatalog(pets: Pet[], options: { collection: CollectionFilter; kind: KindFilter; query: string; locale: Locale }) {
  const query = options.query.trim().toLowerCase()
  const result = pets.filter(pet => (options.collection === 'all' || pet.collections?.includes(options.collection)) && (options.kind === 'all' || pet.kind === options.kind) && `${pet.name.zh} ${pet.name.en} ${pet.id} ${pet.zodiac?.name.zh || ''} ${pet.zodiac?.name.en || ''}`.toLowerCase().includes(query))
  return options.collection === 'zodiac' ? result.sort((a, b) => (a.zodiac?.order || 99) - (b.zodiac?.order || 99)) : result
}
