/** Adds [a, b] to a sorted list of disjoint ranges, merging overlaps. */
export function addRange(ranges: [number, number][], a: number, b: number): [number, number][] {
  if (b <= a) return ranges
  const out: [number, number][] = []
  let [s, e] = [a, b]
  let placed = false
  for (const [rs, re] of ranges) {
    if (re < s) out.push([rs, re])
    else if (rs > e) {
      if (!placed) {
        out.push([s, e])
        placed = true
      }
      out.push([rs, re])
    } else {
      s = Math.min(s, rs)
      e = Math.max(e, re)
    }
  }
  if (!placed) out.push([s, e])
  return out
}

export function watchedSeconds(ranges: [number, number][]): number {
  return ranges.reduce((sum, [s, e]) => sum + (e - s), 0)
}

export function watchedFraction(ranges: [number, number][], duration: number): number {
  return duration > 0 ? Math.min(1, watchedSeconds(ranges) / duration) : 0
}
