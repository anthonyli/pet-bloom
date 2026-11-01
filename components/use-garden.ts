'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Snapshot, Locale, Upgrade, ScoreEffect } from '@/lib/types'
import { errorMessage, growth, petById } from '@/lib/i18n'
import { expireFestivalBackgrounds } from '@/lib/pet-backgrounds'

export class ApiError extends Error { constructor(public code: string, public status = 400) { super(code) } }
export async function api<T = { success: boolean; id?: string }>(path: string, method = 'GET', data?: unknown): Promise<T> {
  let response: Response
  try { response = await fetch(`/api/${path}`, { method, headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), cache: 'no-store' }) } catch { throw new ApiError('networkError', 0) }
  let body
  try { body = await response.json() } catch { throw new ApiError(response.ok ? 'networkError' : 'serverError', response.ok ? 0 : response.status) }
  if (!response.ok) throw new ApiError(body.error || 'serverError', response.status)
  return body as T
}
export function useGarden(locale: Locale) {
  const [state, setState] = useState<Snapshot | null>(null)
  const [ready, setReady] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [classId, setClassId] = useState('')
  const [busy, setBusy] = useState(false)
  const [upgrades, setUpgrades] = useState<Upgrade[]>([])
  const [celebrations, setCelebrations] = useState<Upgrade[]>([])
  const [pendingCelebrations, setPendingCelebrations] = useState<Upgrade[]>([])
  const [scoreEffects, setScoreEffects] = useState<ScoreEffect[]>([])
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const requestNumber = useRef(0), activeClass = useRef(''), pending = useRef(false)
  const clock = useRef<{ serverNow: number; monotonic: number; wallTime: number } | null>(null)
  const serverTime = useCallback(() => {
    const anchor = clock.current
    return anchor ? anchor.serverNow + Math.max(0, performance.now() - anchor.monotonic, Date.now() - anchor.wallTime) : 0
  }, [])
  const expireBackgrounds = useCallback(() => {
    const now = serverTime()
    setState(previous => previous ? expireFestivalBackgrounds(previous, now) : previous)
  }, [serverTime])
  const report = useCallback((error: unknown) => setNotice({ text: errorMessage(error instanceof ApiError ? error.code : 'serverError', locale), error: true }), [locale])
  const clearFeedback = useCallback(() => { setUpgrades([]); setCelebrations([]); setPendingCelebrations([]); setScoreEffects([]) }, [])
  const refresh = useCallback(async (selected = activeClass.current) => {
    expireBackgrounds()
    const number = ++requestNumber.current
    const sentAt = performance.now(), sentWall = Date.now()
    let accessLost = false
    try {
      let data: Snapshot
      try { data = await api<Snapshot>(`state${selected ? `?classId=${encodeURIComponent(selected)}` : ''}`) }
      catch (error) {
        if (number !== requestNumber.current) return
        if (!selected || !(error instanceof ApiError) || error.status !== 404) throw error
        // Do not leave an inaccessible class or any of its drafts visible while falling back.
        accessLost = true; activeClass.current = ''; setClassId(''); setState(null); setReady(false); clearFeedback()
        setNotice({ text: errorMessage('classAccessLost', locale), error: true })
        data = await api<Snapshot>('state')
      }
      if (number !== requestNumber.current) return
      const receivedAt = performance.now(), receivedWall = Date.now()
      // 迟到响应不能重新延长临时权限，浏览器时钟回拨也不能阻止到期。
      const currentTime = Math.max(serverTime(), data.festival_backgrounds.server_now + Math.max(0, receivedAt - sentAt, receivedWall - sentWall))
      clock.current = { serverNow: currentTime, monotonic: receivedAt, wallTime: receivedWall }
      data = expireFestivalBackgrounds(data, currentTime)
      const next = !accessLost && data.classes.some(item => item.id === selected) ? selected : data.classes[0]?.id || ''
      activeClass.current = next; setClassId(next); setState(data); setRefreshFailed(false)
      return data
    } catch (error) {
      if (number !== requestNumber.current) return
      if (error instanceof ApiError && error.status === 401) { setState(null); activeClass.current = ''; setClassId(''); setRefreshFailed(false); clearFeedback() }
      else { setRefreshFailed(true); throw error }
    } finally { if (number === requestNumber.current) setReady(true) }
  }, [clearFeedback, locale, expireBackgrounds, serverTime])
  useEffect(() => { refresh().catch(report) }, [refresh, report])
  useEffect(() => {
    if (!state) return
    const update = () => { expireBackgrounds(); if (!pending.current && !document.hidden) refresh().catch(report) }
    const timer = setInterval(update, 60000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => { clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update) }
  }, [state?.user.id, refresh, report, expireBackgrounds])
  useEffect(() => {
    if (!state) return
    expireBackgrounds()
    const deadlines = [
      ...(state.festival_backgrounds.backgrounds.length ? [state.festival_backgrounds.valid_until, ...state.festival_backgrounds.backgrounds.map(offer => offer.expires_at)] : []),
      ...state.students.filter(student => student.festival_background_id !== null && student.festival_background_expires_at !== null).map(student => student.festival_background_expires_at!)
    ]
    if (!deadlines.length) return
    const timer = setTimeout(() => {
      expireBackgrounds()
      if (!pending.current && !document.hidden) refresh().catch(report)
    }, Math.min(2147483647, Math.max(0, Math.min(...deadlines) - serverTime())))
    return () => clearTimeout(timer)
  }, [state, serverTime, expireBackgrounds, refresh, report])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), notice.error ? 9000 : 3500); return () => clearTimeout(timer) }, [notice])
  useEffect(() => {
    if (!scoreEffects.length) return
    const timer = setTimeout(() => setScoreEffects([]), 1800)
    return () => clearTimeout(timer)
  }, [scoreEffects])
  useEffect(() => {
    if (!pendingCelebrations.length) return
    const timer = setTimeout(() => { setCelebrations(previous => [...previous, ...pendingCelebrations]); setPendingCelebrations([]) }, 700)
    return () => clearTimeout(timer)
  }, [pendingCelebrations])
  const scope = `${state?.user.id || ''}:${classId}:${state?.classes.find(item => item.id === classId)?.role || ''}:${state?.user.profile_complete || false}`
  useEffect(() => { clearFeedback() }, [scope, clearFeedback])
  async function run(action: () => Promise<unknown>, message?: string, selected?: string | (() => string)) {
    if (pending.current) return false
    pending.current = true; setBusy(true); clearFeedback()
    try {
      const previousClass = activeClass.current
      const before = new Map(state?.students.map(student => [student.id, student]) || [])
      await action()
      const next = await refresh(typeof selected === 'function' ? selected() : selected)
      const sameSettings = previousClass === activeClass.current && state?.user.id === next?.user.id && state?.settings.id === next?.settings.id
      const advanced = (next?.students || []).filter(student => {
        const previous = before.get(student.id)
        return sameSettings && previous && student.points !== previous.points && previous.generation === student.generation && growth(student.pet_exp, next?.settings.value.growth).level > growth(previous.pet_exp, state?.settings.value.growth).level
      }).map(student => ({ id: student.id, name: student.name, level: growth(student.pet_exp, next?.settings.value.growth).level, previousLevel: growth(before.get(student.id)!.pet_exp, state?.settings.value.growth).level, petId: student.pet_id!, pet: petById(student.pet_id)?.name[locale] || '', badgesEarned: Math.max(0, student.badge_count - before.get(student.id)!.badge_count), earnedLevels: (next?.badges || []).filter(badge => badge.student_id === student.id && !state?.badges.some(previous => previous.id === badge.id)).map(badge => badge.level) }))
      const feedback = sameSettings ? (next?.students || []).filter(student => before.has(student.id) && student.points !== before.get(student.id)!.points).map(student => ({ id: student.id, delta: student.points - before.get(student.id)!.points, key: `${student.id}-${Date.now()}-${student.points}` })) : []
      if (feedback.length) setScoreEffects(feedback)
      if (advanced.length) { setUpgrades(advanced); setPendingCelebrations(previous => [...previous, ...advanced]) }
      if (message && (!previousClass || previousClass === activeClass.current || selected !== undefined)) setNotice({ text: message, error: false })
      return true
    }
    catch (error) {
      const deniedClass = activeClass.current
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        try { await refresh(error.status === 401 ? '' : activeClass.current) } catch { /* Keep the original actionable error. */ }
      }
      report(deniedClass && error instanceof ApiError && [403, 404].includes(error.status) && activeClass.current !== deniedClass ? new ApiError('classAccessLost') : error); return false
    }
    finally { pending.current = false; setBusy(false) }
  }
  async function selectClass(id: string) {
    if (pending.current || id === activeClass.current) return
    // Unmount class-bound forms before fetching another class, including slow requests.
    setReady(false); clearFeedback()
    await run(async () => {}, undefined, id)
  }
  return { state, ready, refreshFailed, classId, busy, upgrades, setUpgrades, scoreEffects, celebrations, setCelebrations, notice, setNotice, refresh, run, selectClass, report, scope }
}
export type GardenClient = ReturnType<typeof useGarden>
