# Random TV

Have too many videos on your watch later playlist? Add them here to create a personalized TV channel. Tune in anytime to start watching a random video at a random point to simulate the experience of tuning mid-movie! 

How it works:
- Add links to youtube videos
- Start watching the 'broadcast'
- Once you watch enough of a video, it is removed from your list.

Simple! 

## Spec

### Platform
- Electron + Vite + TypeScript desktop app.
- YouTube IFrame Player API for playback. The renderer is always served from a local `http://` origin (never `file://`) so embeds work.
- All data (channels, videos, schedules, watch progress, settings) is stored locally as JSON in the app's user-data folder.

### Content
- Multiple channels, each with its own video collection.
- Add videos by pasting one or more YouTube links, or by importing a playlist URL (requires the user's own YouTube Data API key, set in Settings).
- Titles/durations come from the Data API when a key is set, otherwise from the public watch page.
- Videos can be removed manually only from the content menu, never from the watching screen.
- A video is removed automatically once 70% of its runtime has actually been watched (unique seconds, accumulated across tune-ins).
- Videos that can't be embedded or no longer exist are flagged in the content menu and dropped from the schedule.

### Broadcast
- Each channel has a live schedule tied to the wall clock. It keeps "airing" while the app is closed; tuning in drops you wherever the channel is right now, mid-video.
- No skipping, pausing, or seeking. YouTube controls and keyboard shortcuts are disabled, a click-blocking overlay covers the player, and playback that drifts from the schedule snaps back to the live position.
- The schedule is planned a few hours ahead. What's airing now and everything before it is locked.
- **Removing a video:** its future slots are dropped and all later broadcasts slide earlier to close the gap (same order, no reshuffle). The freed time at the end of the schedule is filled with new videos from the collection.
- **Adding a video:** it goes into the pool used to fill the end of the schedule, preferred over videos that have already aired.
- Live streams and upcoming premieres can't be scheduled (no fixed length); they're flagged as unavailable. Finished streams air like normal videos, up to 12 hours long.
- YouTube's own ads can't be controlled and may still play.

### Controls
- Volume / mute.
- Captions on/off (off by default, remembered).
- Channel up / down, with a static transition.
- Fullscreen.
- Program guide (now / next per channel), can be turned on/off in Settings.
- Retro CRT effect (scanlines, vignette, channel number OSD), can be turned on/off in Settings.

## Development
```sh
npm install
npm run dev        # run with hot reload
npm run build && npm start   # run the production build
npm test           # schedule / parsing unit tests
npm run typecheck
```
Keys on the TV screen: ↑/↓ channel, 1–9 jump to channel, ←/→ volume, M mute, C captions, F fullscreen, G guide, Esc menu.
