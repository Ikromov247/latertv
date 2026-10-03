import type { Channel, Slot, Video, VideoMeta } from './types.ts'

/** How far ahead of "now" the schedule is planned. */
export const HORIZON_MS = 3 * 3600_000
/** Always keep at least this many programs queued after the current one. */
export const MIN_UPCOMING = 3
/**
 * If the channel has been off-air (app closed) for longer than this, start a fresh broadcast at a
 * random point instead of replaying everything that "aired" in the meantime.
 */
export const MAX_CATCHUP_MS = 24 * 3600_000

/** Longer videos (e.g. multi-day stream recordings) can't sensibly hold a channel. */
export const MAX_DURATION_S = 12 * 3600

export type Rng = () => number

export const slotEnd = (s: Slot): number => s.start + s.duration * 1000

export const airable = (ch: Channel): Video[] =>
  ch.videos.filter((v) => v.status === 'ok' && v.duration > 0)

export function currentSlot(schedule: Slot[], now: number): Slot | undefined {
  return schedule.find((s) => s.start <= now && now < slotEnd(s))
}

export function upcomingSlots(schedule: Slot[], now: number): Slot[] {
  return schedule.filter((s) => s.start > now)
}

/**
 * Picks the next video to air. Videos aired recently are avoided, and among the rest the
 * least-aired win, so every video airs once before any airs twice and new videos come up soon.
 */
export function pickNext(pool: Video[], schedule: Slot[], rng: Rng): Video {
  const window = Math.min(pool.length - 1, schedule.length)
  const recent = new Set(schedule.slice(schedule.length - window).map((s) => s.videoId))
  let candidates = pool.filter((v) => !recent.has(v.id))
  if (candidates.length === 0) candidates = pool
  const min = Math.min(...candidates.map((v) => v.airCount))
  const least = candidates.filter((v) => v.airCount === min)
  return least[Math.floor(rng() * least.length)]
}

function makeSlot(v: Video, start: number): Slot {
  v.airCount++
  return { videoId: v.id, title: v.title, start, duration: v.duration }
}

/**
 * Brings the schedule up to date: drops programs that have finished airing and appends new ones
 * at the end until the horizon is covered. Never touches existing slots that haven't finished.
 */
export function fillSchedule(ch: Channel, now: number, rng: Rng = Math.random): void {
  const pool = airable(ch)
  const sched = [...ch.schedule]
  if (pool.length > 0) {
    const tail = sched.at(-1)
    if (!tail || now - slotEnd(tail) > MAX_CATCHUP_MS) {
      // Tuning into a channel from scratch: land somewhere in the middle of a random program.
      sched.length = 0
      const v = pickNext(pool, sched, rng)
      sched.push(makeSlot(v, now - rng() * v.duration * 1000))
    }
    while (
      slotEnd(sched.at(-1)!) < now + HORIZON_MS ||
      upcomingSlots(sched, now).length < MIN_UPCOMING
    ) {
      const v = pickNext(pool, sched, rng)
      sched.push(makeSlot(v, slotEnd(sched.at(-1)!)))
    }
  }
  ch.schedule = sched.filter((s) => slotEnd(s) > now)
}

/**
 * Takes a video off the schedule. The program airing now stays put (unless `cutCurrent`, used
 * when it can't be played at all); later programs slide earlier to close the gap, in the same
 * order, and the freed time at the end is filled with new programs.
 */
export function unschedule(
  ch: Channel,
  videoId: string,
  now: number,
  opts: { cutCurrent?: boolean; rng?: Rng } = {},
): void {
  const isCut = (s: Slot) =>
    !!opts.cutCurrent && s.videoId === videoId && s.start <= now && now < slotEnd(s)
  const locked = ch.schedule.filter((s) => s.start <= now && !isCut(s))
  const future = ch.schedule.filter((s) => s.start > now && s.videoId !== videoId)
  let t = Math.max(now, locked.length ? slotEnd(locked.at(-1)!) : now)
  for (const s of future) {
    s.start = t
    t = slotEnd(s)
  }
  ch.schedule = [...locked, ...future]
  fillSchedule(ch, now, opts.rng)
}

/** Removes a video from the channel's collection and closes its gaps in the schedule. */
export function removeVideo(ch: Channel, videoId: string, now: number, rng?: Rng): void {
  ch.videos = ch.videos.filter((v) => v.id !== videoId)
  unschedule(ch, videoId, now, { rng })
}

/** Marks a video unplayable, cutting it immediately if it's on air. */
export function markUnavailable(
  ch: Channel,
  videoId: string,
  reason: string,
  now: number,
  rng?: Rng,
): void {
  const v = ch.videos.find((x) => x.id === videoId)
  if (v) {
    v.status = 'unavailable'
    v.reason = reason
  }
  unschedule(ch, videoId, now, { cutCurrent: true, rng })
}

/** Adds resolved videos to the channel (skipping duplicates). Returns how many were added. */
export function addVideos(ch: Channel, metas: VideoMeta[], now: number, rng?: Rng): number {
  const have = new Set(ch.videos.map((v) => v.id))
  // Start new videos level with the least-aired ones so they rotate in fairly instead of looping.
  const baseCount = ch.videos.length ? Math.min(...ch.videos.map((v) => v.airCount)) : 0
  let added = 0
  for (const m of metas) {
    if (have.has(m.id)) continue
    have.add(m.id)
    const tooLong = m.duration > MAX_DURATION_S
    const playable = m.embeddable && !m.error && m.duration > 0 && !tooLong
    ch.videos.push({
      id: m.id,
      title: m.title || m.id,
      duration: m.duration,
      addedAt: now,
      status: playable ? 'ok' : 'unavailable',
      reason: playable
        ? undefined
        : (m.error ??
          (tooLong ? 'Over 12 hours, too long to schedule' : m.embeddable ? 'Unknown duration' : 'Embedding disabled')),
      watched: [],
      airCount: baseCount,
    })
    added++
  }
  fillSchedule(ch, now, rng)
  return added
}
