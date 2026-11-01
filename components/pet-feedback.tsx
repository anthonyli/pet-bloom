'use client'
import { useEffect, useRef } from 'react'
import { Cloud, Heart, Sparkles, Star } from 'lucide-react'
import type { ScoreEffect } from '@/lib/types'

export function PetFeedback({ effect, children }: { effect?: ScoreEffect; children: React.ReactNode }) {
  const visual = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!effect || !visual.current || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const frames = effect.delta > 0 ? [
      { transform: 'translateY(0) scale(1)' },
      { transform: 'translateY(-12px) scale(1.06)', offset: .35 },
      { transform: 'translateY(2px) scale(.98)', offset: .7 },
      { transform: 'translateY(0) scale(1)' }
    ] : [
      { transform: 'translateX(0) rotate(0)' },
      { transform: 'translateX(-5px) rotate(-2deg)', offset: .2 },
      { transform: 'translateX(5px) rotate(2deg)', offset: .4 },
      { transform: 'translateX(-3px) rotate(-1deg)', offset: .65 },
      { transform: 'translateX(0) rotate(0)' }
    ]
    const animation = visual.current.animate(frames, { duration: effect.delta > 0 ? 720 : 460, easing: 'cubic-bezier(.16,1,.3,1)' })
    return () => animation.cancel()
  }, [effect?.key])
  const positive = effect ? effect.delta > 0 : false
  return <div className="pet-feedback-container"><div ref={visual} className="pet-visual">{children}</div>{effect && <div key={effect.key} className={`score-feedback ${positive ? 'score-positive' : 'score-negative'}`} aria-hidden="true" data-student-feedback={effect.id} data-score-delta={effect.delta}>
    <span className="score-delta">{positive ? '+' : '−'}{Math.abs(effect.delta)}</span>
    {Array.from({ length: positive ? 9 : 4 }, (_, index) => {
      const Icon = positive ? [Heart, Star, Sparkles][index % 3] : Cloud
      return <span key={index} className={`score-particle score-particle-${index % 3}`} style={{ '--particle-x': `${(index % 2 ? 1 : -1) * (18 + index * 6)}px`, '--particle-y': `${-(35 + index % 4 * 15)}px`, '--particle-turn': `${index % 2 ? 24 : -24}deg`, animationDelay: `${index * 45}ms` } as React.CSSProperties}><Icon size={positive ? 19 + index % 3 * 3 : 19} fill={positive && index % 3 === 0 ? 'currentColor' : 'none'} strokeWidth={1.7} /></span>
    })}
  </div>}</div>
}
