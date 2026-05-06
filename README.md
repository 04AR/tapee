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

---

## 🌐 How to Host on GitHub Pages

Because Tapee processes video and loads WASM files for the AI engine, it **requires a secure context (HTTPS)**. GitHub Pages is perfect for this.

### Step 1: Update your Vite config
In your `vite.config.ts`, add a `base` property that matches your GitHub repository name. For example, if your repo is `https://github.com/your-username/tapee`, set the base to `'/tapee/'`:

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/tapee/', // ADD THIS LINE
  plugins: [react(), /* pwa plugins */]
})
```

### Step 2: Configure GitHub Actions
The easiest way to deploy a Vite app is via GitHub Actions.

1. In your GitHub repository, go to **Settings > Pages**.
2. Under **Build and deployment**, change the **Source** dropdown to **GitHub Actions**.
3. Create a new file in your local repository at `.github/workflows/deploy.yml` and paste the following:

```yaml
name: Deploy static content to Pages

on:
  push:
    branches: ['main'] # or master

# Sets permissions of the GITHUB_TOKEN to allow deployment to GitHub Pages
permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: 'pages'
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install dependencies
        run: npm install
      - name: Build
        run: npm run build
      - name: Setup Pages
        uses: actions/configure-pages@v4
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: './dist'
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### Step 3: Push to GitHub
Commit and push your changes to the `main` branch. 
```bash
git add .
git commit -m "Configure GitHub Pages deployment"
git push origin main
```

GitHub Actions will automatically build your app and deploy it. In a couple of minutes, your PWA will be live at `https://your-username.github.io/tapee/`!
