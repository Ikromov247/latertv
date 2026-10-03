import { currentSlot } from '../shared/schedule.ts'
import type { Channel, Slot } from '../shared/types.ts'
import { setStatic } from './static.ts'

/** How far playback may drift from the broadcast clock before we snap it back. */
const MAX_DRIFT_S = 4
/** Player errors that mean the video itself can never air (vs. transient/player problems). */
const FATAL_ERRORS: Record<number, string> = {
  2: 'Invalid video id',
  100: 'Video removed or private',
  101: 'Embedding disabled by owner',
  150: 'Embedding disabled by owner',
}

export interface TvEvents {
  /** The viewer has seen [from, to] seconds of a video. */
  onWatched(videoId: string, from: number, to: number): void
  /** The video can't be played and should be taken off the air. */
  onUnavailable(videoId: string, reason: string): void
  onPlayerError(message: string): void
}

let player: YT.Player | null = null
let loaded: Slot | null = null
let lastTime: number | null = null
let playing = false
let tvEvents: TvEvents | null = null
let captions = false
/** Captions settle per video once it starts playing, so they're applied once per program. */
let captionsApplied = false

function loadApi(): Promise<void> {
  return new Promise((resolve) => {
    ;(window as any).onYouTubeIframeAPIReady = () => resolve()
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.append(s)
  })
}

export async function createTv(events: TvEvents): Promise<void> {
  tvEvents = events
  await loadApi()
  await new Promise<void>((resolve) => {
    player = new YT.Player('player', {
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        iv_load_policy: 3,
        rel: 0,
        playsinline: 1,
        cc_load_policy: 0,
        origin: location.origin,
      },
      events: {
        onReady: () => resolve(),
        onStateChange: (e) => {
          playing = e.data === YT.PlayerState.PLAYING
          if (playing && !captionsApplied) applyCaptions()
          // Anything other than playing (paused by some stray input, cued...) gets resumed.
          if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.CUED) e.target.playVideo()
        },
        onError: (e) => {
          const id = loaded?.videoId
          const fatal = FATAL_ERRORS[e.data as number]
          if (id && fatal) events.onUnavailable(id, fatal)
          else events.onPlayerError(`YouTube player error ${e.data}`)
        },
      },
    })
  })
}

export function setVolume(volume: number, muted: boolean): void {
  if (!player) return
  player.setVolume(volume)
  if (muted) player.mute()
  else player.unMute()
}

// The caption module calls aren't in the typed IFrame API, but are supported by the player.
function applyCaptions(attempt = 0) {
  const p = player as any
  if (!p) return
  captionsApplied = true
  if (captions) {
    p.loadModule('captions')
    // Loading the module alone doesn't pick a track; choose YouTube's default, else the
    // system language, else whatever is first. The list can lag the first PLAYING event.
    const list: { languageCode: string; is_default?: boolean }[] = p.getOption('captions', 'tracklist') ?? []
    const lang = navigator.language.split('-')[0]
    const track = list.find((t) => t.is_default) ?? list.find((t) => t.languageCode.startsWith(lang)) ?? list[0]
    if (track) p.setOption('captions', 'track', { languageCode: track.languageCode })
    else if (attempt < 5) setTimeout(() => captions && applyCaptions(attempt + 1), 1000)
  } else {
    p.setOption('captions', 'track', {})
    p.unloadModule('captions')
  }
}

export function setCaptions(on: boolean): void {
  captions = on
  if (playing) applyCaptions()
  else captionsApplied = false
}

/** Forces the next sync to (re)tune, e.g. after a channel change. */
export function retune(): void {
  loaded = null
  lastTime = null
}

/**
 * Keeps the player locked to the channel's live schedule. Called a couple of times a second.
 * `watching` controls whether seen time counts toward the watched threshold.
 */
export function syncTv(ch: Channel | undefined, now: number, watching: boolean): void {
  if (!player) return
  const slot = ch && currentSlot(ch.schedule, now)
  if (!slot) {
    if (loaded) player.stopVideo()
    loaded = null
    setStatic(true)
    return
  }
  const expected = (now - slot.start) / 1000
  if (!loaded || loaded.videoId !== slot.videoId || loaded.start !== slot.start) {
    loaded = slot
    lastTime = null
    playing = false
    captionsApplied = false
    setStatic(true)
    player.loadVideoById({ videoId: slot.videoId, startSeconds: expected })
    return
  }

  const st = player.getPlayerState()
  if (st === YT.PlayerState.ENDED) {
    // The video ran shorter than scheduled; fill the rest of its slot with static.
    setStatic(true)
    return
  }
  if (st !== YT.PlayerState.PLAYING && st !== YT.PlayerState.BUFFERING) player.playVideo()
  if (!playing) {
    lastTime = null
    return
  }

  setStatic(false)
  const t = player.getCurrentTime()
  if (Math.abs(t - expected) > MAX_DRIFT_S) {
    player.seekTo(expected, true)
    lastTime = null
    return
  }
  if (watching && lastTime !== null && t > lastTime && t - lastTime < 3)
    tvEvents?.onWatched(slot.videoId, lastTime, t)
  lastTime = t
}
