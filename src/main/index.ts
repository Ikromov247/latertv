import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { loadData, saveData } from './store.ts'
import { fetchPlaylist, fetchVideos, validateKey } from './youtube.ts'
import { serveRenderer } from './server.ts'

// Media keys must not be able to pause the broadcast.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// One data folder whether run from source or as the packaged "Later TV" app (which would
// otherwise pick a folder named after the product). Dev/test runs can point it elsewhere.
app.setPath('userData', process.env.LATERTV_USER_DATA ?? join(app.getPath('appData'), 'later-tv'))

let rendererOrigin = ''

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 640,
    minHeight: 400,
    backgroundColor: '#000000',
    title: 'Later TV',
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
ipcMain.handle('yt:validate', (_e, key: string) => validateKey(key))
ipcMain.handle('win:fullscreen', (e, on: boolean) => {
  BrowserWindow.fromWebContents(e.sender)?.setFullScreen(on)
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
