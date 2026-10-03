import './styles.css'
import { currentSlot, markUnavailable, removeVideo } from '../shared/schedule.ts'
import { WATCHED_THRESHOLD } from '../shared/types.ts'
import { addRange, watchedFraction } from '../shared/watched.ts'
import { chNum, esc } from './format.ts'
import { renderGuide } from './guide.ts'
import { closeMenu, initMenu, isMenuOpen, openMenu } from './menu.ts'
import { currentChannel, flush, loadState, now, refreshSchedules, save, state } from './state.ts'
import { setStatic, staticBurst } from './static.ts'
import { createTv, retune, setCaptions, setVolume, syncTv } from './tv.ts'

const $ = (id: string) => document.getElementById(id)!
const guide = $('guide')
const hud = $('hud')

let guideOpen = false

function settings() {
  return state.data.settings
}

// ---- On-screen display ----------------------------------------------------------------------

function flash(el: HTMLElement, html: string, ms: number) {
  el.innerHTML = html
  el.classList.add('show')
  clearTimeout(Number(el.dataset.timer))
  el.dataset.timer = String(setTimeout(() => el.classList.remove('show'), ms))
}

function showChannelOsd() {
  const ch = currentChannel()
  const slot = currentSlot(ch.schedule, now())
  flash(
    $('osd-channel'),
    `<b>CH ${chNum(state.channelIndex)}</b><span>${esc(ch.name)}</span>` +
      (slot ? `<small>${esc(slot.title)}</small>` : `<small>NO SIGNAL</small>`),
    3500,
  )
}

function showVolumeOsd() {
  const { volume, muted } = settings()
  const bars = Math.round(volume / 5)
  flash(
    $('osd-volume'),
    muted ? 'MUTE' : `VOL <span class="bars">${'▮'.repeat(bars)}${'▯'.repeat(20 - bars)}</span> ${volume}`,
    1500,
  )
}

function toast(msg: string) {
  flash($('toast'), esc(msg), 6000)
}

// ---- Controls -------------------------------------------------------------------------------

function changeChannel(index: number) {
  const n = state.data.channels.length
  state.channelIndex = ((index % n) + n) % n
  const { volume, muted } = settings()
  staticBurst(700, muted ? 0 : volume)
  retune()
  syncTv(currentChannel(), now(), false)
  showChannelOsd()
  updateNoSignal()
  save()
}

function changeVolume(delta: number) {
  const s = settings()
  s.volume = Math.max(0, Math.min(100, s.volume + delta))
  s.muted = false
  setVolume(s.volume, s.muted)
  showVolumeOsd()
  save()
}

function toggleMute() {
  const s = settings()
  s.muted = !s.muted
  setVolume(s.volume, s.muted)
  showVolumeOsd()
  save()
}

function toggleCaptions() {
  const s = settings()
  s.captions = !s.captions
  setCaptions(s.captions)
  flash($('osd-volume'), s.captions ? 'CC ON' : 'CC OFF', 1500)
  save()
}

function toggleGuide(open = !guideOpen) {
  guideOpen = open && settings().showGuide
  guide.hidden = !guideOpen
  if (guideOpen) renderGuide(guide, state.data.channels, state.channelIndex, now())
}

function applySettings() {
  document.body.classList.toggle('crt', settings().crt)
  document.body.classList.toggle('no-guide', !settings().showGuide)
  if (!settings().showGuide) toggleGuide(false)
}

function updateNoSignal() {
  const ch = currentChannel()
  const empty = !currentSlot(ch.schedule, now())
  $('no-signal').hidden = !empty
  if (empty)
    $('no-signal').innerHTML =
      `<b>CH ${chNum(state.channelIndex)} · NO SIGNAL</b>` +
      `<span>${ch.videos.length ? 'Nothing on this channel can be aired.' : 'This channel is empty.'} ` +
      `Press <kbd>Esc</kbd> to add videos.</span>`
}

const keys: Record<string, () => void> = {
  ArrowUp: () => changeChannel(state.channelIndex + 1),
  PageUp: () => changeChannel(state.channelIndex + 1),
  ArrowDown: () => changeChannel(state.channelIndex - 1),
  PageDown: () => changeChannel(state.channelIndex - 1),
  ArrowRight: () => changeVolume(5),
  '+': () => changeVolume(5),
  '=': () => changeVolume(5),
  ArrowLeft: () => changeVolume(-5),
  '-': () => changeVolume(-5),
  m: toggleMute,
  c: toggleCaptions,
  f: () => void window.api.toggleFullscreen(),
  g: () => toggleGuide(),
  Escape: () => (guideOpen ? toggleGuide(false) : openMenu()),
}

function onKey(e: KeyboardEvent) {
  if (isMenuOpen()) {
    if (e.key === 'Escape') closeMenu()
    return
  }
  // Swallow everything on the TV screen (space, k, j, l…) so nothing can reach the player.
  e.preventDefault()
  if (e.metaKey || e.ctrlKey) return
  const n = Number(e.key)
  if (n >= 1 && n <= state.data.channels.length) changeChannel(n - 1)
  else keys[e.key.length === 1 ? e.key.toLowerCase() : e.key]?.()
}

let hudTimer = 0
function wakeHud() {
  document.body.classList.add('awake')
  clearTimeout(hudTimer)
  hudTimer = window.setTimeout(() => document.body.classList.remove('awake'), 2500)
}

function onHudClick(e: MouseEvent) {
  const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action
  const actions: Record<string, () => void> = {
    'ch-up': keys.ArrowUp,
    'ch-down': keys.ArrowDown,
    'vol-up': keys.ArrowRight,
    'vol-down': keys.ArrowLeft,
    mute: toggleMute,
    captions: toggleCaptions,
    guide: () => toggleGuide(),
    fullscreen: keys.f,
    menu: openMenu,
  }
  if (action) actions[action]?.()
}

// ---- Broadcast ------------------------------------------------------------------------------

function onWatched(videoId: string, from: number, to: number) {
  const ch = currentChannel()
  const v = ch.videos.find((x) => x.id === videoId)
  if (!v) return
  v.watched = addRange(v.watched, from, to)
  if (watchedFraction(v.watched, v.duration) >= WATCHED_THRESHOLD) {
    // The program keeps airing to the end; it just won't be scheduled again.
    removeVideo(ch, v.id, now())
    toast(`✓ Watched "${v.title}" — it's been removed from ${ch.name}.`)
  }
  save()
}

function onUnavailable(videoId: string, reason: string) {
  const ch = currentChannel()
  const title = ch.videos.find((v) => v.id === videoId)?.title ?? videoId
  markUnavailable(ch, videoId, reason, now())
  retune()
  toast(`"${title}" can't be aired (${reason}). Skipped and flagged in the menu.`)
  save()
}

function tick() {
  const watching = !isMenuOpen() && document.visibilityState === 'visible'
  syncTv(currentChannel(), now(), watching)
  updateNoSignal()
  if (guideOpen) renderGuide(guide, state.data.channels, state.channelIndex, now())
}

async function boot() {
  setStatic(true)
  await loadState()
  applySettings()
  initMenu({
    onClose: () => {
      applySettings()
      showChannelOsd()
    },
    onChange: () => {
      applySettings()
      updateNoSignal()
    },
  })

  window.addEventListener('keydown', onKey)
  window.addEventListener('mousemove', wakeHud)
  hud.addEventListener('click', onHudClick)
  window.addEventListener('beforeunload', flush)

  await createTv({ onWatched, onUnavailable, onPlayerError: toast })
  // Make sure the embed can never take keyboard focus.
  document.querySelector('#player')?.setAttribute('tabindex', '-1')
  setVolume(settings().volume, settings().muted)
  setCaptions(settings().captions)

  tick()
  setInterval(tick, 500)
  setInterval(refreshSchedules, 30_000)
  showChannelOsd()
  if (currentChannel().videos.length === 0) openMenu()
}

void boot()
