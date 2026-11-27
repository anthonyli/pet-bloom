import { describe, expect, it } from 'vitest'
import { parseStudentList } from '../lib/student-import'
describe('中英文学生导入', () => {
  it('保留首尾 Tab 的空列并拒绝无姓名或多余列', () => {
    for (const input of ['\t001', ' \t001', '\tAlice\t001', 'Alice\t001\t']) {
      expect(parseStudentList(input)[0].invalid, input).toBe(true)
    }
    for (const name of ['Mary Jane', 'Alice 01']) {
      expect(parseStudentList(`${name}\t`)[0]).toEqual({ name, studentNo: '', ambiguous: false, invalid: false })
    }
  })
  it('按行优先识别引号外的 Tab，保留姓名内的标点及空学号', () => {
    const value = 'Example, River\t007\n王；小明\t\n"Doe; ""Jay"""\t009\n"A\tB",010\nC;011'
    expect(parseStudentList(value)).toEqual([
      ['Example, River', '007'], ['王；小明', ''], ['Doe; "Jay"', '009'], ['A\tB', '010'], ['C', '011']
    ].map(([name, studentNo]) => ({ name, studentNo, ambiguous: false, invalid: false })))
    expect(parseStudentList('Name, Jr\t007\textra')[0].invalid).toBe(true)
  })
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
