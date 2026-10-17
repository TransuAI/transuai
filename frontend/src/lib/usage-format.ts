// How 用量 numbers are shown: token counts with thousands separators, transcription in minutes (the unit
// speech-recognition services bill by).
const numberFormat = new Intl.NumberFormat('en-US')

export function formatCount(value: number): string {
  return numberFormat.format(value)
}

export function formatMinutes(seconds: number): string {
  return `${(seconds / 60).toFixed(1)} 分鐘`
}
