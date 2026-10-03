import { addVideos, currentSlot, removeVideo, slotEnd, upcomingSlots } from '../shared/schedule.ts'
import { WATCHED_THRESHOLD, type Channel, type Video, type VideoMeta } from '../shared/types.ts'
import { watchedFraction } from '../shared/watched.ts'
import { parsePlaylistId, parseVideoId } from '../shared/youtube.ts'
import { chNum, clockParts, esc, fmtClock, fmtDuration, plural } from './format.ts'
import { currentChannel, newChannel, now, save, state } from './state.ts'

/**
 * The guide: what the TV shrinks into. Shows what's on, a timeline of every channel, and the
 * selected channel's library. Settings is a separate full screen on top of it.
 */

export interface GuideHooks {
  changeChannel(index: number): void
  /** Grow the mini screen back to the TV; optionally make the window fullscreen too. */
  maximize(windowFullscreen: boolean): void
  /** CRT / program guide / captions changed. */
  applySettings(): void
}

type AddState = 'closed' | 'open' | 'looking' | 'result' | 'error'
type KeyState = 'idle' | 'checking' | 'ok' | 'error'

const TIMELINE_MS = 150 * 60_000
const isMac = navigator.platform.toLowerCase().includes('mac')

const $ = (id: string) => document.getElementById(id)!
const el = {
  gm: $('gm'),
  nowLabel: $('gm-now-label'),
  clock: $('gm-clock'),
  nowTitle: $('gm-now-title'),
  nowMeta: $('gm-now-meta'),
  grid: $('gm-grid'),
  channel: $('gm-channel'),
  libHead: $('gm-lib-head'),
  library: $('gm-library'),
  add: $('gm-add'),
  ss: $('settings-screen'),
  ssAiring: $('ss-airing'),
  ssClock: $('ss-clock'),
  ssToggles: $('ss-toggles'),
  keyStatus: $('ss-key-status'),
  keyInput: $('ss-key-input') as HTMLInputElement,
  keySave: $('ss-key-save') as HTMLButtonElement,
  keyMsg: $('ss-key-msg'),
}

const ui = {
  add: 'closed' as AddState,
  draft: '',
  /** Status line under the add box (result or error), as HTML. */
  addMsg: '',
  lookingLabel: '',
  cantOpen: false,
  confirmRemove: null as string | null,
  confirmDelete: false,
  renaming: false,
  settingsOpen: false,
  /** Keyboard-highlighted settings row; -1 = none until the arrows are used. */
  focus: -1,
  key: 'idle' as KeyState,
}

let hooks: GuideHooks

/** Only touch the DOM when a region's markup actually changed, so hovers and focus survive ticks. */
const rendered = new Map<HTMLElement, string>()
function put(target: HTMLElement, html: string) {
  if (rendered.get(target) === html) return
  target.innerHTML = html
  rendered.set(target, html)
}

function clockHtml(t: number) {
  const [time, suffix] = clockParts(t)
  return `${time}${suffix ? `<small>${suffix}</small>` : ''}`
}

const shortClock = (t: number) => clockParts(t)[0]

// ---- Now playing ------------------------------------------------------------------------------

function renderNow(t: number) {
  const ch = currentChannel()
  const i = state.channelIndex
  const slot = currentSlot(ch.schedule, t)
  put(el.clock, clockHtml(t))
  if (!slot) {
    put(el.nowLabel, `CH ${chNum(i)} · ${esc(ch.name.toUpperCase())}`)
    const anyVideos = ch.videos.length > 0
    put(el.nowTitle, anyVideos ? 'Nothing can air' : 'Nothing on yet')
    put(
      el.nowMeta,
      anyVideos
        ? `Every video on ${esc(ch.name)} is unavailable.`
        : `Add videos to ${esc(ch.name)} and it starts airing right away.`,
    )
    return
  }
  const v = ch.videos.find((x) => x.id === slot.videoId)
  const left = Math.max(1, Math.ceil((slotEnd(slot) - t) / 60_000))
  const watched = v ? ` · ${Math.round(watchedFraction(v.watched, v.duration) * 100)}% watched` : ''
  put(el.nowLabel, `NOW ON ${chNum(i)} · ${esc(ch.name.toUpperCase())}`)
  put(el.nowTitle, esc(slot.title))
  put(el.nowMeta, `${shortClock(slot.start)} – ${fmtClock(slotEnd(slot))} · ${left} min left${watched}`)
}

// ---- Timeline grid --------------------------------------------------------------------------

function timelineStart(t: number) {
  const d = new Date(t)
  d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0)
  return d.getTime()
}

function programCells(ch: Channel, t: number, ws: number): string {
  const we = ws + TIMELINE_MS
  return ch.schedule
    .filter((s) => slotEnd(s) > ws && s.start < we)
    .map((s) => {
      const a = Math.max(s.start, ws)
      const b = Math.min(slotEnd(s), we)
      const left = ((a - ws) / TIMELINE_MS) * 100
      const width = ((b - a) / TIMELINE_MS) * 100
      const isNow = s.start <= t && t < slotEnd(s)
      const label = isNow
        ? `● NOW · ${Math.max(1, Math.ceil((slotEnd(s) - t) / 60_000))} MIN LEFT`
        : shortClock(s.start)
      return `<div class="gm-prog${isNow ? ' now' : ''}" style="left:${left.toFixed(2)}%;width:calc(${width.toFixed(2)}% - 3px)" title="${esc(s.title)}">
        ${width > 3.5 || isNow ? `<span class="t">${label}</span>` : ''}${width > 7 ? `<span class="ti">${esc(s.title)}</span>` : ''}
      </div>`
    })
    .join('')
}

function renderGrid(t: number) {
  const ws = timelineStart(t)
  const ticks = [0, 1, 2, 3, 4]
    .map((k) => `<span style="left:calc(${k * 20}% + 8px)">${shortClock(ws + k * 30 * 60_000)}</span>`)
    .join('')
  const nowLeft = ((t - ws) / TIMELINE_MS) * 100
  const rows = state.data.channels.map((ch, i) => {
    const sel = i === state.channelIndex
    const ok = ch.videos.filter((v) => v.status === 'ok').length
    const progs = ch.schedule.length
      ? `<div class="gm-progs">${programCells(ch, t, ws)}</div>`
      : `<div class="gm-nosignal">NO SIGNAL · ${ch.videos.length ? 'NOTHING HERE CAN AIR' : 'ADD VIDEOS TO START AIRING'}</div>`
    return `<div class="gm-row${sel ? ' sel' : ''}">
      <button class="gm-chbtn" data-act="select-channel" data-i="${i}" aria-current="${sel}">
        <b>${chNum(i)}</b>
        <span class="gm-chtext"><span class="nm">${esc(ch.name)}</span><small>${ok ? plural(ok, 'program') : 'Empty'}</small></span>
      </button>
      ${progs}
    </div>`
  })
  const hour = new Date(t).getHours()
  put(
    el.grid,
    `<div class="gm-row gm-head">
       <div class="gm-headcell">${hour >= 17 || hour < 4 ? 'TONIGHT' : 'TODAY'}</div>
       <div class="gm-ticks">${ticks}<i class="gm-nowline" style="left:${nowLeft.toFixed(2)}%"></i></div>
     </div>
     ${rows.join('')}
     <div class="gm-row gm-newrow"><button class="gm-newch" data-act="new-channel">+ New channel</button></div>`,
  )
}

// ---- Selected channel -----------------------------------------------------------------------

function renderChannel() {
  const ch = currentChannel()
  const ok = ch.videos.filter((v) => v.status === 'ok')
  const cant = ch.videos.length - ok.length
  const total = ok.reduce((s, v) => s + v.duration, 0)
  const h = Math.floor(total / 3600)
  const m = Math.round((total % 3600) / 60)
  const meta = ch.videos.length
    ? [plural(ok.length, 'program'), h ? `${h}h ${m}m` : `${m}m`, cant ? `${cant} can’t air` : '']
        .filter(Boolean)
        .join(' · ')
    : 'No signal · empty'
  const name = ui.renaming
    ? `<input id="gm-rename" value="${esc(ch.name)}" maxlength="40" aria-label="Channel name" />`
    : `<span>${esc(ch.name)}</span>`
  const actions = ui.confirmDelete
    ? `<button class="btn-sm" data-act="cancel-delete">Keep</button>
       <button class="btn-sm danger-fill" data-act="confirm-delete">Delete ${esc(ch.name)}</button>`
    : `<button class="btn-sm" data-act="rename">Rename</button>
       <button class="btn-sm danger" data-act="delete-channel">Delete channel</button>`
  put(
    el.channel,
    `<span class="cap">SELECTED CHANNEL</span>
     <div class="gm-chtitle"><b>${chNum(state.channelIndex)}</b>${name}</div>
     <span class="gm-chmeta">${meta}</span>
     <div class="gm-chactions">${actions}</div>`,
  )
  if (ui.renaming) {
    const input = $('gm-rename') as HTMLInputElement
    if (document.activeElement !== input) {
      input.focus()
      input.select()
    }
  }
}

// ---- Library --------------------------------------------------------------------------------

function removeButton(v: Video) {
  return ui.confirmRemove === v.id
    ? `<button class="xbtn confirm" data-act="confirm-remove" data-id="${v.id}">REMOVE?</button>`
    : `<button class="xbtn" data-act="remove" data-id="${v.id}" aria-label="Remove ${esc(v.title)} from channel">✕</button>`
}

function renderLibrary(t: number) {
  const ch = currentChannel()
  const ok = ch.videos.filter((v) => v.status === 'ok')
  const cant = ch.videos.filter((v) => v.status !== 'ok')
  put(el.libHead, ok.length ? `LIBRARY · ${ok.length} IN ROTATION` : 'LIBRARY')

  if (!ch.videos.length) {
    put(el.library, `<div class="gm-empty">Nothing on ${esc(ch.name)} yet.</div>`)
    return
  }

  const onAir = currentSlot(ch.schedule, t)?.videoId
  const upcoming = upcomingSlots(ch.schedule, t)
  const nextAir = new Map<string, number>()
  for (const s of upcoming) if (!nextAir.has(s.videoId)) nextAir.set(s.videoId, s.start)
  const rank = (v: Video) => (v.id === onAir ? -1 : (nextAir.get(v.id) ?? Infinity))
  const sorted = [...ok].sort((a, b) => rank(a) - rank(b) || b.addedAt - a.addedAt)

  const rows = sorted.map((v) => {
    const pct = watchedFraction(v.watched, v.duration) * 100
    let status = `<span class="st">In rotation</span>`
    if (v.id === onAir) status = `<span class="st live">● ON AIR</span>`
    else if (nextAir.has(v.id)) {
      const at = nextAir.get(v.id)!
      status =
        at === upcoming[0]?.start
          ? `<span class="st next">Next · ${fmtClock(at)}</span>`
          : `<span class="st">Airs ${fmtClock(at)}</span>`
    }
    return `<div class="vrow">
      <img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" alt="" loading="lazy" />
      <span class="ti" title="${esc(v.title)}">${esc(v.title)}</span>
      ${status}
      <span class="dur">${fmtDuration(v.duration)}</span>
      <span class="wbar" title="${Math.round(pct)}% watched"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i><u style="left:${WATCHED_THRESHOLD * 100}%"></u></span>
      ${removeButton(v)}
    </div>`
  })

  if (cant.length) {
    const reasons = [...new Set(cant.map((v) => v.reason ?? 'Unavailable'))]
    rows.push(`<button class="cant-toggle" data-act="toggle-cant" aria-expanded="${ui.cantOpen}">
      <span class="dot"></span><span class="txt">${cant.length} can’t air</span><span class="why">${esc(reasons.slice(0, 2).join(', '))}</span>
      <span class="more">${ui.cantOpen ? 'HIDE ▴' : 'SHOW ▾'}</span>
    </button>`)
    if (ui.cantOpen)
      for (const v of cant)
        rows.push(`<div class="vrow cant">
          <div class="ns-thumb">NO SIGNAL</div>
          <span class="ti" title="${esc(v.title)}">${esc(v.title)}</span>
          <span class="reason">${esc(v.reason ?? 'Unavailable')}</span>
          ${removeButton(v)}
        </div>`)
  }
  put(el.library, rows.join(''))
}

// ---- Adding videos --------------------------------------------------------------------------

function renderAdd() {
  if (ui.add === 'closed') {
    put(
      el.add,
      `<button class="add-btn" data-act="open-add"><span class="plus">+</span><b>Add videos</b><small>links or a playlist</small></button>`,
    )
    return
  }
  const looking = ui.add === 'looking'
  const status = {
    open: `<span class="hint">${isMac ? '⌘' : 'Ctrl'} Enter to add · Esc to close</span>`,
    looking: `<div class="looking"><span>${esc(ui.lookingLabel)}</span><span class="lookbar"><i></i></span></div>`,
    result: ui.addMsg,
    error: ui.addMsg,
  }[ui.add]
  put(
    el.add,
    `<div class="add-panel">
      <div class="add-head"><span>ADD TO ${esc(currentChannel().name.toUpperCase())}</span><small>One link per line, or a playlist URL</small></div>
      <textarea id="gm-draft" rows="3" ${looking ? 'disabled' : ''} placeholder="https://youtu.be/…&#10;https://www.youtube.com/playlist?list=…">${esc(ui.draft)}</textarea>
      <div class="add-foot">
        <div class="add-status" role="status">${status}</div>
        <button class="btn-sm" data-act="close-add">${ui.add === 'result' ? 'Done' : 'Cancel'}</button>
        <button class="btn-sel" data-act="submit-add" ${looking ? 'disabled' : ''}>${looking ? 'ADDING…' : 'ADD VIDEOS'}</button>
      </div>
    </div>`,
  )
}

function openAdd() {
  ui.add = 'open'
  ui.addMsg = ''
  renderAdd()
  const ta = $('gm-draft') as HTMLTextAreaElement
  ta.focus()
  ta.closest('.gm-scroll')!.scrollTop = 1e6
}

function closeAdd() {
  if (ui.add === 'looking') return
  ui.add = 'closed'
  ui.draft = ''
  ui.addMsg = ''
  renderAdd()
}

function addError(lines: string[]) {
  ui.add = 'error'
  ui.addMsg = `<div class="msg-lines">${lines.join('')}</div>`
  renderAdd()
  ;($('gm-draft') as HTMLTextAreaElement).focus()
}

async function submitAdd() {
  if (ui.add === 'looking') return
  const apiKey = state.data.settings.apiKey
  const videoIds: string[] = []
  const playlistIds: string[] = []
  const badLines: number[] = []
  ui.draft.split('\n').forEach((line, i) => {
    for (const token of line.split(/[\s,]+/).filter(Boolean)) {
      const v = parseVideoId(token)
      const p = v ? null : parsePlaylistId(token)
      if (v) videoIds.push(v)
      else if (p) playlistIds.push(p)
      else if (!badLines.includes(i + 1)) badLines.push(i + 1)
    }
  })

  const errors: string[] = []
  if (!videoIds.length && !playlistIds.length && !badLines.length)
    errors.push(`<span class="err">Paste a YouTube link first.</span>`)
  if (badLines.length)
    errors.push(
      `<span class="err">${
        badLines.length === 1
          ? `Line ${badLines[0]} isn't a YouTube link.`
          : `Lines ${badLines.join(', ')} aren't YouTube links.`
      }</span>`,
    )
  if (playlistIds.length && !apiKey)
    errors.push(
      `<span class="muted"><span class="err">Playlists need a YouTube API key.</span> Add one in <a href="#" data-act="open-settings">Settings</a>, or paste the video links instead.</span>`,
    )
  if (errors.length) return addError(errors)

  const ch = currentChannel()
  const ids = [...new Set(videoIds)]
  ui.add = 'looking'
  ui.lookingLabel =
    'Looking up ' +
    [ids.length ? plural(ids.length, 'video') : '', playlistIds.length ? plural(playlistIds.length, 'playlist') : '']
      .filter(Boolean)
      .join(' and ') +
    '…'
  renderAdd()

  let metas: VideoMeta[] = []
  try {
    if (ids.length) metas = await window.api.fetchVideos(ids, apiKey)
    for (const p of playlistIds) metas.push(...(await window.api.fetchPlaylist(p, apiKey)))
  } catch (e) {
    ui.add = 'open'
    if (ch === currentChannel()) addError([`<span class="err">${esc((e as Error).message)}</span>`])
    return
  }

  const before = new Set(ch.videos.map((v) => v.id))
  const added = addVideos(ch, metas, now())
  const fresh = ch.videos.filter((v) => !before.has(v.id))
  const cant = fresh.filter((v) => v.status !== 'ok')
  const dupes = new Set(metas.map((m) => m.id)).size - added
  save()
  renderAll()
  if (ch !== currentChannel()) return

  const reasons = [...new Set(cant.map((v) => (v.reason ?? '').toLowerCase()))].filter(Boolean)
  ui.add = 'result'
  ui.draft = ''
  ui.addMsg =
    `<span class="strong">Added ${added - cant.length}</span>` +
    `<span class="muted">${dupes ? ` · ${dupes} already on this channel` : ''}${
      cant.length ? ` · ${cant.length} can’t air (${esc(reasons.join(', '))})` : ''
    }</span>`
  renderAdd()
}

// ---- Channel actions ------------------------------------------------------------------------

function commitRename() {
  if (!ui.renaming) return
  const input = document.getElementById('gm-rename') as HTMLInputElement | null
  const ch = currentChannel()
  if (input) ch.name = input.value.trim() || `Channel ${state.channelIndex + 1}`
  ui.renaming = false
  save()
  renderAll()
}

function cancelRename() {
  ui.renaming = false
  renderChannel()
}

function deleteChannel() {
  const chans = state.data.channels
  chans.splice(state.channelIndex, 1)
  if (chans.length === 0) chans.push(newChannel('Channel 1'))
  ui.confirmDelete = false
  save()
  hooks.changeChannel(Math.min(state.channelIndex, chans.length - 1))
}

function removeFromChannel(id: string) {
  removeVideo(currentChannel(), id, now())
  ui.confirmRemove = null
  save()
  renderAll()
}

// ---- Settings screen ------------------------------------------------------------------------

const TOGGLES = [
  { id: 'crt', name: 'CRT effect', desc: 'Scanlines, vignette and a faint flicker over the picture', key: '' },
  { id: 'showGuide', name: 'Program guide', desc: "What's on now and next on every channel, on the TV", key: 'G' },
  { id: 'captions', name: 'Captions', desc: "Uses the video's default track, or your system language", key: 'C' },
] as const

function renderSettings(t: number) {
  const s = state.data.settings
  put(el.ssClock, clockHtml(t))
  const airing = !!currentSlot(currentChannel().schedule, t)
  put(
    el.ssAiring,
    `<span class="live-dot${airing ? '' : ' off'}"></span>CH ${chNum(state.channelIndex)} ${airing ? 'STILL AIRING' : 'NO SIGNAL'}`,
  )
  put(
    el.ssToggles,
    TOGGLES.map((tg, i) => {
      const on = s[tg.id]
      return `<button class="tg${ui.focus === i ? ' focus' : ''}" data-act="toggle" data-i="${i}" aria-pressed="${on}">
        <span class="tg-text"><b>${tg.name}</b><small>${tg.desc}</small></span>
        <span class="tg-key${tg.key ? '' : ' none'}">${tg.key}</span>
        <span class="tg-switch"><span class="${on ? 'on' : ''}">ON</span><span class="${on ? '' : 'on'}">OFF</span></span>
      </button>`
    }).join(''),
  )
  renderKey()
}

function renderKey() {
  const k = ui.key
  put(
    el.keyStatus,
    `<span class="key-dot ${k}"></span>${{ idle: 'NOT CONNECTED', checking: 'CHECKING…', ok: 'CONNECTED', error: 'NOT CONNECTED' }[k]}`,
  )
  el.keySave.textContent = k === 'checking' ? 'CHECKING…' : k === 'ok' && el.keyInput.value === state.data.settings.apiKey ? 'SAVED' : 'SAVE KEY'
  el.keyInput.classList.toggle('bad', k === 'error')
  el.keyMsg.className = `key-msg ${k}`
  el.keyMsg.textContent = {
    idle: 'Without a key you can still paste video links. A key unlocks playlist import and more reliable titles and lengths.',
    checking: 'Checking the key with YouTube…',
    ok: 'Connected. You can now paste a playlist URL into any channel.',
    error: "YouTube didn't accept this key. Check it's copied in full and that YouTube Data API v3 is enabled for it.",
  }[k]
}

async function saveKey() {
  const draft = el.keyInput.value.trim()
  const s = state.data.settings
  if (!draft) {
    s.apiKey = ''
    ui.key = 'idle'
    save()
    renderKey()
    return
  }
  ui.key = 'checking'
  renderKey()
  const ok = await window.api.validateKey(draft)
  if (ok) {
    s.apiKey = draft
    save()
  }
  ui.key = ok ? 'ok' : 'error'
  renderKey()
}

function toggleSetting(i: number) {
  ui.focus = i
  const s = state.data.settings
  const id = TOGGLES[i].id
  s[id] = !s[id]
  save()
  hooks.applySettings()
  renderSettings(now())
}

export function openSettings(): void {
  ui.settingsOpen = true
  ui.focus = -1
  ui.key = state.data.settings.apiKey ? 'ok' : 'idle'
  el.keyInput.value = state.data.settings.apiKey
  rendered.delete(el.ssToggles)
  renderSettings(now())
  document.body.classList.add('settings-open')
  ;(document.activeElement as HTMLElement | null)?.blur()
}

function closeSettings() {
  ui.settingsOpen = false
  document.body.classList.remove('settings-open')
  ;(document.activeElement as HTMLElement | null)?.blur()
  renderAll()
}

export const isSettingsOpen = (): boolean => ui.settingsOpen

// ---- Public API -----------------------------------------------------------------------------

export function renderAll(): void {
  const t = now()
  renderNow(t)
  renderGrid(t)
  renderChannel()
  renderLibrary(t)
  renderAdd()
  if (ui.settingsOpen) renderSettings(t)
}

/** Called twice a second; cheap when nothing changed. */
export function tickGuide(): void {
  const t = now()
  renderNow(t)
  renderGrid(t)
  renderLibrary(t)
  if (ui.settingsOpen) renderSettings(t)
}

/** The TV switched channels: reset per-channel UI and show the new channel. */
export function onChannelChanged(): void {
  ui.renaming = false
  ui.confirmDelete = false
  ui.confirmRemove = null
  ui.cantOpen = false
  if (ui.add !== 'looking') {
    ui.add = currentChannel().videos.length ? 'closed' : 'open'
    ui.draft = ''
    ui.addMsg = ''
  }
  renderAll()
}

/**
 * Keys while the guide is showing. Returns false for keys the TV should still handle
 * (channel, volume, mute, captions).
 */
export function guideKey(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement
  const typing = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT'

  if (ui.settingsOpen) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeSettings()
    } else if (typing) {
      if (e.key === 'Enter' && target === el.keyInput) void saveKey()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const down = e.key === 'ArrowDown'
      // The first arrow press starts the highlight at the top (or bottom, going up).
      ui.focus =
        ui.focus < 0
          ? down ? 0 : TOGGLES.length - 1
          : Math.max(0, Math.min(TOGGLES.length - 1, ui.focus + (down ? 1 : -1)))
      renderSettings(now())
    } else if ((e.key === 'Enter' || e.key === ' ') && ui.focus >= 0) {
      e.preventDefault()
      toggleSetting(ui.focus)
    }
    return true
  }

  if (typing) {
    if (target.id === 'gm-rename') {
      if (e.key === 'Enter') commitRename()
      else if (e.key === 'Escape') cancelRename()
    } else if (target.id === 'gm-draft') {
      if (e.key === 'Escape') {
        target.blur()
        closeAdd()
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void submitAdd()
      }
    }
    return true
  }

  if (e.metaKey || e.ctrlKey) return true
  switch (e.key) {
    case 'Escape':
      // Esc only backs out of things in the guide; it never opens the TV.
      e.preventDefault()
      if (ui.confirmRemove || ui.confirmDelete) {
        ui.confirmRemove = null
        ui.confirmDelete = false
        renderAll()
      } else closeAdd()
      return true
    case 'f':
    case 'F':
      hooks.maximize(true)
      return true
    case 'Enter':
      e.preventDefault()
      hooks.maximize(false)
      return true
    case 'Tab':
      return true
  }
  return false
}

export function initGuide(h: GuideHooks): void {
  hooks = h

  const onClick = (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')
    if (!b || (b as HTMLButtonElement).disabled) return
    e.preventDefault()
    const act = b.dataset.act!
    if (act !== 'confirm-remove') ui.confirmRemove = null
    if (act !== 'confirm-delete') ui.confirmDelete = false
    switch (act) {
      case 'select-channel':
        hooks.changeChannel(Number(b.dataset.i))
        break
      case 'new-channel':
        state.data.channels.push(newChannel(`Channel ${state.data.channels.length + 1}`))
        save()
        hooks.changeChannel(state.data.channels.length - 1)
        openAdd()
        break
      case 'rename':
        ui.renaming = true
        renderChannel()
        break
      case 'delete-channel':
        ui.confirmDelete = true
        renderChannel()
        break
      case 'cancel-delete':
        renderChannel()
        break
      case 'confirm-delete':
        deleteChannel()
        break
      case 'remove':
        ui.confirmRemove = b.dataset.id!
        renderLibrary(now())
        break
      case 'confirm-remove':
        removeFromChannel(b.dataset.id!)
        break
      case 'toggle-cant':
        ui.cantOpen = !ui.cantOpen
        renderLibrary(now())
        break
      case 'open-add':
        openAdd()
        break
      case 'close-add':
        closeAdd()
        break
      case 'submit-add':
        void submitAdd()
        break
      case 'open-settings':
        openSettings()
        break
      case 'close-settings':
        closeSettings()
        break
      case 'toggle':
        toggleSetting(Number(b.dataset.i))
        break
      case 'save-key':
        void saveKey()
        break
    }
    renderChannel()
    renderLibrary(now())
  }
  // Clicking anywhere but a button cancels a pending "REMOVE?" / delete confirmation.
  document.addEventListener(
    'click',
    (e) => {
      if ((e.target as HTMLElement).closest('[data-act]')) return
      if (ui.confirmRemove || ui.confirmDelete) {
        ui.confirmRemove = null
        ui.confirmDelete = false
        renderAll()
      }
    },
    true,
  )
  el.gm.addEventListener('click', onClick)
  el.ss.addEventListener('click', onClick)
  // Clicking the settings background (anything but a control) drops the highlight.
  el.ss.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (ui.focus >= 0 && !t.closest('.tg, button, input, a')) {
      ui.focus = -1
      renderSettings(now())
    }
  })

  // Buttons shouldn't keep focus after a mouse click, so Enter keeps meaning "fill the window".
  for (const root of [el.gm, el.ss])
    root.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.preventDefault()
    })

  el.gm.addEventListener('input', (e) => {
    const t = e.target as HTMLElement
    if (t.id === 'gm-draft') {
      ui.draft = (t as HTMLTextAreaElement).value
      if (ui.add === 'error' || ui.add === 'result') {
        ui.add = 'open'
        ui.addMsg = ''
        const status = el.add.querySelector('.add-status')
        if (status) status.innerHTML = `<span class="hint">${isMac ? '⌘' : 'Ctrl'} Enter to add · Esc to close</span>`
        const close = el.add.querySelector('[data-act=close-add]')
        if (close) close.textContent = 'Cancel'
        rendered.delete(el.add)
      }
    }
  })
  el.gm.addEventListener('focusout', (e) => {
    if ((e.target as HTMLElement).id === 'gm-rename') commitRename()
  })
  el.keyInput.addEventListener('input', () => {
    if (ui.key !== 'checking') ui.key = 'idle'
    renderKey()
  })
}
