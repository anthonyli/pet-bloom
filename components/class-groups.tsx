'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { CircleAlert, Pencil, Plus, Save, Search, UsersRound } from 'lucide-react'
import { Button, Checkbox, Dialog, Field, Input } from '@/components/ui'
import { translator } from '@/lib/i18n'
import type { ClassGroup, Locale, Student } from '@/lib/types'
import { api, ApiError, type GardenClient } from './use-garden'

type GroupEditor = {
  group?: ClassGroup
  name: string
  selectedIds: Set<string>
  previousMemberIds: string[]
}

type GroupMember = { studentId: string; groupId: string | null }
type GroupReview = {
  members: GroupMember[]
  transfers: { student: Student; from: string }[]
}

export function ClassGroupsDialog({ client, locale, classId, onClose }: { client: GardenClient; locale: Locale; classId: string; onClose: () => void }) {
  const t = translator(locale), id = useId()
  const [editor, setEditor] = useState<GroupEditor | null>(null)
  const [query, setQuery] = useState('')
  const [review, setReview] = useState<GroupReview | null>(null)
  const [stale, setStale] = useState(false)
  const [reloading, setReloading] = useState(false)
  const busy = client.busy || reloading
  const reviewHeading = useRef<HTMLHeadingElement>(null)
  const groups = (client.state?.groups || []).filter(group => group.class_id === classId)
  const students = (client.state?.students || []).filter(student => student.class_id === classId)
  const groupNames = new Map(groups.map(group => [group.id, group.name]))

  useEffect(() => {
    if (review) reviewHeading.current?.focus()
  }, [review])

  function edit(group?: ClassGroup, roster = students) {
    const previousMemberIds = group ? roster.filter(student => student.group_id === group.id).map(student => student.id) : []
    setEditor({ group, name: group?.name || '', selectedIds: new Set(previousMemberIds), previousMemberIds })
    setQuery('')
    setReview(null)
    setStale(false)
    client.setNotice(null)
  }

  function back() {
    setEditor(null)
    setReview(null)
    setStale(false)
    client.setNotice(null)
  }

  function toggle(studentId: string, checked: boolean) {
    setEditor(current => {
      if (!current) return current
      const selectedIds = new Set(current.selectedIds)
      if (checked) selectedIds.add(studentId)
      else selectedIds.delete(studentId)
      return { ...current, selectedIds }
    })
  }

  async function save(draft: GroupEditor, members: GroupMember[]) {
    const name = draft.name.trim()
    const group = draft.group
    let hasConflict = false
    const ok = await client.run(async () => {
      try {
        await (group
          ? api(`groups/${group.id}`, 'PATCH', { name, members, previousMemberIds: draft.previousMemberIds })
          : api(`classes/${classId}/groups`, 'POST', { locale, name: name || undefined, members }))
      } catch (error) {
        hasConflict = error instanceof ApiError && ['groupMembersChanged', 'studentArchived'].includes(error.code)
        throw error
      }
    }, group ? t('小组已保存。', 'Group saved.') : t('小组已创建。', 'Group created.'))
    if (ok) {
      setEditor(null)
      setReview(null)
    } else if (hasConflict) {
      setStale(true)
      setReview(null)
    }
  }

  async function reload(draft: GroupEditor) {
    setReloading(true)
    client.setNotice(null)
    try {
      const next = await client.refresh(classId)
      if (!next?.classes.some(item => item.id === classId)) return
      const group = next.groups.find(item => item.id === draft.group?.id)
      if (group) edit(group, next.students)
      else if (draft.group) back()
      else {
        const activeIds = new Set(next.students.map(student => student.id))
        setEditor({ ...draft, selectedIds: new Set([...draft.selectedIds].filter(studentId => activeIds.has(studentId))) })
        setStale(false)
      }
    } catch (error) {
      client.report(error)
    } finally {
      setReloading(false)
    }
  }

  function submit(draft: GroupEditor) {
    if (busy || stale) return
    const selected = students.filter(student => draft.selectedIds.has(student.id))
    const members = selected.map(student => ({ studentId: student.id, groupId: student.group_id ?? null }))
    const transfers = selected.flatMap(student => {
      const from = student.group_id && student.group_id !== draft.group?.id ? groupNames.get(student.group_id) : undefined
      return from ? [{ student, from }] : []
    })
    if (transfers.length) setReview({ members, transfers })
    else void save(draft, members)
  }

  const title = !editor ? t('小组管理', 'Group management') : editor.group ? t('编辑小组', 'Edit group') : t('新建小组', 'New group')
  const matching = students.filter(student => `${student.name} ${student.student_no}`.toLowerCase().includes(query.trim().toLowerCase()))
  const selectedCount = students.filter(student => editor?.selectedIds.has(student.id)).length
  const error = client.notice?.error ? client.notice.text : ''

  return <Dialog open onClose={() => { if (!busy) onClose() }} icon={UsersRound} title={title}>
    {!editor ? <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" variant="primary" disabled={client.busy} onClick={() => edit()}><Plus size={16} aria-hidden="true" />{t('新建小组', 'New group')}</Button>
      </div>
      {groups.length ? <ul className="divide-y divide-line border-y border-line">
        {groups.map(group => {
          const count = students.filter(student => student.group_id === group.id).length
          return <li key={group.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="break-words font-semibold">{group.name}</div>
              <div className="mt-0.5 text-xs text-muted">{t(`${count} 名学生`, count === 1 ? '1 student' : `${count} students`)}</div>
            </div>
            <Button type="button" variant="ghost" className="shrink-0 px-3" disabled={client.busy} onClick={() => edit(group)} aria-label={t(`编辑小组 ${group.name}`, `Edit group ${group.name}`)}><Pencil size={15} aria-hidden="true" />{t('编辑小组', 'Edit group')}</Button>
          </li>
        })}
      </ul> : <p className="border-t border-line py-5 text-sm text-muted">{t('这个班级还没有小组。', 'This class has no groups yet.')}</p>}
    </div> : review ? <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-4 text-amber-950">
        <CircleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h2 ref={reviewHeading} tabIndex={-1} className="text-sm font-semibold">{t('确认转组', 'Review group transfers')}</h2>
          <p className="mt-1 break-words text-sm leading-relaxed">{editor.name.trim() ? t(`保存后，以下学生会从原小组转入「${editor.name.trim()}」。`, `Saving moves these students from their current groups to “${editor.name.trim()}”.`) : t('保存后，以下学生会从原小组转入新小组。', 'Saving moves these students from their current groups to the new group.')}</p>
        </div>
      </div>
      <ul className="max-h-44 divide-y divide-line overflow-y-auto border-y border-line">
        {review.transfers.map(({ student, from }) => <li key={student.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 break-words py-2.5 text-sm">
          <span className="min-w-0 font-medium">{student.name}{student.student_no && <span className="ml-2 font-normal text-muted">{student.student_no}</span>}</span>
          <span className="min-w-0 text-muted">{t(`原小组：${from}`, `From ${from}`)}</span>
        </li>)}
      </ul>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" disabled={client.busy} onClick={() => { setReview(null); client.setNotice(null) }}>{t('返回修改', 'Back to editing')}</Button>
        <Button type="button" variant="primary" busy={client.busy} onClick={() => void save(editor, review.members)}><Save size={16} aria-hidden="true" />{t('确认转组并保存', 'Confirm transfers and save')}</Button>
      </div>
    </div> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); submit(editor) }}>
      <Field id={`${id}-name`} label={t('小组名称', 'Group name')}>
        <Input id={`${id}-name`} value={editor.name} onChange={event => setEditor({ ...editor, name: event.target.value })} placeholder={editor.group ? undefined : t('留空时自动命名', 'Leave blank for an automatic name')} maxLength={80} required={!!editor.group} autoFocus disabled={busy} />
      </Field>
      <fieldset disabled={busy}>
        <legend className="mb-2 text-sm font-semibold">{t('选择成员', 'Choose members')}</legend>
        {students.length ? <>
          <div className="relative mb-2">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input className="pl-9" aria-label={t('搜索小组成员', 'Search group members')} placeholder={t('搜索姓名或学号', 'Search name or student number')} value={query} onChange={event => setQuery(event.target.value)} />
          </div>
          <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {matching.length ? matching.map(student => {
              const studentGroup = student.group_id ? groupNames.get(student.group_id) : undefined
              return <li key={student.id}>
                <label className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-primary/5">
                  <Checkbox checked={editor.selectedIds.has(student.id)} onCheckedChange={checked => toggle(student.id, checked)} disabled={busy} />
                  <span className="min-w-20 flex-1 break-words font-medium">{student.name}{student.student_no && <span className="ml-2 text-xs font-normal text-muted">{student.student_no}</span>}</span>
                  <span className="min-w-0 max-w-[45%] break-words text-xs text-muted">{studentGroup || t('未分组', 'Ungrouped')}</span>
                </label>
              </li>
            }) : <li className="px-3 py-4 text-sm text-muted">{t('没有匹配的学生。', 'No matching students.')}</li>}
          </ul>
          <p className="mt-2 text-xs text-muted" aria-live="polite">{t(`已选 ${selectedCount} 名学生`, selectedCount === 1 ? '1 student selected' : `${selectedCount} students selected`)}</p>
        </> : <p className="text-sm text-muted">{t('班里还没有在班学生。', 'This class has no active students yet.')}</p>}
      </fieldset>
      {stale ? <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
        <p role="alert">{t('成员所属小组已更新，请重新加载后确认选择。', 'Group assignments have changed. Reload and review your selection.')}</p>
        <Button type="button" busy={reloading} onClick={() => void reload(editor)}>{t('重新加载成员', 'Reload members')}</Button>
      </div> : null}
      {error && !stale && <p className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" disabled={busy} onClick={back}>{t('返回小组列表', 'Back to groups')}</Button>
        <Button type="submit" variant="primary" busy={client.busy} disabled={stale || reloading || (!!editor.group && !editor.name.trim())}><Save size={16} aria-hidden="true" />{editor.group ? t('保存小组', 'Save group') : t('创建小组', 'Create group')}</Button>
      </div>
    </form>}
  </Dialog>
}
