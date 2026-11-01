'use client'
import { cn } from '@/components/ui'
import { petById, studentPetImage, translator } from '@/lib/i18n'
import { equippedBackgroundId, petBackgroundById } from '@/lib/pet-backgrounds'
import type { GrowthStep } from '@/lib/garden-settings'
import type { Locale, ScoreEffect, Student } from '@/lib/types'
import { PetFeedback } from './pet-feedback'

export function PetScene({ student, locale, steps, backgroundId = equippedBackgroundId(student), effect, className }: { student: Student; locale: Locale; steps: GrowthStep[]; backgroundId?: string | null; effect?: ScoreEffect; className?: string }) {
  const t = translator(locale)
  const background = petBackgroundById(backgroundId)
  const pet = petById(student.pet_id)
  const image = studentPetImage(student, steps)
  return <div className={cn('relative isolate flex aspect-[1.12] items-center justify-center overflow-hidden bg-[#fbfaff]', className)}>
    {background && <img src={background.image} alt="" aria-hidden="true" loading="lazy" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />}
    <div className="relative z-10 flex h-full w-full items-center justify-center p-4">
      <PetFeedback effect={effect}><img src={image} alt={pet?.name[locale] || t('等待领养的宠物蛋', 'Pet egg waiting for adoption')} className={cn('h-full w-full translate-y-[5%] scale-[.8] object-contain', student.status?.form === 'sick' && 'grayscale')} loading="lazy" /></PetFeedback>
    </div>
  </div>
}
