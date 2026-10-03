import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '../shared/types.ts'

const api: Api = {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  fetchVideos: (ids, apiKey) => ipcRenderer.invoke('yt:videos', ids, apiKey),
  fetchPlaylist: (id, apiKey) => ipcRenderer.invoke('yt:playlist', id, apiKey),
  toggleFullscreen: () => ipcRenderer.invoke('win:fullscreen'),
}

contextBridge.exposeInMainWorld('api', api)
