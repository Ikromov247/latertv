import { parseIsoDuration } from '../shared/youtube.ts'
import type { VideoMeta } from '../shared/types.ts'

const API = 'https://www.googleapis.com/youtube/v3'

async function apiGet(path: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`)
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error?.message ?? `YouTube API error ${res.status}`)
  return body
}

async function fetchViaApi(ids: string[], key: string): Promise<VideoMeta[]> {
  const out: VideoMeta[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const body = await apiGet('videos', {
      part: 'snippet,contentDetails,status',
      id: chunk.join(','),
      key,
    })
    const found = new Map<string, any>(body.items.map((it: any) => [it.id, it]))
    for (const id of chunk) {
      const it = found.get(id)
      if (!it) {
        out.push({ id, title: id, duration: 0, embeddable: false, error: 'Video not found' })
        continue
      }
      const live = it.snippet.liveBroadcastContent !== 'none'
      out.push({
        id,
        title: it.snippet.title,
        duration: parseIsoDuration(it.contentDetails.duration),
        embeddable: it.status.embeddable !== false,
        error: live ? 'Live streams are not supported' : undefined,
      })
    }
  }
  return out
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/** Keyless fallback: reads title and length from the public watch page. */
async function fetchViaPage(id: string): Promise<VideoMeta> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'CONSENT=YES+1; SOCS=CAI',
      },
    })
    const html = await res.text()
    const length = html.match(/"lengthSeconds":"(\d+)"/)
    const title = html.match(/<meta name="title" content="([^"]*)"/)
    const playable = html.match(/"playableInEmbed":(true|false)/)
    const name = title ? decodeHtml(title[1]) : id
    const fail = (error: string): VideoMeta => ({ id, title: name, duration: 0, embeddable: false, error })
    // Finished streams are ordinary videos; only ones still live (or not started yet) are rejected.
    // Live pages report a meaningless lengthSeconds (years, for a 24/7 stream), so check explicitly.
    const live = html.match(/"liveBroadcastDetails":(\{[^}]*\})/)
    if (live) {
      const d = JSON.parse(live[1])
      if (d.isLiveNow || !d.endTimestamp) return fail('Live streams are not supported')
    }
    const playability = html.match(/"playabilityStatus":\{"status":"([A-Z_]+)"/)?.[1]
    if (playability && playability !== 'OK') return fail(`Not playable (${playability.toLowerCase().replace(/_/g, ' ')})`)
    if (!length) return fail('Video not found')
    return {
      id,
      title: name,
      duration: Number(length[1]),
      embeddable: playable?.[1] !== 'false',
    }
  } catch (e) {
    return { id, title: id, duration: 0, embeddable: false, error: (e as Error).message }
  }
}

export async function fetchVideos(ids: string[], apiKey: string): Promise<VideoMeta[]> {
  if (apiKey) return fetchViaApi(ids, apiKey)
  const out: VideoMeta[] = []
  // A few at a time so we don't hammer youtube.com.
  for (let i = 0; i < ids.length; i += 4)
    out.push(...(await Promise.all(ids.slice(i, i + 4).map(fetchViaPage))))
  return out
}

export async function validateKey(apiKey: string): Promise<boolean> {
  try {
    await apiGet('videos', { part: 'id', id: 'jNQXAC9IVRw', key: apiKey })
    return true
  } catch {
    return false
  }
}

export async function fetchPlaylist(playlistId: string, apiKey: string): Promise<VideoMeta[]> {
  if (!apiKey) throw new Error('Playlist import needs a YouTube Data API key (set it in Settings).')
  const ids: string[] = []
  let pageToken = ''
  do {
    const body = await apiGet('playlistItems', {
      part: 'contentDetails',
      playlistId,
      maxResults: '50',
      key: apiKey,
      ...(pageToken ? { pageToken } : {}),
    })
    for (const it of body.items) ids.push(it.contentDetails.videoId)
    pageToken = body.nextPageToken ?? ''
  } while (pageToken)
  return fetchViaApi(ids, apiKey)
}
