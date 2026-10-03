import { fillSchedule } from '../shared/schedule.ts'
import type { AppData, Channel } from '../shared/types.ts'

export const now = (): number => Date.now()

function defaultData(): AppData {
  return {
    version: 1,
    channels: [],
    settings: { apiKey: '', showGuide: true, crt: true, volume: 60, muted: false, captions: false },
    lastChannelId: null,
  }
}

export const state = {
  data: defaultData(),
  channelIndex: 0,
}

export async function loadState(): Promise<void> {
  const saved = await window.api.loadData()
  if (saved) state.data = { ...defaultData(), ...saved, settings: { ...defaultData().settings, ...saved.settings } }
  if (state.data.channels.length === 0) state.data.channels.push(newChannel('Channel 1'))
  const i = state.data.channels.findIndex((c) => c.id === state.data.lastChannelId)
  state.channelIndex = Math.max(0, i)
  refreshSchedules()
}

export function newChannel(name: string): Channel {
  return { id: crypto.randomUUID(), name, videos: [], schedule: [] }
}

export function currentChannel(): Channel {
  return state.data.channels[state.channelIndex]
}

/** Extends every channel's schedule up to the horizon (channels keep airing while unwatched). */
export function refreshSchedules(): void {
  const t = now()
  for (const ch of state.data.channels) fillSchedule(ch, t)
  save()
}

let saveTimer: number | null = null

/** Throttled save: frequent callers (watch tracking) still get written at most once a second. */
export function save(): void {
  if (saveTimer !== null) return
  saveTimer = window.setTimeout(flush, 1000)
}

export function flush(): void {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = null
  state.data.lastChannelId = currentChannel()?.id ?? null
  void window.api.saveData(state.data)
}
