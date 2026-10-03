import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HORIZON_MS,
  MAX_CATCHUP_MS,
  addVideos,
  currentSlot,
  fillSchedule,
  markUnavailable,
  removeVideo,
  slotEnd,
  upcomingSlots,
} from './schedule.ts'
import type { Channel, Slot, VideoMeta } from './types.ts'

const T0 = Date.UTC(2026, 9, 2, 12)

function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
}

function meta(id: string, duration = 600): VideoMeta {
  return { id, title: id, duration, embeddable: true }
}

function channel(n: number, rng = seeded()): Channel {
  const ch: Channel = { id: 'c', name: 'Test', videos: [], schedule: [] }
  addVideos(ch, Array.from({ length: n }, (_, i) => meta(`v${i}`, 300 + i * 60)), T0, rng)
  return ch
}

function assertContiguous(sched: Slot[]) {
  for (let i = 1; i < sched.length; i++) assert.equal(sched[i].start, slotEnd(sched[i - 1]))
}

test('a new channel starts mid-program and covers the horizon', () => {
  const ch = channel(5)
  const cur = currentSlot(ch.schedule, T0)!
  assert.ok(cur.start <= T0 && T0 < slotEnd(cur))
  assert.ok(slotEnd(ch.schedule.at(-1)!) >= T0 + HORIZON_MS)
  assertContiguous(ch.schedule)
})

test('every video airs once before any airs twice', () => {
  const ch = channel(6)
  const firstSix = ch.schedule.slice(0, 6).map((s) => s.videoId)
  assert.equal(new Set(firstSix).size, 6)
})

test('no back-to-back repeats with two videos', () => {
  const ch = channel(2)
  for (let i = 1; i < ch.schedule.length; i++)
    assert.notEqual(ch.schedule[i].videoId, ch.schedule[i - 1].videoId)
})

test('removing a video keeps the current program, slides later ones earlier, and refills the end', () => {
  const ch = channel(6)
  const cur = currentSlot(ch.schedule, T0)!
  const victim = upcomingSlots(ch.schedule, T0)[1].videoId
  const orderBefore = ch.schedule.map((s) => s.videoId).filter((id) => id !== victim)

  removeVideo(ch, victim, T0, seeded(2))

  assert.deepEqual(currentSlot(ch.schedule, T0), cur)
  assert.ok(!ch.schedule.some((s) => s.videoId === victim))
  assert.ok(!ch.videos.some((v) => v.id === victim))
  assertContiguous(ch.schedule)
  // Same relative order for everything that was already planned, no reshuffle.
  assert.deepEqual(ch.schedule.slice(0, orderBefore.length).map((s) => s.videoId), orderBefore)
  assert.ok(slotEnd(ch.schedule.at(-1)!) >= T0 + HORIZON_MS)
})

test('removing the video on air lets it finish', () => {
  const ch = channel(4)
  const cur = currentSlot(ch.schedule, T0)!
  removeVideo(ch, cur.videoId, T0)
  assert.deepEqual(currentSlot(ch.schedule, T0), cur)
  assert.ok(!upcomingSlots(ch.schedule, T0).some((s) => s.videoId === cur.videoId))
})

test('an unavailable video on air is cut and the next program starts now', () => {
  const ch = channel(4)
  const cur = currentSlot(ch.schedule, T0)!
  markUnavailable(ch, cur.videoId, 'Error 150', T0)
  const now = currentSlot(ch.schedule, T0)!
  assert.notEqual(now.videoId, cur.videoId)
  assert.equal(now.start, T0)
  assertContiguous(ch.schedule)
})

test('the channel keeps airing while the app is closed', () => {
  const ch = channel(5)
  const later = T0 + 5 * 3600_000
  fillSchedule(ch, later)
  const cur = currentSlot(ch.schedule, later)!
  assert.ok(cur)
  assertContiguous(ch.schedule)
  assert.ok(slotEnd(ch.schedule.at(-1)!) >= later + HORIZON_MS)
})

test('after a very long time off it tunes into a fresh random program', () => {
  const ch = channel(5)
  const later = T0 + MAX_CATCHUP_MS + 10 * 3600_000
  fillSchedule(ch, later)
  assert.ok(currentSlot(ch.schedule, later))
})

test('new videos are added at the end and rotate in fairly', () => {
  const ch = channel(3)
  const before = ch.schedule.map((s) => ({ ...s }))
  addVideos(ch, [meta('new')], T0)
  assert.deepEqual(ch.schedule.slice(0, before.length), before)
  const v = ch.videos.find((x) => x.id === 'new')!
  assert.equal(v.airCount, Math.min(...ch.videos.filter((x) => x !== v).map((x) => x.airCount)))
})

test('absurdly long videos are flagged instead of scheduled', () => {
  const ch: Channel = { id: 'c', name: 'Long', videos: [], schedule: [] }
  addVideos(ch, [meta('ok'), meta('forever', 121_601_512)], T0)
  assert.equal(ch.videos.find((v) => v.id === 'forever')!.status, 'unavailable')
  assert.ok(ch.schedule.every((s) => s.videoId === 'ok'))
})

test('an empty channel has no schedule', () => {
  const ch: Channel = { id: 'c', name: 'Empty', videos: [], schedule: [] }
  fillSchedule(ch, T0)
  assert.equal(ch.schedule.length, 0)
})
