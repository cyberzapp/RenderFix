# RenderFix (Video Frame Exporter - Pro)

RenderFix is a powerful desktop media editing application built with a modern React/Electron frontend and a FastAPI/PyTorch backend. It combines precise video frame extraction with a **Super Editor** that leverages state-of-the-art Generative AI models.

## ✨ Key Features
* **Video Frame Extraction:** Extract single frames or batch export video frames at specific FPS to ZIP. Export cropped video clips (MP4) or GIFs.
* **Super Editor:** An all-in-one image workspace for basic editing (Crop, Resize) and AI-driven enhancements.
* **AI Background Removal:** One-click background removal powered by U2-Net (`rembg`).
* **Studio Compositor (Generative AI):** 
  * **Auto-Masking:** Click to automatically mask objects using Facebook's Segment Anything Model (SAM).
  * **Style & Identity Transfer:** Add reference images (Faces or Styles) to bind to masks. Uses InsightFace and SDXL-Lightning IP-Adapter to flawlessly generate and composite reference features into your images.
  * **Global AI Edits:** Type a prompt without any references to perform smart global edits across the entire image using InstructPix2Pix.

---

> [!WARNING]
> **Hardware Requirements**
> Due to the advanced AI models (SDXL, SAM, InsightFace, InstructPix2Pix) running entirely locally for maximum privacy, this application is highly demanding.
> * **RAM:** At least **16GB** of system RAM (32GB+ highly recommended).
> * **GPU (Windows):** A decent NVIDIA Graphics Card with at least 8GB VRAM (CUDA support).
> * **GPU (Mac):** Apple Silicon (M1/M2/M3/M4) with Metal Performance Shaders (MPS) support.

---

## 🛠️ Installation Guide

### Prerequisites
1. **Node.js:** Ensure you have Node.js and npm installed.
2. **Python:** Python 3.10 to 3.12 is required.

### 🍎 macOS Setup (Apple Silicon)
Macs with Apple Silicon (M-series chips) natively accelerate the AI models using MPS (Metal Performance Shaders).

**1. Frontend Setup:**
```bash
cd frontend
npm install
```

**2. Backend Setup:**
Open a new terminal window:
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

**3. Install Mac-Optimized PyTorch:**
Install PyTorch customized for Apple Silicon:
```bash
pip install torch torchvision torchaudio
pip install diffusers transformers accelerate insightface onnxruntime
```

### 🪟 Windows Setup
Windows machines utilize NVIDIA GPUs via CUDA for AI acceleration.

**1. Frontend Setup:**
```cmd
cd frontend
npm install
```

**2. Backend Setup:**
Open a new terminal/command prompt:
```cmd
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

**3. Install Windows-Optimized PyTorch (CUDA):**
Install PyTorch with CUDA 11.8 (or your specific CUDA version):
```cmd
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
pip install diffusers transformers accelerate insightface onnxruntime-gpu
```

---

## 🚀 Running the App

Once both the frontend dependencies and the Python backend virtual environment are set up, you only need to run one command. The Electron wrapper will automatically start the Python backend server for you on port 8000!

```bash
cd frontend
npm run desktop
```

Enjoy editing with RenderFix!
