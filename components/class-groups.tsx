'use client'
import { useId, useState } from 'react'
import { Plus, Save, Users, X } from 'lucide-react'
import { Button, Checkbox, Field, Input } from '@/components/ui'
import { translator } from '@/lib/i18n'
import type { ClassGroup, Locale } from '@/lib/types'
import { api, type GardenClient } from './use-garden'

export function ClassGroupsPanel({ client, locale, classId }: { client: GardenClient; locale: Locale; classId: string }) {
  const t = translator(locale), id = useId()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState(''), [nameError, setNameError] = useState('')
  const [membersOf, setMembersOf] = useState<string | null>(null)
  const groups = (client.state?.groups || []).filter(group => group.class_id === classId)
  const students = client.state?.students || []
  const groupName = (groupId: string | null | undefined) => groups.find(group => group.id === groupId)?.name

  async function createGroup() {
    setNameError('')
    await client.run(() => api(`classes/${classId}/groups`, 'POST', { locale }), t('小组已创建。', 'Group created.'))
  }
  function edit(group: ClassGroup) {
    setEditingId(group.id); setDraft(group.name); setNameError(''); client.setNotice(null)
  }
  async function save(group: ClassGroup) {
    if (!draft.trim()) { setNameError(t('小组名称不能为空。', 'Enter a group name.')); return }
    setNameError('')
    const ok = await client.run(() => api(`groups/${group.id}`, 'PATCH', { name: draft }), t('小组名称已保存。', 'Group name saved.'))
    if (ok) setEditingId(null)
  }
  async function toggle(groupId: string, studentId: string, assigned: boolean) {
    await client.run(() => api(`groups/${groupId}/members/${studentId}`, assigned ? 'POST' : 'DELETE'), assigned ? t('学生已加入小组。', 'Student added to the group.') : t('学生已移出小组。', 'Student removed from the group.'))
  }

  return <section className="mt-7 border-t border-line pt-5" aria-labelledby={`${id}-title`}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h3 id={`${id}-title`} className="flex items-center gap-2 text-base font-bold"><Users size={18} className="text-primary" aria-hidden="true" />{t('小组', 'Groups')}</h3>
        <p id={`${id}-hint`} className="mt-2 text-sm leading-relaxed text-muted">{t('把在班学生分到小组。未分组的学生仍留在班名单中，一名学生同时只属于一个小组。', 'Organize active students into groups. Students without a group stay on the class roster. A student belongs to only one group.')}</p>
      </div>
      <Button type="button" variant="primary" busy={client.busy} aria-describedby={`${id}-hint`} onClick={() => { void createGroup() }}><Plus size={16} />{t('新建小组', 'New group')}</Button>
    </div>
    {!groups.length ? <p className="text-sm text-muted">{t('还没有小组。新建后会自动命名，无需先填写名称，之后可以修改。', 'No groups yet. A new group is named automatically, with no need to type a name first. You can rename it afterwards.')}</p> : <ul className="space-y-3">
      {groups.map(group => {
        const count = students.filter(student => student.group_id === group.id).length
        const editing = editingId === group.id
        const errorText = editing ? nameError || (client.notice?.error ? client.notice.text : '') : ''
        return <li key={group.id} className="rounded-2xl border border-line p-3">
          {editing ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(group) }}>
            <Field id={`${id}-name-${group.id}`} label={t('小组名称', 'Group name')}>
              <Input id={`${id}-name-${group.id}`} value={draft} maxLength={80} required autoFocus disabled={client.busy} aria-invalid={!!errorText} aria-describedby={errorText ? `${id}-error-${group.id}` : undefined} onChange={event => { setDraft(event.target.value); setNameError(''); client.setNotice(null) }} />
            </Field>
            {errorText && <p id={`${id}-error-${group.id}`} role="alert" className="text-sm text-danger">{errorText}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" busy={client.busy}><Save size={16} />{t('保存名称', 'Save name')}</Button>
              <Button type="button" disabled={client.busy} onClick={() => { setEditingId(null); setNameError('') }}><X size={16} />{t('取消', 'Cancel')}</Button>
            </div>
          </form> : <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold">{group.name}</p>
              <p className="text-xs text-muted">{t(`${count} 名在班学生`, count === 1 ? '1 active student' : `${count} active students`)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={client.busy} onClick={() => edit(group)}>{t('修改名称', 'Rename')}</Button>
              <Button type="button" disabled={client.busy} aria-expanded={membersOf === group.id} onClick={() => setMembersOf(membersOf === group.id ? null : group.id)}>{t('成员', 'Members')}</Button>
            </div>
          </div>}
          {membersOf === group.id && <fieldset className="mt-3 border-t border-line pt-3">
            <legend className="mb-2 text-sm font-medium">{t(`「${group.name}」的在班学生`, `Active students in “${group.name}”`)}</legend>
            <p className="mb-3 text-xs leading-relaxed text-muted">{t('勾选即可加入，取消勾选即可移出。勾选其他小组的学生会把他们移入当前小组。', 'Check to add a student, and clear the box to remove them. Selecting a student from another group moves them here.')}</p>
            {!students.length ? <p className="text-sm text-muted">{t('班里还没有在班学生。', 'This class has no active students yet.')}</p> : <ul className="max-h-48 space-y-2 overflow-y-auto pr-1">
              {students.map(student => {
                const checked = student.group_id === group.id
                const other = !checked ? groupName(student.group_id) : ''
                return <li key={student.id}><label className="flex items-start gap-3 text-sm leading-relaxed">
                  <Checkbox checked={checked} disabled={client.busy} onCheckedChange={value => { void toggle(group.id, student.id, value) }} aria-label={t(`${checked ? '移出' : '加入'} ${student.name}`, `${checked ? 'Remove' : 'Add'} ${student.name}`)} />
                  <span className="min-w-0">{student.name}{student.student_no ? ` · ${student.student_no}` : ''}{other ? <span className="text-muted">{t(`（当前在${other}）`, ` (currently in ${other})`)}</span> : null}</span>
                </label></li>
              })}
            </ul>}
          </fieldset>}
        </li>
      })}
    </ul>}
  </section>
}
