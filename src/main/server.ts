import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const PREFERRED_PORT = 47821

/**
 * Serves the built renderer over http://localhost. YouTube embeds refuse to play from file://
 * (no valid origin/referrer), so the packaged app needs a real HTTP origin.
 */
export function serveRenderer(root: string): Promise<string> {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    const file = normalize(join(root, path === '/' ? 'index.html' : path))
    if (!file.startsWith(root)) {
      res.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  return new Promise((resolve, reject) => {
    const listen = (port: number) => server.listen(port, '127.0.0.1')
    server.on('listening', () => {
      const addr = server.address()
      resolve(`http://localhost:${typeof addr === 'object' && addr ? addr.port : PREFERRED_PORT}`)
    })
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') listen(0)
      else reject(err)
    })
    listen(PREFERRED_PORT)
  })
}
