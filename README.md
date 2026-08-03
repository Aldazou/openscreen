> [!NOTE]
> Active development on [Aldazou/openscreen](https://github.com/Aldazou/openscreen). Expect sharp edges while we productize.

<p align="center">
  <img src="public/openscreen.png" alt="OpenScreen Logo" width="64" />
</p>

# <p align="center">OpenScreen</p>

<p align="center"><strong>Free, open-source Screen Studio alternative — local-first recording and editing.</strong></p>

Polish product demos and walkthroughs without a subscription or watermark. Record, edit, and export on your machine. MIT-licensed for personal and commercial use.

Based on the original open-source OpenScreen project (now archived upstream). This repo continues that work with a stronger capture → edit → finish loop.

> [!NOTE]
> No paid tiers, premium locks, or upsells.

<p align="center">
	<img src="public/demo.png" alt="" style="height: 0.2467; margin-right: 12px;" />
  <img src="public/sample.png" alt="" style="height: 0.2467; margin-right: 12px;" />
</p>

## Core Features
- Record a window, whole screen, or **drawn region**.
- Microphone + system audio, with remembered HUD presets (mic / system / webcam / countdown).
- Webcam overlay with picture-in-picture, drag-to-position, mirroring, and shape options.
- Auto or manual zooms with adjustable depth, duration, easing, and pixel-precise position; auto-zoom follows your cursor.
- Custom cursor size, smoothing, and click effects, with cursor themes and post-recording path smoothing (native macOS/Windows capture).
- **Privacy blur regions** in the editor and export.
- Automatic captions for voiceovers, generated on-device (works offline).
- Wallpapers, solid colors, gradients, or your own background image.
- Motion blur, crop, trim, and per-segment speed control.
- Text, arrow, and image annotations, with text animation presets.
- Recent projects / recordings home, plus drag-and-drop video import.
- Export to MP4 or GIF — then copy path or reveal in Finder/Explorer.
- **AI Director** (optional keys): image/video generation, TTS/music, avatar clips, media library, and a prompt-driven director to place assets on the timeline.
- Languages: Arabic, English, Spanish, French, Italian, Japanese, Korean, Portuguese (Brazil), Russian, Turkish, Vietnamese, Simplified Chinese, and Traditional Chinese.

## Installation

### Build from source (current)

```bash
git clone https://github.com/Aldazou/openscreen.git
cd openscreen
npm install
npm run dev
```

Packaged installers will land on the [Releases](https://github.com/Aldazou/openscreen/releases) page as builds are published.

> Closing the Electron window stops the app. Prefer `npm run typecheck` / tests while iterating if you don't want the always-on-top recording HUD over your desktop.

### Platform differences

Editor and export are the same on macOS, Windows, and Linux. Capture differs:

- **Native recording**: macOS (ScreenCaptureKit) and Windows (Windows Graphics Capture). Linux uses the browser capture pipeline.
- **Custom cursors**: full theme/click editing on macOS and Windows. On Linux only cursor position is captured (still powers auto-zoom); the Cursor panel explains why themes aren't available.
- **Webcam**: native on macOS/Windows; browser-based on Linux (still works as PiP).
- **System audio**:
  - **macOS**: requires macOS 13+ (14.2+ prompts for audio capture permission).
  - **Windows**: works out of the box.
  - **Linux**: needs PipeWire (Ubuntu 22.04+, Fedora 34+). PulseAudio-only setups may miss system audio.

---

## License

This project is licensed under the [MIT License](./LICENSE). By using this software, you agree that the authors are not liable for any issues, damages, or claims arising from its use.
