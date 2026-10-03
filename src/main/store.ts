import { app } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppData } from '../shared/types.ts'

const file = () => join(app.getPath('userData'), 'latertv.json')

/** Where data lived when the app was still called Random TV. Read once, never written. */
const legacyFiles = () => [
  join(app.getPath('userData'), 'randomtv.json'),
  join(app.getPath('appData'), 'random-tv', 'randomtv.json'),
]

export async function loadData(): Promise<AppData | null> {
  for (const path of [file(), ...legacyFiles()]) {
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch {
      // Missing or unreadable: try the next location.
    }
  }
  return null
}

let writing: Promise<void> = Promise.resolve()

/** Writes atomically (temp file + rename), serialized so saves never interleave. */
export function saveData(data: AppData): Promise<void> {
  writing = writing.then(async () => {
    const tmp = `${file()}.tmp`
    await writeFile(tmp, JSON.stringify(data))
    await rename(tmp, file())
  })
  return writing
}
