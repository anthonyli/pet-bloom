// @vitest-environment happy-dom
import { act, createElement, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultGardenSettings } from '@/lib/garden-settings'
import { petBackgroundById } from '@/lib/pet-backgrounds'
import type { Locale, Redemption, ShopItem, Snapshot, Student } from '@/lib/types'

vi.mock('next/navigation', () => ({ usePathname: () => '/zh' }))

import { ShopDialog } from '@/components/shop-dialog'
import { useGarden } from '@/components/use-garden'

type Failure = 'state-500' | 'state-network' | 'post-network' | 'post-malformed' | 'post-rejected' | null
const studentName = '复现学生'
const rewardName = { zh: '隔离彩笔', en: 'Isolated crayons' }
let failure: Failure = null
let posts = 0
let undoPosts = 0
let hold: Promise<void> | null = null
let root: Root | null = null
let closed = 0

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
function snapshot(): Snapshot {
  const student: Student = {
    id: 'student-1', class_id: 'class-1', group_id: null, name: studentName, student_no: '01', archived_at: null, archive_reason: null, archive_note: null,
    points: 100, pet_id: 'panda', pet_exp: 100, generation: 1, badge_count: 3, spent_badges: 1, background_id: null, owned_background_ids: [],
    festival_background_id: null, festival_background_expires_at: null
  }
  const reward: ShopItem = { id: 'item-1', name: rewardName, description: { zh: '复现商品', en: 'Reproduction reward' }, category: 'stationery', icon: 'pencil', image: null, cost: 1, stock: 2, active: 1, background_id: null }
  const garden = petBackgroundById('garden')!
  const background: ShopItem = { id: 'item-bg', name: garden.name, description: garden.description, category: 'other', icon: 'gift', image: null, cost: 1, stock: -1, active: 1, background_id: 'garden' }
  const previous: Redemption = {
    id: 'red-1', student_id: student.id, student_name: student.name, item_id: reward.id, item_name: reward.name, cost: 1, created_at: 1, undone: 0, stock_deducted: 1, background_id: null,
    actor_user_id: 'user-1', actor_name: '兑换复现教师', actor_subject: '科学', undone_by_user_id: null, undone_by_name: '', undone_by_subject: '', can_undo: true
  }
  return {
    user: { id: 'user-1', username: 'teacher', display_name: '兑换复现教师', subject: '科学', teaching_role: 'homeroom', profile_complete: true },
    settings: { id: 'settings-1', version: 1, value: defaultGardenSettings(), created_at: 1 },
    classes: [{ id: 'class-1', name: '兑换复现班', created_at: 1, graduated_at: null, owner_id: 'user-1', role: 'owner' }],
    students: [student], archived_students: [], groups: [], badges: [], rules: [], records: [], items: [reward, background], redemptions: [previous],
    festival_backgrounds: { server_now: Date.now(), valid_until: Date.now() + 86_400_000, time_zone: 'Asia/Shanghai', backgrounds: [], unsupported_background_ids: [] }
  }
}
function button(label: string) {
  return [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.includes(label))
}
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
async function renderShop(locale: Locale = 'zh') {
  const Harness: ComponentType = () => {
    const client = useGarden(locale)
    if (!client.state) return null
    return createElement('div', null,
      createElement(ShopDialog, { client, locale, onClose: () => { closed += 1 } }),
      client.notice ? createElement('div', { role: client.notice.error ? 'alert' : 'status' }, client.notice.text) : null
    )
  }
  if (root) act(() => { root?.unmount() })
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root?.render(createElement(Harness)) })
  for (let attempt = 0; attempt < 20 && !button(locale === 'zh' ? '兑换 · 隔离彩笔' : 'Redeem · Isolated crayons'); attempt++) await settle()
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  failure = null
  posts = 0
  undoPosts = 0
  hold = null
  closed = 0
  document.body.innerHTML = ''
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://local')
    const method = init?.method || 'GET'
    if (method === 'POST' && url.pathname === '/api/redemptions') {
      posts += 1
      if (hold) await hold
      if (failure === 'post-network') throw new TypeError('Failed to fetch')
      if (failure === 'post-malformed') return new Response('saved-but-unreadable', { status: 200, headers: { 'content-type': 'text/plain' } })
      if (failure === 'post-rejected') return json({ error: 'insufficientBadges' }, 409)
      return json({ success: true })
    }
    if (method === 'POST' && url.pathname.endsWith('/undo')) { undoPosts += 1; return json({ success: true }) }
    if (method === 'GET' && url.pathname === '/api/state') {
      if (posts > 0 && failure === 'state-500') return json({ error: 'serverError' }, 500)
      if (posts > 0 && failure === 'state-network') throw new TypeError('Failed to fetch')
      return json(snapshot())
    }
    throw new Error(`unexpected ${method} ${url.pathname}`)
  })
})
afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('普通奖励兑换的刷新失败不能再次扣费', () => {
  async function redeem(label = '兑换 · 隔离彩笔') {
    const target = button(label)
    expect(target?.disabled).toBe(false)
    await act(async () => { target?.click() })
    await settle()
  }

  it('POST 成功后 GET 500 时锁定兑换，重新加载只读且核对后才允许下一笔', async () => {
    failure = 'state-500'
    await renderShop()
    await redeem()
    expect(posts).toBe(1)
    expect(document.body.textContent).toContain('复现学生 的「隔离彩笔」兑换已保存')
    expect(document.body.textContent).not.toContain('请稍后重试')
    expect(button('兑换 · 隔离彩笔')?.disabled).toBe(true)
    expect(button('添加商品')?.disabled).toBe(true)
    expect(button('退款')?.disabled).toBe(true)
    await act(async () => { button('关闭')?.click() })
    expect(closed).toBe(0)
    await act(async () => { button('兑换 · 隔离彩笔')?.click(); button('退款')?.click(); button('重新加载并核对记录')?.click() })
    await settle()
    expect(posts).toBe(1)
    expect(undoPosts).toBe(0)
    expect(document.body.textContent).toContain('兑换已保存')
    failure = null
    await act(async () => { button('重新加载并核对记录')?.click() })
    await settle()
    expect(posts).toBe(1)
    expect(undoPosts).toBe(0)
    expect(document.body.textContent).not.toContain('兑换已保存，但最新数据未能加载')
    await act(async () => { button('奖励商店')?.click() })
    await redeem()
    expect(posts).toBe(2)
    expect(document.body.textContent).toContain('已为复现学生兑换「隔离彩笔」。')
  })

  it('POST 成功后刷新断网同样按已保存锁定，恢复失败不会新增兑换', async () => {
    failure = 'state-network'
    await renderShop()
    await redeem()
    expect(posts).toBe(1)
    expect(document.body.textContent).toContain('不要再次兑换或退款')
    await act(async () => { button('重新加载并核对记录')?.click() })
    await settle()
    expect(posts).toBe(1)
    expect(button('重新加载并核对记录')).toBeTruthy()
  })

  it('兑换响应丢失或成功响应无法读取时暂停并提示先核对', async () => {
    failure = 'post-network'
    await renderShop()
    await redeem()
    expect(posts).toBe(1)
    expect(document.body.textContent).toContain('暂时无法确认复现学生是否已兑换「隔离彩笔」')
    expect(document.body.textContent).not.toContain('请检查网络后重试')
    await act(async () => { button('兑换 · 隔离彩笔')?.click() })
    expect(posts).toBe(1)
    failure = 'post-malformed'
    await renderShop()
    await redeem()
    expect(posts).toBe(2)
    expect(document.body.textContent).toContain('暂时无法确认')
    expect(button('兑换 · 隔离彩笔')?.disabled).toBe(true)
  })

  it('服务端明确拒绝时不锁定，修正后可以重新兑换', async () => {
    failure = 'post-rejected'
    await renderShop()
    await redeem()
    expect(posts).toBe(1)
    expect(document.body.textContent).toContain('可用徽章不足')
    expect(button('重新加载并核对记录')).toBeUndefined()
    expect(button('兑换 · 隔离彩笔')?.disabled).toBe(false)
    failure = null
    await redeem()
    expect(posts).toBe(2)
    expect(document.body.textContent).toContain('已为复现学生兑换「隔离彩笔」。')
  })

  it('请求尚未返回时重复点击只发送一次', async () => {
    let release = () => {}
    hold = new Promise(resolve => { release = resolve })
    await renderShop()
    const target = button('兑换 · 隔离彩笔')
    const pending = act(async () => { target?.click() })
    await settle()
    await act(async () => { button('兑换 · 隔离彩笔')?.click() })
    expect(posts).toBe(1)
    release()
    await pending
    await settle()
    expect(posts).toBe(1)
    expect(document.body.textContent).toContain('已为复现学生兑换「隔离彩笔」。')
  })

  it('英文界面和背景兑换沿用同一恢复，不把刷新失败当成可重试的写操作', async () => {
    failure = 'state-500'
    await renderShop('en')
    await redeem('Redeem · Isolated crayons')
    expect(document.body.textContent).toContain('The redemption of Isolated crayons for 复现学生 was saved')
    expect(button('Redeem · Isolated crayons')?.disabled).toBe(true)
    await act(async () => { button('Reload and check records')?.click() })
    expect(posts).toBe(1)
    failure = 'state-500'
    posts = 0
    await renderShop()
    await act(async () => { button('宠物背景')?.click() })
    const garden = petBackgroundById('garden')!
    await redeem(`兑换背景 · ${garden.name.zh} · 1 枚徽章`)
    expect(posts).toBe(1)
    expect(document.body.textContent).toContain(`复现学生 的「${garden.name.zh}」兑换已保存`)
    expect(button(`兑换背景 · ${garden.name.zh} · 1 枚徽章`)?.disabled).toBe(true)
  })
})
