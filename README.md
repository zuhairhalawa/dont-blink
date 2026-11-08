# Don't Blink

A horror game you play with your eyes. Your webcam becomes a window into your own room, and something is standing in it. **It only moves when your eyes are closed.** Each time you blink it is closer, until it is right behind your shoulder.

Your blinks, pulse and breathing are read from an ordinary webcam by the [Presage SmartSpectra SDK](https://smartspectra.presagetech.com/docs). Your real heartbeat sets the heartbeat you hear. No wearable is needed.

> A game, not a medical device. The pulse and breathing numbers are estimates for fun. Expect flickering light and one sudden loud sound.

## How to play

1. Agree to the consent screen. On the get-ready screen, choose whether to **read your pulse and breathing** (on by default). With it on, sit back so your **shoulders and upper chest are in view**: Presage needs them for your pulse, and Begin unlocks once your pulse is read (usually about 20 seconds). With it off, only your blinks are read and you can start straight away.
2. Click **Begin** and look at the screen during the 3-second intro, while it learns how you sit.
3. Find the Watcher in your room, and survive 60 seconds:
   - Every blink lets it move one step closer.
   - Keep your eyes shut and it keeps coming, a step every 1.5 seconds. You'll hear it.
   - Turn your head away (more than about 25°) and it moves two steps.
   - Hold your stare for 8 seconds and it backs off a step.
4. At the end you get a card showing:
   - your pulse across the round, with every blink marked
   - your peak pulse, your longest stare, and how close it came
   - a photo of your room with the Watcher right behind you

   Save it as a PNG if you like.

Recording or streaming? Turn on **Hide my face** on the get-ready screen to appear as a silhouette.

## What reads what

| Signal | Source | Used for |
| --- | --- | --- |
| Blinks | Presage SmartSpectra (`face.blinking`) | Each blink onset moves the Watcher |
| Pulse rate | Presage (`cardio.pulseRate`) | Heartbeat sound, beating dot, end-card pulse curve, peak pulse and pulse rise |
| Breathing rate | Presage (`breathing.rate`) | Recorded for the round summary |
| Eyes held shut | MediaPipe Face Landmarker eye scores (on device) | Long closures, which Presage's blink detector doesn't report |
| Head direction | MediaPipe facial transformation matrix (on device) | Looking away |
| You vs. your room | MediaPipe selfie segmenter (on device) | Drawing the Watcher behind you |

Presage integration lives in [`kit/vitals/PresageSensor.ts`](kit/vitals/PresageSensor.ts) and [`kit/vitals/blinks.ts`](kit/vitals/blinks.ts). The renderer SDK runs on the camera stream; the main process calls `bindSmartSpectraIpc`.

### What testing on a laptop webcam showed

These measurements shaped the design:
- **Presage blink timing.** Each blink Presage reports lasts 130–180 ms, and the event arrives about 100–150 ms after the eyes close. In a cued test it caught every deliberate blink. Fast natural flutters can slip past, and a long eye closure is not reported as a blink. That's why MediaPipe's eye scores were added for eyes held shut: in one round they caught 19 closures, against 3 blinks from Presage.
- **Looking away.** Presage's validation status stayed on "chest not visible" even when the player left the frame, so it couldn't be used for looking away. Head direction comes from MediaPipe instead.
- **Framing for pulse.** Presage gave blinks but no pulse while it reported "chest not visible" (sitting close to a laptop). Sitting back so the shoulders were in view, the first pulse came at about 20 seconds. So with pulse on, the game waits for full framing and a first pulse before the round can start.
- **CPU headroom.** With full-screen canvas effects and MediaPipe running often, the SDK reported a processing failure about every 11 seconds and no pulse came through. Drawing at 30 fps on a 1280-px canvas and slowing the trackers fixed it. The occasional failure that remains is restarted automatically within about 2 seconds.
- **Partial readings.** Pulse and breathing rates arrive in separate SDK events, so the game keeps the latest of each (`kit/signal/holdLatest.ts`).
- **SDK errors.** Every SDK `error` is classified (`kit/vitals/errorPolicy.ts`). Fatal ones stop the camera and show a plain message; retryable ones are logged and play continues.

## Privacy and consent

- **Consent first.** The camera turns on only after you read the consent screen and click **Turn on the camera**. **Turn off the camera** stops it at any time, and so does closing the window.
- **Video stays on your computer.** Presage computes blinks, pulse and breathing on the device. MediaPipe runs on the device too. No frames are uploaded or saved.
- **What goes online.** Presage's SDK contacts Presage to check the API key. It can also send Presage an anonymous per-session usage summary (no video, no readings), but only if you tick the box on the consent screen. It's off by default.
- **Blocked usage report.** Google's MediaPipe library tries to send Google a usage report when it closes. The app's content security policy blocks it, so nothing is sent.
- **One photo, in memory only.** When the Watcher gets closest, the game takes one still of your room for the end card. It stays in memory with your blinks and pulse, and is gone when you close the game. Nothing is written to disk unless you click **Save image**.
- **Hide my face.** For recording or streaming, the get-ready screen has a **Hide my face** switch. It shows the player as a dark silhouette in everything the game draws (the end-card photo too) and blurs the framing preview, while blinks, pulse and head turns are still read from the clear camera. The silhouette comes from the person mask, so it covers the player whichever way they turn; until the mask is ready, the whole picture is blurred. An eye icon on the play screen shows each blink registering.
- **No other services.** No AI service, analytics or account is used at runtime.

## Setup

You need:
- Windows 10/11 x64 (the platform this was built and tested on)
- Node.js 20 or newer
- a webcam, with light on your face
- a free Presage developer key from [physiology.presagetech.com](https://physiology.presagetech.com)

```bash
git clone https://github.com/zuhairhalawa/dont-blink.git
cd dont-blink
npm install
```

Copy `.env.example` to `.env` and add your key:

```
PRESAGE_API_KEY=your_presage_key
```

Then build and run:

```bash
npm run build
npm start
```

With pulse reading on, sit back so your shoulders are in view; the first pulse takes about 20 seconds, and Begin waits for it.

### If Electron doesn't start after `npm install`

On some Node versions, Electron's install script fails without an error. To fix it, unzip the Electron download that npm already cached:

```powershell
$zip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse -Filter "electron-v33.2.1-win32-x64.zip" | Select-Object -First 1
Expand-Archive $zip.FullName node_modules\electron\dist -Force
Set-Content node_modules\electron\path.txt "electron.exe" -NoNewline
```

## Tests

```bash
npm run typecheck
npm test
```

The pure logic is unit-tested:
- game rules
- blink and eye-closure handling
- head-angle maths
- Watcher placement (perspective)
- chroma key
- SDK error policy
- round summary

`npm run probe` opens the blink-latency probe used to measure Presage's blink timing.

## Project layout

```
src/main/            Electron main process and preload (key hand-off, camera permission, CSP, save image)
src/renderer/        screens and the game loop
src/renderer/game/   rules, room renderer, Watcher placement and photos, sound, end card
kit/vitals/          Presage sensor, blink tracking, error policy, MediaPipe head and person tracking
kit/signal/          holding the latest pulse and breathing values
assets/models/       MediaPipe models (face landmarker, selfie segmenter)
assets/watcher-src/  Watcher artwork (green-screen poses, keyed at startup)
```

## Credits and licences

- **Code:** MIT ([LICENSE](LICENSE)).
- **Presage SmartSpectra SDK:** Presage Technologies, under its own licence.
- **MediaPipe Tasks Vision** and its models `face_landmarker.task` and `selfie_segmenter.tflite`: Google, Apache 2.0.
- **Watcher artwork:** created for this project.
- **Sound:** every sound is synthesised in code with the Web Audio API.
