# Heartline Kit

A starter kit for desktop apps that react to your live **pulse** and **breathing rate**, read from an ordinary webcam with the [Presage SmartSpectra SDK](https://smartspectra.presagetech.com/docs). No wearable is needed. The SDK reads the tiny colour changes in your face that follow your heartbeat, and the movement of your chest as you breathe.

The kit includes two apps:

- **Scare Meter**: a playtest tool for horror scenes. It measures your resting pulse and breathing, plays a short scene, and shows which moments made your heart jump.
- **Calm Coach**: a paced-breathing coach that shows your breathing rate change as you follow it. *(Planned.)*

> Not a medical device. The readings are estimates for wellness and entertainment only. They are not a diagnosis, and you shouldn't use them to make health decisions.

## Status

| Part | State |
| --- | --- |
| Live vitals from the webcam (`kit/vitals`) | Working: pulse and breathing on a laptop webcam |
| Signal helpers: smoothing, baseline, change detection, hold-latest (`kit/signal`) | Working, with unit tests |
| Consent screen, calibration, camera preview and live readout | Working |
| Scare Meter scene, report and export | In progress |
| Calm Coach | Planned |

## What you need

- Windows 10/11 x64 (the only platform this kit is tested on)
- Node.js 20 or newer
- A webcam and steady light on your face
- A free Presage developer key from [physiology.presagetech.com](https://physiology.presagetech.com)
- Optional: a Google Gemini key for the written session summary. Without one, the app writes a plain offline summary.

## Setup

```bash
git clone https://github.com/zuhairhalawa/heartline-kit.git
cd heartline-kit
npm install
```

Copy `.env.example` to `.env` and fill in your keys. `.env` is git-ignored, so don't commit it.

```
PRESAGE_API_KEY=your_presage_key
GEMINI_API_KEY=            # optional
```

Then build and run:

```bash
npm run build
npm start
```

Sit about an arm's length from the camera with your face and upper chest in view, and keep still. The first pulse reading takes 20 to 40 seconds while the SDK warms up.

### If Electron doesn't start after `npm install`

On some Node versions, Electron's install script fails without an error. Running `npm start` then says Electron failed to install correctly. To fix it, unzip the Electron download that npm already cached:

```powershell
$zip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse -Filter "electron-v33.2.1-win32-x64.zip" | Select-Object -First 1
Expand-Archive $zip.FullName node_modules\electron\dist -Force
Set-Content node_modules\electron\path.txt "electron.exe" -NoNewline
```

## Demo mode (no camera)

To run without a camera, pass a recorded video of a face. The SDK reads it as if it were a live camera.

```bash
npm run demo -- path/to/face-video.webm
```

## Tests

```bash
npm run typecheck
npm test
```

## How it works

```
Electron main process                 Renderer (sandboxed)
  .env loading                          consent screen
  bindSmartSpectraIpc(win)  <── IPC ──> SmartSpectraSDK (camera MediaStream)
  Gemini call (key stays here)            │ metrics events, ~30 per second
  file export                             ▼
                                        decodeReading → holdLatest → baseline / change
                                          │
                                          ▼
                                        live readout, scene, report
```

- `kit/vitals` wraps the SDK. `RendererVitalsSource` starts the SDK on the camera stream, decodes each metrics event, and emits one `reading` with the latest pulse and breathing rate.
- The SDK sends a pulse rate about every 0.6 s and a breathing rate every 1 to 3 s, rarely in the same event. `holdLatest` keeps the newest value of each and drops it after 10 s without an update.
- `kit/signal` holds pure, tested functions for smoothing, a resting baseline, and change from baseline.
- `kit/consent`, `kit/ui` and `kit/ai` cover the consent screen, the live readout and sparklines, and the optional summary.

## Privacy and consent

- **Consent first.** Nothing turns on the camera until you agree on the first screen. A Stop button on every later screen turns the camera off at once.
- **Video stays on your computer.** The SmartSpectra SDK computes pulse and breathing on the device. According to Presage's documentation, raw video and face images are never sent anywhere. The app records nothing and saves no frames.
- **SDK telemetry.** By default the SDK sends Presage one small summary per session: the SDK version, platform, frame rates, error counts and how the session ended. Presage documents that this summary never contains video, measured values, or user or device identifiers ([Telemetry and Privacy](https://smartspectra.presagetech.com/docs/telemetry-and-privacy)). The SDK also needs an internet connection to check the API key.
- **Optional summary.** If you set a Gemini key, the report's written summary is created by sending the session's numbers to Google's Gemini API: pulse and breathing changes per scene moment, with no video and no name. Without a key, nothing is sent and the app writes the summary itself.
- **Your files.** Readings live in memory only. A report is saved only when you click Export and choose where to save it. Delete the file to delete the report.

## Built with Kiro

The specs, steering files and every prompt used to build this kit are in [`.kiro/`](.kiro):

- `.kiro/steering/`: product, tech, structure and SDK rules that Kiro follows
- `.kiro/specs/heartline-core/`: requirements, design and task list
- `.kiro/prompts/`: each prompt given to Kiro, in order

## Licence

[MIT](LICENSE)
