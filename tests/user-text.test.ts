import { describe, expect, it } from 'vitest'
import { editableText, localizedUserText } from '../lib/i18n'

describe('用户文字只填写一次', () => {
  it.each(['zh', 'en'] as const)('在%s界面新增内容时，两种语言都保留原文', locale => {
    expect(localizedUserText('  自选座位 Choose a seat  ', locale)).toEqual({ zh: '自选座位 Choose a seat', en: '自选座位 Choose a seat' })
  })

  it('新增表单为空，旧内容优先显示当前语言', () => {
    const original = { zh: '彩色铅笔', en: 'Colored pencils' }
    expect(editableText(undefined, 'zh')).toBe('')
    expect(editableText(original, 'zh')).toBe('彩色铅笔')
    expect(editableText(original, 'en')).toBe('Colored pencils')
  })

  it('旧描述只填写一种语言时，另一种界面也能编辑原文', () => {
    expect(editableText({ zh: '课堂奖励', en: '' }, 'en')).toBe('课堂奖励')
    expect(editableText({ zh: '', en: 'Class reward' }, 'zh')).toBe('Class reward')
  })

  it.each(['zh', 'en'] as const)('在%s界面未修改文字时保留原有双语内容', locale => {
    const original = { zh: '彩色铅笔', en: 'Colored pencils' }
    expect(localizedUserText(` ${editableText(original, locale)} `, locale, original)).toEqual(original)
  })

  it('未修改回退显示的描述时，不补写或覆盖旧内容', () => {
    const original = { zh: '课堂奖励', en: '' }
    expect(localizedUserText(editableText(original, 'en'), 'en', original)).toEqual(original)
  })

  it('修改文字后两种界面显示相同的新内容', () => {
    const original = { zh: '彩色铅笔', en: 'Colored pencils' }
    expect(localizedUserText('  新的课堂奖励  ', 'zh', original)).toEqual({ zh: '新的课堂奖励', en: '新的课堂奖励' })
    expect(original).toEqual({ zh: '彩色铅笔', en: 'Colored pencils' })
  })

  it('可选描述留空或清空时，两种语言均保存为空', () => {
    expect(localizedUserText('', 'zh')).toEqual({ zh: '', en: '' })
    expect(localizedUserText('  ', 'en', { zh: '旧说明', en: 'Old description' })).toEqual({ zh: '', en: '' })
  })
})
