/** TV static: animated noise on a canvas, plus an optional burst of white-noise audio. */

const canvas = document.getElementById('static') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const img = ctx.createImageData(canvas.width, canvas.height)
const pixels = new Uint32Array(img.data.buffer)

let visible = false
let frame = 0

function draw() {
  if (!visible) return
  for (let i = 0; i < pixels.length; i++) {
    const v = (Math.random() * 255) | 0
    pixels[i] = 0xff000000 | (v << 16) | (v << 8) | v
  }
  ctx.putImageData(img, 0, 0)
  frame = requestAnimationFrame(draw)
}

let audio: AudioContext | null = null
let noise: AudioBufferSourceNode | null = null

function startHiss(volume: number) {
  if (volume <= 0 || noise) return
  audio ??= new AudioContext()
  const buf = audio.createBuffer(1, audio.sampleRate, audio.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const gain = audio.createGain()
  gain.gain.value = (volume / 100) * 0.12
  noise = audio.createBufferSource()
  noise.buffer = buf
  noise.loop = true
  noise.connect(gain).connect(audio.destination)
  noise.start()
}

function stopHiss() {
  noise?.stop()
  noise = null
}

let wanted = false
let burstUntil = 0

function update() {
  const t = performance.now()
  if (t >= burstUntil) stopHiss()
  const on = wanted || t < burstUntil
  if (on === visible) return
  visible = on
  canvas.classList.toggle('on', on)
  if (on) frame = requestAnimationFrame(draw)
  else cancelAnimationFrame(frame)
}

/** Static that stays up for as long as there's nothing to show (tuning, no signal). */
export function setStatic(on: boolean): void {
  wanted = on
  update()
}

/** A short burst of static with hiss, like flipping channels. Volume 0-100. */
export function staticBurst(ms: number, volume: number): void {
  burstUntil = performance.now() + ms
  startHiss(volume)
  update()
  setTimeout(update, ms + 20)
}
