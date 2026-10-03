import { currentSlot, slotEnd, upcomingSlots } from '../shared/schedule.ts'
import type { Channel } from '../shared/types.ts'
import { chNum, esc, fmtClock } from './format.ts'

/** The program guide: what's on now and next on every channel. */
export function renderGuide(el: HTMLElement, channels: Channel[], active: number, now: number): void {
  const rows = channels.map((ch, i) => {
    const cur = currentSlot(ch.schedule, now)
    const next = upcomingSlots(ch.schedule, now).slice(0, 2)
    const pct = cur ? ((now - cur.start) / (cur.duration * 1000)) * 100 : 0
    const left = cur ? Math.ceil((slotEnd(cur) - now) / 60_000) : 0
    return `
      <div class="guide-row${i === active ? ' active' : ''}">
        <div class="guide-ch"><b>${chNum(i)}</b><span>${esc(ch.name)}</span></div>
        <div class="guide-now">
          ${
            cur
              ? `<div class="guide-title">${esc(cur.title)}</div>
                 <div class="guide-progress"><i style="width:${pct.toFixed(1)}%"></i></div>
                 <small>${left} min left</small>`
              : `<div class="guide-title dim">No signal</div>`
          }
        </div>
        ${next
          .map(
            (s) => `<div class="guide-next"><small>${fmtClock(s.start)}</small><div>${esc(s.title)}</div></div>`,
          )
          .join('')}
      </div>`
  })
  el.innerHTML = `<div class="guide-head"><span>PROGRAM GUIDE</span><span>${fmtClock(now)}</span></div>${rows.join('')}`
}
