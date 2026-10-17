// <input type="datetime-local"> works in the browser's own zone without an offset ("2026-11-18T14:00"); the API wants
// ISO 8601 with one ("2026-11-18T14:00:00+08:00").
const pad = (value: number) => String(value).padStart(2, '0')

export function toLocalInput(iso: string): string {
  // A date on its own (an all-day event) is a calendar day, not UTC midnight.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00`) : new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// An empty or unreadable value stays as it is (the form says what's wrong). A time that doesn't exist in the zone (a
// daylight-saving gap) comes out as the browser adjusts it.
export function fromLocalInput(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  return `${toLocalInput(date.toISOString())}:00${zone}`
}
