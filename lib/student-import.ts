export interface ImportRow { name: string; studentNo: string; ambiguous: boolean; invalid: boolean }

// 先处理显式分隔符；没有列分隔符时只把末尾含数字的标记当作学号
export function parseStudentList(value: string): ImportRow[] {
  return value.split(/\r?\n/).filter(line => line.trim()).map(raw => {
    const line = raw.trim()
    if (/[,，;；\t]/.test(line)) {
      const columns: string[] = []; let part = '', quoted = false
      for (let index = 0; index < line.length; index++) {
        const character = line[index]
        if (character === '"') {
          if (quoted && line[index + 1] === '"') { part += '"'; index++ } else quoted = !quoted
        } else if (/[,，;；\t]/.test(character) && !quoted) { columns.push(part.trim()); part = '' }
        else part += character
      }
      columns.push(part.trim())
      const [name = '', studentNo = ''] = columns
      return { name, studentNo, ambiguous: false, invalid: quoted || columns.length > 2 || !name || name.length > 80 || studentNo.length > 30 }
    }
    const tokens = line.split(/\s+/)
    const last = tokens.at(-1)!
    const hasNumber = tokens.length > 1 && /^(?=.*\d)[a-zA-Z0-9._-]+$/.test(last)
    const name = hasNumber ? tokens.slice(0, -1).join(' ') : line
    const studentNo = hasNumber ? last : ''
    return { name, studentNo, ambiguous: tokens.length > 1 && !hasNumber, invalid: !name || name.length > 80 || studentNo.length > 30 }
  })
}
