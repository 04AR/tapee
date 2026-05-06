# 📼 Tapee

**Tapee** is a powerful, privacy-first, client-side screen and camera recorder built as a Progressive Web App (PWA). It features real-time, AI-powered background removal and a highly customizable camera overlay.

![Tapee Interface](https://via.placeholder.com/800x450.png?text=Tapee+Screen+Recorder)

## ✨ Features

- 🎥 **Dual Recording**: Record your screen and camera simultaneously.
- 🤖 **AI Background Removal**: Real-time background cropping powered by local ML (`@mediapipe/selfie_segmentation`). Everything processes locally on your device for maximum privacy—no cloud processing required!
- 🎨 **Dynamic Camera UI**: 
  - Switch your camera feed between Circle, Rectangle, or "None" (transparent, floating silhouette).
  - Drag, drop, scale (10% to 100%), and freely rotate (360°) your camera overlay.
  - Strict bounding-box engine ensures your camera stays perfectly clipped within the recording frame.
- 🪟 **Global PiP Controls**: Pop out the camera and recording controls into a floating OS-level window using the Document Picture-in-Picture API. 
- 📱 **PWA Ready & Mobile Friendly**: Install Tapee natively on your Desktop, iOS, or Android device. Includes background audio/MediaSession hooks to let you pause/stop recordings straight from your phone's lock screen notification panel!
- ⚡ **Background-Throttling Proof**: Tapee uses an isolated Web Worker to drive its 30 FPS rendering engine, meaning your video won't freeze even if you bury the browser tab in the background.

## 🛠️ Technology Stack

- **Frontend**: React 18, TypeScript, Vite
- **Styling**: Vanilla CSS (Memphis/Neobrutalism design system)
- **AI/ML Engine**: Google MediaPipe Selfie Segmentation (WASM)
- **Video Processing**: HTML5 Canvas API + Web Workers + MediaRecorder API
- **PWA**: `vite-plugin-pwa` for Service Workers and Manifest generation

## 🚀 Local Development

1. **Clone the repository**
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Start the dev server**:
   ```bash
   npm run dev
   ```
4. **Build for production**:
   ```bash
   npm run build
   ```