import os
import cv2
import numpy as np
import tempfile
import io
import zipfile
from typing import List
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.responses import Response, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from moviepy import VideoFileClip
import math
from rembg import remove

app = FastAPI()

# Enable CORS for local React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def apply_inpainting(frame, x, y, w, h):
    """Applies content-aware fill (inpaint) to the specified region."""
    # Ensure coordinates are within bounds
    height, width = frame.shape[:2]
    x = max(0, min(int(x), width))
    y = max(0, min(int(y), height))
    w = max(0, min(int(w), width - x))
    h = max(0, min(int(h), height - y))

    if w == 0 or h == 0:
        return frame

    # Create a mask for inpainting
    mask = np.zeros(frame.shape[:2], dtype=np.uint8)
    mask[y:y+h, x:x+w] = 255

    # Slightly feather/expand the mask edges so the blending is smoother
    kernel = np.ones((5,5), np.uint8)
    mask = cv2.dilate(mask, kernel, iterations=1)

    # Apply inpainting (NS typically handles structural blending better for large patches)
    inpainted = cv2.inpaint(frame, mask, inpaintRadius=5, flags=cv2.INPAINT_NS)
    return inpainted

@app.post("/api/export/single")
async def export_single_frame(
    file: UploadFile = File(...),
    timestamp: float = Form(...),
    format: str = Form("image/png"),
    scale: float = Form(1.0),
    x: float = Form(None),
    y: float = Form(None),
    w: float = Form(None),
    h: float = Form(None)
):
    try:
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp_video:
            tmp_video.write(await file.read())
            tmp_video_path = tmp_video.name

        cap = cv2.VideoCapture(tmp_video_path)
        
        # Seek to frame number instead of timestamp for better reliability
        video_fps = cap.get(cv2.CAP_PROP_FPS)
        if video_fps <= 0:
            video_fps = 30.0 # fallback
        frame_number = int(timestamp * video_fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = cap.read()
        
        # If it still fails, try reading the very first frame as a fallback
        if not ret and frame_number > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ret, frame = cap.read()
        
        cap.release()
        os.remove(tmp_video_path)

        if not ret:
            return JSONResponse(status_code=400, content={"message": "Could not extract frame at given timestamp"})

        # Apply inpainting if coordinates provided
        if x is not None and y is not None and w is not None and h is not None:
            frame = apply_inpainting(frame, x, y, w, h)

        if scale > 1.0:
            new_w = int(frame.shape[1] * scale)
            new_h = int(frame.shape[0] * scale)
            frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)

        # Encode frame
        ext = '.jpg' if format == 'image/jpeg' else '.webp' if format == 'image/webp' else '.png'
        success, encoded_image = cv2.imencode(ext, frame)
        
        if not success:
            return JSONResponse(status_code=500, content={"message": "Failed to encode image"})

        return Response(content=encoded_image.tobytes(), media_type=format)

    except Exception as e:
        return JSONResponse(status_code=500, content={"message": str(e)})

@app.post("/api/export/multiple")
async def export_multiple(
    file: UploadFile = File(...),
    fps: float = Form(1.0),
    format: str = Form("image/png"),
    scale: float = Form(1.0),
    x: float = Form(None),
    y: float = Form(None),
    w: float = Form(None),
    h: float = Form(None),
    start_time: float = Form(None),
    end_time: float = Form(None),
    watermark_text: str = Form(None),
    watermark_position: str = Form("bottom-right")
):
    try:
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp_video:
            tmp_video.write(await file.read())
            tmp_video_path = tmp_video.name

        cap = cv2.VideoCapture(tmp_video_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        video_fps = cap.get(cv2.CAP_PROP_FPS)

        step = max(1, int(video_fps / fps))
        
        start_frame = 0
        end_frame = total_frames
        if start_time is not None and start_time >= 0:
            start_frame = int(start_time * video_fps)
        if end_time is not None and end_time > 0:
            end_frame = min(total_frames, int(end_time * video_fps))

        ext = 'jpg' if format == 'image/jpeg' else 'webp' if format == 'image/webp' else 'png'
        zip_buffer = io.BytesIO()
        
        with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
            for fn, i in enumerate(range(start_frame, end_frame, step)):
                cap.set(cv2.CAP_PROP_POS_FRAMES, i)
                ret, frame = cap.read()
                if not ret: break

                if x is not None and y is not None and w is not None and h is not None:
                    frame = apply_inpainting(frame, x, y, w, h)
                    
                if scale > 1.0:
                    new_w = int(frame.shape[1] * scale)
                    new_h = int(frame.shape[0] * scale)
                    frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
                    
                if watermark_text:
                    font = cv2.FONT_HERSHEY_SIMPLEX
                    font_scale = max(0.5, 1.0 * scale)
                    thickness = max(1, int(2 * scale))
                    text_size = cv2.getTextSize(watermark_text, font, font_scale, thickness)[0]
                    
                    if watermark_position == 'bottom-right':
                        text_x = frame.shape[1] - text_size[0] - 10
                        text_y = frame.shape[0] - 10
                    elif watermark_position == 'top-left':
                        text_x = 10
                        text_y = text_size[1] + 10
                    elif watermark_position == 'top-right':
                        text_x = frame.shape[1] - text_size[0] - 10
                        text_y = text_size[1] + 10
                    elif watermark_position == 'bottom-left':
                        text_x = 10
                        text_y = frame.shape[0] - 10
                    else: # center
                        text_x = (frame.shape[1] - text_size[0]) // 2
                        text_y = (frame.shape[0] + text_size[1]) // 2
                        
                    cv2.putText(frame, watermark_text, (text_x, text_y), font, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)
                
                # Encode and add to zip
                success, encoded_image = cv2.imencode(f'.{ext}', frame)
                if success:
                    ts = i / video_fps if video_fps > 0 else 0
                    ts_str = f"{ts:.2f}".replace('.', '_')
                    frame_name = f"frame_{str(fn+1).zfill(4)}_{ts_str}s.{ext}"
                    zip_file.writestr(frame_name, encoded_image.tobytes())

        cap.release()
        os.remove(tmp_video_path)

        zip_buffer.seek(0)
        return Response(
            content=zip_buffer.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=video_frames.zip"}
        )

    except Exception as e:
        return JSONResponse(status_code=500, content={"message": str(e)})

from fastapi import BackgroundTasks

@app.post("/api/export/video")
async def export_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    scale: float = Form(1.0),
    x: float = Form(None),
    y: float = Form(None),
    w: float = Form(None),
    h: float = Form(None),
    start_time: float = Form(None),
    end_time: float = Form(None),
    watermark_text: str = Form(None),
    watermark_position: str = Form("bottom-right"),
    format: str = Form("video/mp4")
):
    try:

        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp_in:
            tmp_in.write(await file.read())
            tmp_in_path = tmp_in.name

        ext = ".gif" if format == "image/gif" else ".mp4"
        out_path = tempfile.mktemp(suffix=ext)

        clip = VideoFileClip(tmp_in_path)
        
        # Apply trimming if provided
        if start_time is not None or end_time is not None:
            st = max(0, start_time or 0)
            et = min(clip.duration, end_time or clip.duration)
            clip = clip.subclip(st, et)
        
        def process_frame(frame):
            bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
            if x is not None and y is not None and w is not None and h is not None:
                bgr = apply_inpainting(bgr, x, y, w, h)
                
            if scale > 1.0:
                new_w = int(bgr.shape[1] * scale)
                new_h = int(bgr.shape[0] * scale)
                bgr = cv2.resize(bgr, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
                
            if watermark_text:
                font = cv2.FONT_HERSHEY_SIMPLEX
                font_scale = max(0.5, 1.0 * scale)
                thickness = max(1, int(2 * scale))
                text_size = cv2.getTextSize(watermark_text, font, font_scale, thickness)[0]
                
                if watermark_position == 'bottom-right':
                    text_x = bgr.shape[1] - text_size[0] - 10
                    text_y = bgr.shape[0] - 10
                elif watermark_position == 'top-left':
                    text_x = 10
                    text_y = text_size[1] + 10
                elif watermark_position == 'top-right':
                    text_x = bgr.shape[1] - text_size[0] - 10
                    text_y = text_size[1] + 10
                elif watermark_position == 'bottom-left':
                    text_x = 10
                    text_y = bgr.shape[0] - 10
                else: # center
                    text_x = (bgr.shape[1] - text_size[0]) // 2
                    text_y = (bgr.shape[0] + text_size[1]) // 2
                    
                cv2.putText(bgr, watermark_text, (text_x, text_y), font, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)
                
            return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            
        new_clip = clip.image_transform(process_frame)
        
        if format == "image/gif":
            new_clip.write_gif(out_path, logger=None, fps=15)
        else:
            new_clip.write_videofile(out_path, codec="libx264", audio_codec="aac", logger=None)
        
        clip.close()
        new_clip.close()

        def cleanup():
            try:
                if os.path.exists(tmp_in_path): os.remove(tmp_in_path)
                if os.path.exists(out_path): os.remove(out_path)
            except Exception:
                pass
                
        background_tasks.add_task(cleanup)

        filename = "cleaned_video.mp4" if format == "video/mp4" else "exported.gif"
        return FileResponse(out_path, media_type=format, filename=filename)

    except Exception as e:
        return JSONResponse(status_code=500, content={"message": str(e)})

import fitz

def parse_pages(page_str, total_pages):
    if not page_str or page_str.lower() == "all":
        return list(range(total_pages))
    pages = set()
    for part in page_str.split(','):
        part = part.strip()
        if '-' in part:
            try:
                start, end = part.split('-')
                start = max(1, int(start))
                end = min(total_pages, int(end))
                if start <= end:
                    pages.update(range(start - 1, end))
            except ValueError:
                pass
        else:
            try:
                page = int(part)
                if 1 <= page <= total_pages:
                    pages.add(page - 1)
            except ValueError:
                pass
    return sorted(list(pages))

def apply_rembg(img):
    if img.shape[2] == 3:
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    else:
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGRA2RGBA)
    img_rgba = remove(img_rgb)
    return cv2.cvtColor(img_rgba, cv2.COLOR_RGBA2BGRA)

def encode_with_target_size(img, ext, format, target_bytes, quality):
    if format == 'image/png' or target_bytes is None or target_bytes <= 0:
        encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), quality] if format == 'image/jpeg' else []
        if format == 'image/webp': encode_param = [int(cv2.IMWRITE_WEBP_QUALITY), quality]
        success, encoded = cv2.imencode(ext, img, encode_param)
        return success, encoded
        
    min_q = 1
    max_q = 100
    best_encoded = None
    best_size_diff = float('inf')
    
    for _ in range(7):
        mid_q = (min_q + max_q) // 2
        encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), mid_q] if format == 'image/jpeg' else [int(cv2.IMWRITE_WEBP_QUALITY), mid_q]
        success, encoded = cv2.imencode(ext, img, encode_param)
        if not success:
            break
            
        size = len(encoded)
        if size <= target_bytes:
            diff = target_bytes - size
            if diff < best_size_diff:
                best_size_diff = diff
                best_encoded = encoded
            min_q = mid_q + 1
        else:
            max_q = mid_q - 1
            
    if best_encoded is not None:
        return True, best_encoded
        
    encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 1] if format == 'image/jpeg' else [int(cv2.IMWRITE_WEBP_QUALITY), 1]
    return cv2.imencode(ext, img, encode_param)

@app.post("/api/image/process")
async def process_image(
    files: List[UploadFile] = File(...),
    format: str = Form("image/png"),
    scale: float = Form(1.0),
    target_w: int = Form(None),
    target_h: int = Form(None),
    quality: int = Form(100),
    target_bytes: int = Form(None),
    pages: str = Form("all"),
    crop_x: int = Form(None),
    crop_y: int = Form(None),
    crop_w: int = Form(None),
    crop_h: int = Form(None),
    remove_bg: bool = Form(False)
):
    try:
        if remove_bg and format == 'image/jpeg':
            format = 'image/png'
        ext = '.jpg' if format == 'image/jpeg' else '.webp' if format == 'image/webp' else '.png'
        
        # If there's only one file and it's not a multi-page PDF request
        if len(files) == 1:
            file = files[0]
            content = await file.read()
            filename = file.filename.lower()
            
            if filename.endswith(".pdf"):
                doc = fitz.open(stream=content, filetype="pdf")
                total_pages = len(doc)
                target_pages = parse_pages(pages, total_pages)
                
                if not target_pages:
                    return JSONResponse(status_code=400, content={"message": "No valid pages selected"})
                    
                if len(target_pages) == 1:
                    page = doc.load_page(target_pages[0])
                    if target_w is not None and target_h is not None and target_w > 0 and target_h > 0:
                        scale_x = target_w / page.rect.width
                        scale_y = target_h / page.rect.height
                        zoom_matrix = fitz.Matrix(scale_x, scale_y)
                    else:
                        zoom_matrix = fitz.Matrix(2.0 * scale, 2.0 * scale)
                    
                    pix = page.get_pixmap(matrix=zoom_matrix)
                    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                    if pix.n == 4:
                        img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGRA)
                    else:
                        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
                        
                    if remove_bg:
                        img = apply_rembg(img)
                        
                    # Apply cropping if provided (only for single page/image)
                    if crop_w and crop_h:
                        x = max(0, int(crop_x or 0))
                        y = max(0, int(crop_y or 0))
                        img = img[y:y+int(crop_h), x:x+int(crop_w)]
                        
                    success, encoded = encode_with_target_size(img, ext, format, target_bytes, quality)
                    if not success:
                        return JSONResponse(status_code=500, content={"message": "Failed to encode image"})
                    return Response(content=encoded.tobytes(), media_type=format)
                
                # Multi-page PDF Zip logic
                zip_buffer = io.BytesIO()
                with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
                    for p_num in target_pages:
                        page = doc.load_page(p_num)
                        if target_w is not None and target_h is not None and target_w > 0 and target_h > 0:
                            scale_x = target_w / page.rect.width
                            scale_y = target_h / page.rect.height
                            zoom_matrix = fitz.Matrix(scale_x, scale_y)
                        else:
                            zoom_matrix = fitz.Matrix(2.0 * scale, 2.0 * scale)
                            
                        pix = page.get_pixmap(matrix=zoom_matrix)
                        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                        if pix.n == 4:
                            img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGRA)
                        else:
                            img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
                            
                        if remove_bg:
                            img = apply_rembg(img)
                        
                        success, encoded = encode_with_target_size(img, ext, format, target_bytes, quality)
                        if success:
                            zip_file.writestr(f"page_{p_num+1}{ext}", encoded.tobytes())
                
                zip_buffer.seek(0)
                return Response(
                    content=zip_buffer.getvalue(),
                    media_type="application/zip",
                    headers={"Content-Disposition": "attachment; filename=pdf_images.zip"}
                )
                
            else:
                # Single Image processing
                img_array = np.frombuffer(content, np.uint8)
                img = cv2.imdecode(img_array, cv2.IMREAD_UNCHANGED)
                if img is None:
                    return JSONResponse(status_code=400, content={"message": "Could not read image file"})
                    
                if remove_bg:
                    img = apply_rembg(img)
                    
                # Apply cropping first
                if crop_w and crop_h:
                    x = max(0, int(crop_x or 0))
                    y = max(0, int(crop_y or 0))
                    img = img[y:y+int(crop_h), x:x+int(crop_w)]
                    
                # Then resize
                if target_w is not None and target_h is not None and target_w > 0 and target_h > 0:
                    img = cv2.resize(img, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
                elif scale != 1.0:
                    new_w = int(img.shape[1] * scale)
                    new_h = int(img.shape[0] * scale)
                    img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
                    
                success, encoded = encode_with_target_size(img, ext, format, target_bytes, quality)
                if not success:
                    return JSONResponse(status_code=500, content={"message": "Failed to encode image"})
                    
                return Response(content=encoded.tobytes(), media_type=format)
                
        # Handle multiple files (Batch Processing) -> always zip
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
            for idx, file in enumerate(files):
                content = await file.read()
                filename = file.filename.lower()
                
                if filename.endswith(".pdf"):
                    # For batches, we extract all pages of all pdfs
                    doc = fitz.open(stream=content, filetype="pdf")
                    for p_num in range(len(doc)):
                        page = doc.load_page(p_num)
                        if target_w is not None and target_h is not None and target_w > 0 and target_h > 0:
                            scale_x = target_w / page.rect.width
                            scale_y = target_h / page.rect.height
                            zoom_matrix = fitz.Matrix(scale_x, scale_y)
                        else:
                            zoom_matrix = fitz.Matrix(2.0 * scale, 2.0 * scale)
                        pix = page.get_pixmap(matrix=zoom_matrix)
                        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                        if pix.n == 4:
                            img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGRA)
                        else:
                            img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
                            
                        if remove_bg:
                            img = apply_rembg(img)
                            
                        success, encoded = encode_with_target_size(img, ext, format, target_bytes, quality)
                        if success:
                            zip_file.writestr(f"file_{idx+1}_page_{p_num+1}{ext}", encoded.tobytes())
                else:
                    img_array = np.frombuffer(content, np.uint8)
                    img = cv2.imdecode(img_array, cv2.IMREAD_UNCHANGED)
                    if img is not None:
                        if remove_bg:
                            img = apply_rembg(img)
                            
                        if target_w is not None and target_h is not None and target_w > 0 and target_h > 0:
                            img = cv2.resize(img, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
                        elif scale != 1.0:
                            new_w = int(img.shape[1] * scale)
                            new_h = int(img.shape[0] * scale)
                            img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
                            
                        success, encoded = encode_with_target_size(img, ext, format, target_bytes, quality)
                        if success:
                            base_name = os.path.splitext(file.filename)[0]
                            zip_file.writestr(f"{base_name}_processed{ext}", encoded.tobytes())
                            
        zip_buffer.seek(0)
        return Response(
            content=zip_buffer.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=batch_processed.zip"}
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"message": str(e)})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
