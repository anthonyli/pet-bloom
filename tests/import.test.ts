import { describe, expect, it } from 'vitest'
import { parseStudentList } from '../lib/student-import'
describe('中英文学生导入', () => {
  it('逗号分隔时保留英文姓名内部空格', () => {
    expect(parseStudentList('Mary Jane, 01')).toEqual([{ name: 'Mary Jane', studentNo: '01', ambiguous: false, invalid: false }])
  })
  it('中文分号、Tab 和空格加数字学号均可使用', () => {
    expect(parseStudentList('林小橙；01\n陈子禾\t02\nMary Jane 03').map(row => [row.name, row.studentNo])).toEqual([['林小橙', '01'], ['陈子禾', '02'], ['Mary Jane', '03']])
  })
  it('只有英文姓名时不猜测尾部是学号，并标记待确认', () => {
    expect(parseStudentList('Mary Jane')[0]).toEqual({ name: 'Mary Jane', studentNo: '', ambiguous: true, invalid: false })
  })
  it('引号内逗号保留，额外列与未闭合引号不能静默导入', () => {
    expect(parseStudentList('"Doe, Jane",01')[0].name).toBe('Doe, Jane')
    expect(parseStudentList('Jane,01,extra')[0].invalid).toBe(true)
    expect(parseStudentList('"Jane,01')[0].invalid).toBe(true)
  })
})
