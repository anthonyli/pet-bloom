const formatters = new Map<string, Intl.DateTimeFormat>()

export function zonedDateParts(time: number, timeZone: string) {
  let formatter = formatters.get(timeZone)
  if (!formatter) { formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); formatters.set(timeZone, formatter) }
  const values = Object.fromEntries(formatter.formatToParts(time).map(part => [part.type, part.value]))
  return { date: `${values.year}-${values.month}-${values.day}`, year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second) }
}

export function zonedMidnight(year: number, month: number, day: number, timeZone: string) {
  const target = Date.UTC(year, month - 1, day)
  let value = target
  for (let pass = 0; pass < 4; pass++) {
    const local = zonedDateParts(value, timeZone)
    const offset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - value
    const next = target - offset
    if (Math.abs(next - value) < 1) break
    value = next
  }
  return value
}
