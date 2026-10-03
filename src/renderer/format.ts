export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** 3723 -> "1:02:03", 95 -> "1:35" */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** "7:22 PM" -> ["7:22", "PM"]; 24-hour locales have no suffix. */
export function clockParts(ms: number): [string, string] {
  const m = fmtClock(ms).match(/^(.*?)\s*([AaPp]\.?\s?[Mm]\.?)$/)
  return m ? [m[1], m[2].toUpperCase()] : [fmtClock(ms), '']
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function chNum(index: number): string {
  return String(index + 1).padStart(2, '0')
}
