import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addRange, watchedFraction } from './watched.ts'
import { parseIsoDuration, parsePlaylistId, parseVideoId } from './youtube.ts'

test('parseVideoId handles common URL shapes', () => {
  const id = 'dQw4w9WgXcQ'
  for (const u of [
    id,
    `https://www.youtube.com/watch?v=${id}&t=42s`,
    `youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://m.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}`,
  ])
    assert.equal(parseVideoId(u), id, u)
  assert.equal(parseVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), null)
  assert.equal(parseVideoId('hello'), null)
})

test('parsePlaylistId', () => {
  assert.equal(parsePlaylistId('https://www.youtube.com/playlist?list=PLabc123'), 'PLabc123')
  assert.equal(parsePlaylistId('https://youtube.com/watch?v=x&list=PLxyz'), 'PLxyz')
  assert.equal(parsePlaylistId('PLabc123'), 'PLabc123')
})

test('parseIsoDuration', () => {
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723)
  assert.equal(parseIsoDuration('PT45S'), 45)
  assert.equal(parseIsoDuration('P1DT1S'), 86401)
})

test('watched ranges merge and accumulate', () => {
  let r: [number, number][] = []
  r = addRange(r, 0, 10)
  r = addRange(r, 20, 30)
  r = addRange(r, 5, 25)
  assert.deepEqual(r, [[0, 30]])
  r = addRange(r, 40, 50)
  r = addRange(r, 35, 36)
  assert.deepEqual(r, [[0, 30], [35, 36], [40, 50]])
  assert.equal(watchedFraction(r, 100), 0.41)
})
