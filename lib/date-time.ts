const formatters = new Map<string, Intl.DateTimeFormat>()

export function zonedDateParts(time: number, timeZone: string) {
  let formatter = formatters.get(timeZone)
  if (!formatter) { formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); formatters.set(timeZone, formatter) }
  const values = Object.fromEntries(formatter.formatToParts(time).map(part => [part.type, part.value]))
  return { date: `${values.year}-${values.month}-${values.day}`, year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second) }
}

/**
 * First valid instant of a civil date, choosing the earlier repeated midnight.
 * A wholly skipped date shares the next date's boundary (an empty day).
 * Date.UTC normalizes overflowing dates; it does not define a school's day length.
 */
export function zonedMidnight(year: number, month: number, day: number, timeZone: string) {
  const target = Date.UTC(year, month - 1, day)
  const dayMs = 86400000
  const wallTime = (time: number) => {
    const local = zonedDateParts(time, timeZone)
    return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second)
  }
  // IANA offsets are less than 24h. Sample both sides of the possible midnight
  // so a nearby clock change supplies both offsets, including a date-line jump.
  const candidates = [...new Set([target - dayMs, target + dayMs].map(time => target - (wallTime(time) - time)))].sort((a, b) => a - b)
  for (const candidate of candidates) {
    if (wallTime(candidate) === target) return candidate
  }
  // Midnight lies in a forward gap. The two offset interpretations bracket the
  // transition; find its first millisecond rather than shifting by a fixed hour.
  let before = candidates[0], after = candidates[candidates.length - 1]
  while (after - before > 1) {
    const middle = before + Math.floor((after - before) / 2)
    if (wallTime(middle) < target) before = middle
    else after = middle
  }
  return after
}

/** Next instant strictly after time at which the local calendar date changes. */
export function nextZonedDateChange(time: number, timeZone: string) {
  const offsetAt = (instant: number) => {
    const local = zonedDateParts(instant, timeZone)
    // Intl exposes whole seconds; discard milliseconds on both sides.
    return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - Math.floor(instant / 1000) * 1000
  }
  const date = zonedDateParts(time, timeZone).date
  let cursor = time
  for (;;) {
    const local = zonedDateParts(cursor, timeZone), offset = offsetAt(cursor)
    const midnight = Date.UTC(local.year, local.month - 1, local.day + 1) - offset
    if (offsetAt(midnight) === offset) return midnight
    // An IANA transition occurs before (or at) the next fixed-offset midnight.
    // Find it even when a rollback briefly re-enters yesterday. Searching only
    // for a different date would miss the short date fragment before rollback.
    let before = cursor, after = midnight
    while (after - before > 1) {
      const middle = before + Math.floor((after - before) / 2)
      if (offsetAt(middle) === offset) before = middle
      else after = middle
    }
    if (zonedDateParts(after, timeZone).date !== date) return after
    // Ordinary DST changes keep the same date. Continue to its actual end.
    cursor = after
  }
}
