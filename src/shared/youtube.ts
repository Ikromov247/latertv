const ID_RE = /^[A-Za-z0-9_-]{11}$/

/** Extracts a video id from any common YouTube URL form, or a bare id. */
export function parseVideoId(input: string): string | null {
  const s = input.trim()
  if (ID_RE.test(s)) return s
  let url: URL
  try {
    url = new URL(s.includes('://') ? s : `https://${s}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '')
  let id: string | null = null
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? null
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v')
    else {
      const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)
      id = m?.[1] ?? null
    }
  }
  return id && ID_RE.test(id) ? id : null
}

/** Extracts a playlist id from a playlist URL, or accepts a bare id. */
export function parsePlaylistId(input: string): string | null {
  const s = input.trim()
  if (/^(PL|UU|LL|FL|OL|RD)[A-Za-z0-9_-]+$/.test(s)) return s
  try {
    const url = new URL(s.includes('://') ? s : `https://${s}`)
    return url.searchParams.get('list')
  } catch {
    return null
  }
}

/** Parses an ISO 8601 duration like PT1H2M3S into seconds. */
export function parseIsoDuration(iso: string): number {
  const m = iso.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!m) return 0
  const [, d, h, min, s] = m.map((x) => Number(x ?? 0))
  return d * 86400 + h * 3600 + min * 60 + s
}
