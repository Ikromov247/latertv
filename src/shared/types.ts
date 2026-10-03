export type VideoStatus = 'ok' | 'unavailable'

export interface Video {
  id: string
  title: string
  /** Runtime in seconds. */
  duration: number
  addedAt: number
  status: VideoStatus
  /** Why the video can't be aired, when status is 'unavailable'. */
  reason?: string
  /** Merged [start, end] ranges (seconds of video time) the viewer has actually seen. */
  watched: [number, number][]
  /** How many times this video has been placed on the schedule. */
  airCount: number
}

export interface Slot {
  videoId: string
  title: string
  /** Wall-clock start, epoch ms. */
  start: number
  /** Seconds. */
  duration: number
}

export interface Channel {
  id: string
  name: string
  videos: Video[]
  schedule: Slot[]
}

export interface Settings {
  apiKey: string
  showGuide: boolean
  crt: boolean
  volume: number
  muted: boolean
  captions: boolean
}

export interface AppData {
  version: 1
  channels: Channel[]
  settings: Settings
  lastChannelId: string | null
}

/** Metadata returned by the main process when resolving YouTube ids. */
export interface VideoMeta {
  id: string
  title: string
  duration: number
  embeddable: boolean
  error?: string
}

export interface Api {
  loadData(): Promise<AppData | null>
  saveData(data: AppData): Promise<void>
  fetchVideos(ids: string[], apiKey: string): Promise<VideoMeta[]>
  fetchPlaylist(playlistId: string, apiKey: string): Promise<VideoMeta[]>
  toggleFullscreen(): Promise<void>
}

export const WATCHED_THRESHOLD = 0.7
