import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { loadData, saveData } from './store.ts'
import { fetchPlaylist, fetchVideos } from './youtube.ts'
import { serveRenderer } from './server.ts'

// Media keys must not be able to pause the broadcast.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// Lets dev/test runs use a throwaway data folder.
if (process.env.RANDOMTV_USER_DATA) app.setPath('userData', process.env.RANDOMTV_USER_DATA)

let rendererOrigin = ''

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 640,
    minHeight: 400,
    backgroundColor: '#000000',
    title: 'Random TV',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  // Keep the app on its own origin; anything else opens in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(rendererOrigin)) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  const url = devUrl ?? (await serveRenderer(join(__dirname, '../renderer')))
  rendererOrigin = new URL(url).origin
  await win.loadURL(url)
}

ipcMain.handle('data:load', () => loadData())
ipcMain.handle('data:save', (_e, data) => saveData(data))
ipcMain.handle('yt:videos', (_e, ids: string[], key: string) => fetchVideos(ids, key))
ipcMain.handle('yt:playlist', (_e, id: string, key: string) => fetchPlaylist(id, key))
ipcMain.handle('win:fullscreen', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  win?.setFullScreen(!win.isFullScreen())
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
