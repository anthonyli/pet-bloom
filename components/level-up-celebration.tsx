'use client'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Award, Sparkles, Trophy } from 'lucide-react'
import { Button, FullScreenDialog } from '@/components/ui'
import { petImage, translator } from '@/lib/i18n'
import { badgeLevels } from '@/lib/data/badges'
import type { Locale, Upgrade } from '@/lib/types'

function useReducedMotion() {
  const [reduced, setReduced] = useState(true)
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update(); query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

function CelebrationParticles({ reduced, seed }: { reduced: boolean; seed: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (reduced || !canvas.current) return
    const element = canvas.current, context = element.getContext('2d')
    if (!context) return
    const ratio = Math.min(devicePixelRatio || 1, 2)
    let width = innerWidth, height = innerHeight, frame = 0
    const resize = () => { width = innerWidth; height = innerHeight; element.width = width * ratio; element.height = height * ratio; context.setTransform(ratio, 0, 0, ratio, 0, 0) }
    resize(); addEventListener('resize', resize)
    const offset = [...seed].reduce((sum, character) => sum + character.charCodeAt(0), 0)
    const random = (index: number) => { const value = Math.sin(index * 127.1 + offset) * 43758.5453; return value - Math.floor(value) }
    const particles = Array.from({ length: 70 }, (_, index) => ({ x: random(index + 1), y: random(index + 100), size: 3 + random(index + 200) * 6, speed: 24 + random(index + 300) * 55, turn: random(index + 400) * Math.PI * 2, star: index % 3 === 0, color: ['#ffe18a', '#f5bc55', '#fff6d7'][index % 3] }))
    const started = performance.now()
    const draw = (time: number) => {
      const elapsed = (time - started) / 1000
      context.clearRect(0, 0, width, height)
      if (!document.hidden) for (const particle of particles) {
        const x = particle.x * width + Math.sin(elapsed + particle.turn) * 24
        const y = (particle.y * (height + 80) + elapsed * particle.speed) % (height + 80) - 40
        context.save(); context.translate(x, y); context.rotate(particle.turn + elapsed * .45); context.fillStyle = particle.color; context.globalAlpha = .35 + particle.size / 18
        if (particle.star) {
          context.beginPath()
          for (let point = 0; point < 10; point++) {
            const radius = point % 2 ? particle.size * .42 : particle.size
            const angle = point * Math.PI / 5 - Math.PI / 2
            const px = Math.cos(angle) * radius, py = Math.sin(angle) * radius
            if (!point) context.moveTo(px, py); else context.lineTo(px, py)
          }
          context.closePath(); context.fill()
        } else context.fillRect(-particle.size / 3, -particle.size / 2, particle.size * .65, particle.size * 1.5)
        context.restore()
      }
      // 入场庆祝有边界：十秒后停止重绘，最后一帧保留
      if (elapsed < 10) frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); removeEventListener('resize', resize) }
  }, [reduced, seed])
  return <canvas ref={canvas} className="celebration-particles" aria-hidden="true" />
}

export function LevelUpCelebration({ events, locale, onClose }: { events: Upgrade[]; locale: Locale; onClose: () => void }) {
  const t = translator(locale), reduced = useReducedMotion(), image = useRef<HTMLImageElement>(null)
  const [index, setIndex] = useState(0), [revealed, setRevealed] = useState(false), [imageReady, setImageReady] = useState(false)
  const event = events[index], graduated = event.level === 8
  const earnedBadges = badgeLevels.filter(badge => event.earnedLevels.includes(badge.level))
  useEffect(() => {
    setRevealed(reduced); setImageReady(Boolean(image.current?.complete && image.current.naturalWidth))
    if (reduced) return
    const timer = setTimeout(() => setRevealed(true), 420)
    return () => clearTimeout(timer)
  }, [event.id, event.level, reduced])
  function next() { if (index + 1 < events.length) setIndex(value => value + 1); else onClose() }
  const title = graduated ? t('毕业啦！', 'GRADUATED!') : t('升级啦！', 'LEVEL UP!')
  const description = t(`恭喜 ${event.name} 的${event.pet}升到 ${event.level} 级！`, `${event.name}’s ${event.pet} reached level ${event.level}!`)
  return <FullScreenDialog open onClose={onClose} onContinue={next} title={title} description={description} closeLabel={t('关闭全部庆祝提示', 'Skip all celebrations')}>
    <div className="celebration-rays" aria-hidden="true" />
    <CelebrationParticles reduced={reduced} seed={`${event.id}-${event.level}`} />
    <div className="celebration-stage" key={`${event.id}-${event.level}`} data-revealed={imageReady && revealed}>
      <div className="celebration-heading"><Sparkles aria-hidden="true" /><h2 className="display-voice">{title}</h2><Sparkles aria-hidden="true" /></div>
      <p className="celebration-description">{t('恭喜', 'Well done,')} <strong>{event.name}</strong>{t('，又迈出了闪闪发光的一步。', '. Another wonderful step forward.')}</p>
      <div className="celebration-medallion">
        <div className="celebration-pet-frame">
          <img src={petImage(event.petId, event.previousLevel)} alt="" aria-hidden="true" className={`celebration-pet celebration-previous ${imageReady && revealed ? 'is-hidden' : ''}`} />
          <img ref={image} src={petImage(event.petId, event.level)} alt={event.pet} onLoad={() => setImageReady(true)} className={`celebration-pet celebration-new ${imageReady && revealed ? 'is-visible' : ''}`} />
        </div>
        <span className="celebration-level"><span>Lv.</span><strong>{event.level}</strong></span>
      </div>
      <p className="celebration-pet-name">{event.pet}<span>Lv.{event.previousLevel} <ArrowRight size={17} aria-hidden="true" /> Lv.{event.level}</span></p>
      {earnedBadges.length > 0 && <ul className="mt-4 flex flex-wrap justify-center gap-3" aria-label={t('本次获得的等级徽章', 'Level badges earned this time')}>{earnedBadges.map(badge => <li key={badge.level} className="flex flex-col items-center gap-1"><img src={badge.image} alt={t(`Lv.${badge.level} ${badge.name.zh}徽章`, `Lv.${badge.level} ${badge.name.en} badge`)} width={512} height={512} className="size-16 object-contain" /><span className="text-xs">Lv.{badge.level}</span></li>)}</ul>}
      <p className="celebration-graduation"><Award size={21} aria-hidden="true" />{event.badgesEarned > 0 ? t(`本次获得 ${event.badgesEarned} 枚等级徽章！`, `${event.badgesEarned} new level ${event.badgesEarned === 1 ? 'badge' : 'badges'} earned!`) : t('本次未新增徽章，同一轮每个等级只奖励一次。', 'No new badges this time. Each level awards once per pet cycle.')}</p>
      {graduated && <p className="celebration-graduation"><Trophy size={20} aria-hidden="true" />{t('宠物毕业，可以领养新伙伴啦！', 'Your pet has graduated. A new companion awaits!')}</p>}
      <Button className="celebration-continue" onClick={click => { click.stopPropagation(); next() }}>{index + 1 < events.length ? t('下一位成长伙伴', 'Next companion') : t('继续一起成长', 'Keep growing together')}<ArrowRight size={18} aria-hidden="true" /></Button>
      <p className="celebration-hint">{events.length > 1 ? `${index + 1} / ${events.length} · ` : ''}{t('点击屏幕继续，也可按 Esc 关闭', 'Click anywhere to continue · Esc to close')}</p>
    </div>
  </FullScreenDialog>
}
