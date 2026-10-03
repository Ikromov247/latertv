import { addVideos, currentSlot, removeVideo, upcomingSlots } from '../shared/schedule.ts'
import { WATCHED_THRESHOLD, type Channel, type Video, type VideoMeta } from '../shared/types.ts'
import { watchedFraction } from '../shared/watched.ts'
import { parsePlaylistId, parseVideoId } from '../shared/youtube.ts'
import { chNum, esc, fmtClock, fmtDuration } from './format.ts'
import { newChannel, now, save, state } from './state.ts'

export interface MenuHooks {
  onClose(): void
  /** Channels or settings changed in a way the TV screen should pick up. */
  onChange(): void
}

const menu = document.getElementById('menu')!
const list = document.getElementById('channel-list')!
const editor = document.getElementById('channel-editor')!

let hooks: MenuHooks
let editing = 0
let busy = false
let status = ''

export const isMenuOpen = (): boolean => !menu.hidden

export function openMenu(): void {
  editing = state.channelIndex
  status = ''
  showTab('channels')
  render()
  menu.hidden = false
}

export function closeMenu(): void {
  menu.hidden = true
  hooks.onClose()
}

function showTab(tab: string) {
  for (const b of menu.querySelectorAll<HTMLElement>('[data-tab]'))
    b.classList.toggle('active', b.dataset.tab === tab)
  for (const s of menu.querySelectorAll<HTMLElement>('.tab'))
    s.hidden = s.id !== `tab-${tab}`
  if (tab === 'settings') renderSettings()
}

function render() {
  const chans = state.data.channels
  editing = Math.min(editing, chans.length - 1)
  list.innerHTML =
    chans
      .map(
        (ch, i) => `
      <button class="ch-item${i === editing ? ' active' : ''}" data-edit="${i}">
        <b>${chNum(i)}</b><span>${esc(ch.name)}</span><small>${ch.videos.length}</small>
      </button>`,
      )
      .join('') + `<button class="ch-add" data-action="new-channel">+ New channel</button>`
  renderEditor(chans[editing])
}

function videoState(ch: Channel, v: Video, t: number): string {
  if (v.status === 'unavailable') return `<span class="bad">Unavailable: ${esc(v.reason ?? '')}</span>`
  if (currentSlot(ch.schedule, t)?.videoId === v.id) return `<span class="live">● On air</span>`
  const next = upcomingSlots(ch.schedule, t).find((s) => s.videoId === v.id)
  return next ? `Next airs ${fmtClock(next.start)}` : 'In rotation'
}

function renderEditor(ch: Channel) {
  const t = now()
  const hasKey = !!state.data.settings.apiKey
  const videos = [...ch.videos].sort((a, b) => b.addedAt - a.addedAt)
  editor.innerHTML = `
    <div class="editor-head">
      <input id="ch-name" value="${esc(ch.name)}" maxlength="40" aria-label="Channel name" />
      <button class="danger" data-action="delete-channel">Delete channel</button>
    </div>

    <div class="add-box">
      <label for="add-links">Add videos</label>
      <textarea id="add-links" rows="3" placeholder="Paste YouTube links, one per line"></textarea>
      <div class="row">
        <input id="pl-url" placeholder="…or a playlist URL" ${hasKey ? '' : 'disabled'} />
        <button data-action="import" ${hasKey ? '' : 'disabled'}>Import playlist</button>
        <button class="primary" data-action="add">Add links</button>
      </div>
      ${hasKey ? '' : `<small>Playlist import needs a YouTube Data API key — add one in Settings.</small>`}
      <p class="status">${esc(status)}</p>
    </div>

    <h3>${videos.length} video${videos.length === 1 ? '' : 's'}
      <small>removed automatically after ${Math.round(WATCHED_THRESHOLD * 100)}% watched</small></h3>
    <ul class="videos">
      ${videos
        .map((v) => {
          const pct = Math.round(watchedFraction(v.watched, v.duration) * 100)
          return `
        <li class="${v.status}">
          <img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" alt="" loading="lazy" />
          <div class="info">
            <b title="${esc(v.title)}">${esc(v.title)}</b>
            <div class="meta">
              <span>${fmtDuration(v.duration)}</span>
              <span class="watch"><i style="width:${(pct / (WATCHED_THRESHOLD * 100)) * 100}%"></i></span>
              <span>${pct}% watched</span>
              <span>${videoState(ch, v, t)}</span>
            </div>
          </div>
          <button data-remove="${v.id}">Remove</button>
        </li>`
        })
        .join('')}
    </ul>
    ${videos.length ? '' : `<p class="empty">This channel has nothing to air yet. Paste some links above.</p>`}`
  setBusy(busy)
}

function setBusy(on: boolean) {
  busy = on
  const hasKey = !!state.data.settings.apiKey
  for (const b of editor.querySelectorAll<HTMLButtonElement>('button[data-action], button[data-remove]'))
    b.disabled = on || (b.dataset.action === 'import' && !hasKey)
}

function setStatus(msg: string) {
  status = msg
  const el = editor.querySelector('.status')
  if (el) el.textContent = msg
}

async function addFromMetas(ch: Channel, fetchMetas: () => Promise<VideoMeta[]>) {
  setBusy(true)
  setStatus('Looking up videos…')
  try {
    const metas = await fetchMetas()
    const added = addVideos(ch, metas, now())
    const bad = metas.filter((m) => m.error || !m.embeddable).length
    const dupes = metas.length - added
    status =
      `Added ${added} video${added === 1 ? '' : 's'}` +
      (dupes ? `, ${dupes} already on this channel` : '') +
      (bad ? `, ${bad} can't be aired (see below)` : '') +
      '.'
    save()
    hooks.onChange()
    busy = false
    render()
  } catch (e) {
    // Keep whatever was pasted so it can be retried.
    setStatus((e as Error).message)
  } finally {
    setBusy(false)
  }
}

function addLinks() {
  const ch = state.data.channels[editing]
  const text = (editor.querySelector('#add-links') as HTMLTextAreaElement).value
  const tokens = text.split(/[\s,]+/).filter(Boolean)
  const ids = [...new Set(tokens.map(parseVideoId).filter((x): x is string => !!x))]
  if (!ids.length) {
    setStatus(tokens.length ? "Couldn't find any YouTube video links in that." : 'Paste a link first.')
    return
  }
  void addFromMetas(ch, () => window.api.fetchVideos(ids, state.data.settings.apiKey))
}

function importPlaylist() {
  const ch = state.data.channels[editing]
  const input = (editor.querySelector('#pl-url') as HTMLInputElement).value
  const id = parsePlaylistId(input)
  if (!id) {
    setStatus("That doesn't look like a playlist link.")
    return
  }
  void addFromMetas(ch, () => window.api.fetchPlaylist(id, state.data.settings.apiKey))
}

function renderSettings() {
  const s = state.data.settings
  ;(document.getElementById('set-key') as HTMLInputElement).value = s.apiKey
  ;(document.getElementById('set-guide') as HTMLInputElement).checked = s.showGuide
  ;(document.getElementById('set-crt') as HTMLInputElement).checked = s.crt
}

export function initMenu(h: MenuHooks): void {
  hooks = h

  menu.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLButtonElement>('button')
    if (!el || el.disabled) return
    const chans = state.data.channels
    if (el.dataset.tab) showTab(el.dataset.tab)
    else if (el.dataset.edit) {
      editing = Number(el.dataset.edit)
      status = ''
      render()
    } else if (el.dataset.remove) {
      const ch = chans[editing]
      const v = ch.videos.find((x) => x.id === el.dataset.remove)
      if (v && confirm(`Remove "${v.title}" from ${ch.name}?`)) {
        removeVideo(ch, v.id, now())
        save()
        hooks.onChange()
        render()
      }
    } else
      switch (el.dataset.action) {
        case 'close':
          closeMenu()
          break
        case 'new-channel':
          chans.push(newChannel(`Channel ${chans.length + 1}`))
          editing = chans.length - 1
          status = ''
          save()
          hooks.onChange()
          render()
          break
        case 'delete-channel': {
          const ch = chans[editing]
          if (!confirm(`Delete ${ch.name} and its ${ch.videos.length} videos?`)) break
          chans.splice(editing, 1)
          if (chans.length === 0) chans.push(newChannel('Channel 1'))
          if (state.channelIndex >= chans.length) state.channelIndex = chans.length - 1
          save()
          hooks.onChange()
          render()
          break
        }
        case 'add':
          addLinks()
          break
        case 'import':
          importPlaylist()
          break
      }
  })

  menu.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement
    const s = state.data.settings
    if (el.id === 'ch-name') {
      state.data.channels[editing].name = el.value.trim() || `Channel ${editing + 1}`
      render()
    } else if (el.id === 'set-key') s.apiKey = el.value.trim()
    else if (el.id === 'set-guide') s.showGuide = el.checked
    else if (el.id === 'set-crt') s.crt = el.checked
    else return
    save()
    hooks.onChange()
  })

  menu.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement
    if (el.id === 'add-links' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addLinks()
    if (el.id === 'pl-url' && e.key === 'Enter') importPlaylist()
  })
}
