# FrameX Project Knowledge Base

This document serves as the project's memory and setup guide, ensuring that all context, architecture, and current features are perfectly preserved when migrating to your Mac or picking up development in the future.

## 1. Project Architecture

FrameX is a desktop media editing app using an Electron wrapper, a React/Vite frontend, and a FastAPI Python backend.

- **Frontend (`/frontend`)**: 
  - **Framework**: React, Vite, TailwindCSS.
  - **Desktop Wrapper**: Electron (`main.cjs`). It spawns the Python backend silently on startup and forcefully kills it on close to prevent zombie processes on port 8000.
  - **Key Features**: 
    - Video playback with precise cropping (watermark removal).
    - Single frame export, Batch frame export (to ZIP).
    - Full video export (MP4/GIF).
    - Advanced Image/PDF tools.
    - AI Background Removal (U2-Net) toggle.
    - **Compare Slider**: Rich UI to slide between original and processed images.
    - **Refine Workspace**: A canvas-based smart brush tool to draw masks, erase/restore areas, and input Generative AI prompts.

- **Backend (`/backend`)**:
  - **Framework**: FastAPI, Python.
  - **Core Libraries**: `moviepy`, `opencv-python-headless`, `pymupdf` (fitz), `rembg` (U2-Net for bg removal).
  - **API Routes**:
    - `POST /api/export/single`: Export a single frame from video (with optional cropping).
    - `POST /api/export/multiple`: Export batch video frames at specific FPS to ZIP.
    - `POST /api/export/video`: Export a cropped video clip (mp4) or GIF.
    - `POST /api/image/process`: Process images and PDFs (convert to PNG/WEBP, apply background removal).
  - **Generative AI Roadmap**: The backend is prepped to integrate `diffusers` (Stable Diffusion) for the `/api/image/inpaint` endpoint to support the new Refine Workspace.

---

## 2. macOS Setup Guide

Since you are switching to a Mac (specifically Apple Silicon like M1/M2/M3), the setup is significantly cleaner and faster, especially for the upcoming AI features, because PyTorch natively supports the Mac GPU via Metal Performance Shaders (MPS).

### Step 1: Transfer the Code
Copy the entire `video-frame-exporter` folder to your Mac (via external drive, cloud, or GitHub).

### Step 2: Install Node Dependencies
Open your Mac terminal, navigate to the frontend folder, and install the Node packages:
```bash
cd path/to/video-frame-exporter/frontend
npm install
```

### Step 3: Setup the Python Backend (Mac Native)
You will need Python installed on your Mac (preferably Python 3.10 to 3.12). macOS usually comes with Python3.
Navigate to the backend folder and create a fresh virtual environment:
```bash
cd ../backend
python3 -m venv .venv
source .venv/bin/activate
```

Install the core backend requirements:
```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### Step 4: Install Mac-Optimized PyTorch (For Generative AI)
Instead of CUDA, you will install the native Mac version of PyTorch which utilizes your Apple Silicon GPU (MPS) automatically!
```bash
pip install torch torchvision torchaudio
pip install diffusers transformers accelerate
```

### Step 5: Run the App
Once everything is installed, go back to the frontend directory and launch the app. The Electron wrapper will automatically start the Python server on port 8000 just like on Windows!
```bash
cd ../frontend
npm run desktop
```

---

## 3. Current State & Next Steps

**What's Done:**
- The entire frontend UI is perfectly polished, including the Compare Slider, the Refine Canvas tool, the batch exporting mechanisms, and the background removal logic.
- The `rembg` U2-Net background removal works flawlessly.

**What's Pending (The Next Prompt):**
- When you are set up on your Mac, we need to implement the Python logic for the **Stable Diffusion Inpainting API** (`/api/image/inpaint`). 
- We will wire the frontend `RefineModal.jsx` to send the drawn canvas mask and the text prompt to this new backend endpoint.
