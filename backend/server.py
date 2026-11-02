import os
import cv2
import numpy as np
import base64
import tempfile
import io
import zipfile
import shutil
import subprocess
import asyncio
from typing import List
from pathlib import Path
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.responses import Response, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from moviepy import VideoFileClip
import math
from rembg import remove
import torch
from diffusers import StableDiffusionInpaintPipeline, StableDiffusionInstructPix2PixPipeline, StableDiffusionXLPipeline, EulerDiscreteScheduler
from transformers import CLIPSegProcessor, CLIPSegForImageSegmentation
from PIL import Image, ImageOps
import json

app = FastAPI()

BACKEND_DIR = Path(__file__).resolve().parent
PROPAINTER_DIR = Path(os.environ.get(
    "RENDERFIX_PROPAINTER_DIR",
    BACKEND_DIR / ".propainter" / "ProPainter",
))
PROPAINTER_PYTHON = Path(os.environ.get(
    "RENDERFIX_PROPAINTER_PYTHON",
    BACKEND_DIR / ".propainter" / "venv" / "bin" / "python",
))

# Enable CORS for local React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def parse_mask_points(mask_points):
    """Parse polygon points submitted as a JSON list of [x, y] pairs."""
    if not mask_points:
        return None

    points = np.asarray(json.loads(mask_points), dtype=np.float32)
    if points.ndim != 2 or points.shape[1] != 2 or len(points) < 3:
        raise ValueError("A polygon mask needs at least three [x, y] points")
    if not np.isfinite(points).all():
        raise ValueError("Mask points must be finite numbers")
    return points


def build_removal_masks(frame_shape, x=None, y=None, w=None, h=None, mask_points=None, padding=2, feather=0):
    """Return the opaque removal mask and the larger area used to generate fill."""
    height, width = frame_shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)

    if mask_points is not None:
        polygon = np.rint(mask_points).astype(np.int32)
        polygon[:, 0] = np.clip(polygon[:, 0], 0, width - 1)
        polygon[:, 1] = np.clip(polygon[:, 1], 0, height - 1)
        cv2.fillPoly(mask, [polygon], 255)
    elif None not in (x, y, w, h):
        x = max(0, min(int(x), width))
        y = max(0, min(int(y), height))
        w = max(0, min(int(w), width - x))
        h = max(0, min(int(h), height - y))
        if w == 0 or h == 0:
            return None, None
        mask[y:y+h, x:x+w] = 255
    else:
        return None, None

    if not np.any(mask):
        return None, None

    padding = max(0, min(int(padding), 128))
    feather = max(0, min(int(feather), 64))
    opaque_mask = mask
    if padding:
        kernel_size = padding * 2 + 1
        kernel = np.ones((kernel_size, kernel_size), dtype=np.uint8)
        opaque_mask = cv2.dilate(mask, kernel, iterations=1)

    inpaint_mask = opaque_mask
    if feather:
        kernel_size = feather * 2 + 1
        kernel = np.ones((kernel_size, kernel_size), dtype=np.uint8)
        inpaint_mask = cv2.dilate(opaque_mask, kernel, iterations=1)

    return opaque_mask, inpaint_mask


def apply_inpainting(frame, x=None, y=None, w=None, h=None, mask_points=None, padding=2, feather=0):
    """Inpaint a rectangle or polygon mask, with optional expansion and soft edges."""
    opaque_mask, inpaint_mask = build_removal_masks(
        frame.shape, x, y, w, h, mask_points, padding, feather
    )
    if opaque_mask is None:
        return frame

    inpainted = cv2.inpaint(frame, inpaint_mask, inpaintRadius=5, flags=cv2.INPAINT_NS)

    if feather:
        # Keep every selected pixel fully replaced; fade only the added outer edge.
        outside_distance = cv2.distanceTransform(255 - opaque_mask, cv2.DIST_L2, 3)
        alpha = np.clip(1.0 - outside_distance / (feather + 1.0), 0.0, 1.0)
        alpha[opaque_mask > 0] = 1.0
        alpha = alpha[:, :, np.newaxis]
        return np.clip(frame * (1.0 - alpha) + inpainted * alpha, 0, 255).astype(np.uint8)

    return inpainted


def get_mask_crop_bounds(mask, context=128):
    """Keep temporal inference local to the selected area while retaining context."""
    points = cv2.findNonZero(mask)
    if points is None:
        raise ValueError("The removal mask is empty")
    x, y, width, height = cv2.boundingRect(points)
    margin = max(context, min(256, int(max(width, height) * 1.5)))
    frame_height, frame_width = mask.shape[:2]
    left = max(0, x - margin)
    top = max(0, y - margin)
    right = min(frame_width, x + width + margin)
    bottom = min(frame_height, y + height + margin)
    return left, top, right, bottom


def write_video_crop(source_path, crop_path, crop_bounds):
    """Write a cropped video for inference without changing source timing."""
    left, top, right, bottom = crop_bounds
    capture = cv2.VideoCapture(str(source_path))
    fps = capture.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30.0
    writer = cv2.VideoWriter(
        str(crop_path), cv2.VideoWriter_fourcc(*"mp4v"), fps,
        (right - left, bottom - top),
    )
    if not capture.isOpened() or not writer.isOpened():
        capture.release()
        writer.release()
        raise RuntimeError("Could not prepare a cropped clip for temporal inpainting")

    frame_count = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            writer.write(frame[top:bottom, left:right])
            frame_count += 1
    finally:
        capture.release()
        writer.release()
    if frame_count == 0:
        raise RuntimeError("The uploaded video contains no decodable frames")


def run_propainter(video_path, mask_path, output_dir, processing_limit=384):
    """Run the optional ProPainter installation and return its silent output video."""
    inference_script = PROPAINTER_DIR / "inference_propainter.py"
    if not PROPAINTER_PYTHON.is_file() or not inference_script.is_file():
        raise RuntimeError(
            "Temporal inpainting is not installed. From the backend folder run "
            "bash ./setup_propainter.sh, then restart the backend."
        )

    capture = cv2.VideoCapture(video_path)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    capture.release()
    if width <= 0 or height <= 0:
        raise RuntimeError("Could not read the uploaded video's dimensions")

    factor = min(1.0, processing_limit / max(width, height))
    process_width = max(8, int(width * factor) // 8 * 8)
    process_height = max(8, int(height * factor) // 8 * 8)
    command = [
        str(PROPAINTER_PYTHON), str(BACKEND_DIR / "propainter_runner.py"),
        "--video", str(video_path), "--mask", str(mask_path),
        "--output", str(output_dir),
        "--width", str(process_width), "--height", str(process_height),
        # Padding and feather are already rasterized into this mask.
        "--mask_dilation", "0",
        "--subvideo_length", "40",
        "--fp16",
    ]
    log_path = Path(output_dir) / "propainter.log"
    process_env = os.environ.copy()
    process_env["PYTHONUNBUFFERED"] = "1"
    with open(log_path, "w", encoding="utf-8") as log_file:
        completed = subprocess.run(
            command,
            cwd=str(PROPAINTER_DIR),
            stdout=log_file,
            stderr=subprocess.STDOUT,
            env=process_env,
            check=False,
        )
    if completed.returncode != 0:
        try:
            details = log_path.read_text(encoding="utf-8", errors="replace")[-3000:]
        except OSError:
            details = ""
        raise RuntimeError(f"ProPainter failed. {details}".strip())

    output_path = Path(output_dir) / Path(video_path).stem / "inpaint_out.mp4"
    if not output_path.is_file():
        raise RuntimeError("ProPainter finished without producing an output video")
    return output_path, process_width, process_height


def composite_propainter_video(source_path, filled_path, output_path,
                               opaque_mask, feather, crop_bounds):
    """Blend the reduced-resolution fill into only the masked area of source frames."""
    source = cv2.VideoCapture(str(source_path))
    filled = cv2.VideoCapture(str(filled_path))
    width = int(source.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(source.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = source.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30.0
    writer = cv2.VideoWriter(
        str(output_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height)
    )
    if not source.isOpened() or not filled.isOpened() or not writer.isOpened():
        source.release()
        filled.release()
        writer.release()
        raise RuntimeError("Could not prepare the ProPainter video for compositing")

    left, top, right, bottom = crop_bounds
    opaque_mask_crop = opaque_mask[top:bottom, left:right]
    alpha = (opaque_mask_crop > 0).astype(np.float32)
    if feather:
        outside_distance = cv2.distanceTransform(
            255 - opaque_mask_crop, cv2.DIST_L2, 3
        )
        alpha = np.clip(1.0 - outside_distance / (feather + 1.0), 0.0, 1.0)
        alpha[opaque_mask_crop > 0] = 1.0
    alpha = alpha[:, :, np.newaxis]

    frame_count = 0
    try:
        while True:
            source_ok, source_frame = source.read()
            if not source_ok:
                break
            filled_ok, filled_frame = filled.read()
            if not filled_ok:
                raise RuntimeError("ProPainter output ended before the source video")

            crop_size = (right - left, bottom - top)
            if filled_frame.shape[:2] != (crop_size[1], crop_size[0]):
                filled_frame = cv2.resize(
                    filled_frame, crop_size, interpolation=cv2.INTER_LANCZOS4
                )
            source_crop = source_frame[top:bottom, left:right]
            composed = source_crop * (1.0 - alpha) + filled_frame * alpha
            source_frame[top:bottom, left:right] = np.clip(composed, 0, 255).astype(np.uint8)
            writer.write(source_frame)
            frame_count += 1
    finally:
        source.release()
        filled.release()
        writer.release()

    if frame_count == 0:
        raise RuntimeError("No frames were produced by temporal inpainting")
    return frame_count

@app.post("/api/export/single")
async def export_single_frame(
    file: UploadFile = File(...),
    timestamp: float = Form(...),
    format: str = Form("image/png"),
    scale: float = Form(1.0),
    x: float = Form(None),
    y: float = Form(None),
    w: float = Form(None),
    h: float = Form(None),
    mask_points: str = Form(None),
    mask_padding: int = Form(2),
    mask_feather: int = Form(0),
    compare: bool = Form(False)
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

        original_frame = frame.copy()
        polygon_points = parse_mask_points(mask_points)

        if polygon_points is not None or all(value is not None for value in (x, y, w, h)):
            frame = apply_inpainting(
                frame, x, y, w, h, polygon_points, mask_padding, mask_feather
            )

        if compare:
            image_options = [cv2.IMWRITE_JPEG_QUALITY, 92]
            original_ok, original_encoded = cv2.imencode('.jpg', original_frame, image_options)
            processed_ok, processed_encoded = cv2.imencode('.jpg', frame, image_options)
            if not original_ok or not processed_ok:
                return JSONResponse(status_code=500, content={"message": "Failed to encode comparison preview"})
            return JSONResponse(content={
                "original": base64.b64encode(original_encoded).decode("ascii"),
                "processed": base64.b64encode(processed_encoded).decode("ascii"),
                "media_type": "image/jpeg"
            })

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
    mask_points: str = Form(None),
    mask_padding: int = Form(2),
    mask_feather: int = Form(0),
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

        polygon_points = parse_mask_points(mask_points)
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

                if polygon_points is not None or all(value is not None for value in (x, y, w, h)):
                    frame = apply_inpainting(
                        frame, x, y, w, h, polygon_points, mask_padding, mask_feather
                    )
                    
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
    mask_points: str = Form(None),
    mask_padding: int = Form(2),
    mask_feather: int = Form(0),
    start_time: float = Form(None),
    end_time: float = Form(None),
    watermark_text: str = Form(None),
    watermark_position: str = Form("bottom-right"),
    format: str = Form("video/mp4"),
    processing_method: str = Form("opencv"),
):
    temp_dir = tempfile.mkdtemp(prefix="renderfix-video-")
    clip = None
    filled_clip = None
    new_clip = None
    out_path = None
    try:
        if processing_method not in ("opencv", "propainter"):
            raise ValueError("Unknown video processing method")
        tmp_in_path = os.path.join(temp_dir, "source.mp4")
        with open(tmp_in_path, "wb") as tmp_in:
            shutil.copyfileobj(file.file, tmp_in)

        ext = ".gif" if format == "image/gif" else ".mp4"
        output_handle, out_path = tempfile.mkstemp(suffix=ext)
        os.close(output_handle)
        os.remove(out_path)

        clip = VideoFileClip(tmp_in_path)
        polygon_points = parse_mask_points(mask_points)
        
        # Apply trimming if provided
        if start_time is not None or end_time is not None:
            st = max(0, start_time or 0)
            et = min(clip.duration, end_time or clip.duration)
            if et <= st:
                raise ValueError("The trim end time must be after the start time")
            clip = clip.subclip(st, et)

        active_clip = clip
        composite_path = None
        if processing_method == "propainter":
            if polygon_points is None and not all(value is not None for value in (x, y, w, h)):
                raise ValueError("Draw a rectangle or polygon mask before using temporal inpainting")
            temporal_input_path = os.path.join(temp_dir, "temporal_input.mp4")
            clip.write_videofile(
                temporal_input_path,
                codec="libx264",
                audio_codec="aac",
                logger=None,
            )
            original_width = int(clip.w)
            original_height = int(clip.h)
            opaque_mask, inpaint_mask = build_removal_masks(
                (original_height, original_width, 3),
                x,
                y,
                w,
                h,
                polygon_points,
                mask_padding,
                mask_feather,
            )
            crop_bounds = get_mask_crop_bounds(inpaint_mask)
            crop_left, crop_top, crop_right, crop_bottom = crop_bounds
            crop_width = crop_right - crop_left
            crop_height = crop_bottom - crop_top
            processing_limit = 384
            processing_factor = min(1.0, processing_limit / max(crop_width, crop_height))
            process_width = max(8, int(crop_width * processing_factor) // 8 * 8)
            process_height = max(8, int(crop_height * processing_factor) // 8 * 8)
            propainter_mask = cv2.resize(
                inpaint_mask[crop_top:crop_bottom, crop_left:crop_right],
                (process_width, process_height),
                interpolation=cv2.INTER_NEAREST,
            )
            mask_path = os.path.join(temp_dir, "mask.png")
            if not cv2.imwrite(mask_path, propainter_mask):
                raise RuntimeError("Could not save the ProPainter mask")

            crop_input_path = os.path.join(temp_dir, "temporal_crop.mp4")
            write_video_crop(temporal_input_path, crop_input_path, crop_bounds)
            propainter_output_dir = os.path.join(temp_dir, "propainter_results")
            os.makedirs(propainter_output_dir, exist_ok=True)
            filled_path, _, _ = await asyncio.to_thread(
                run_propainter,
                crop_input_path,
                mask_path,
                propainter_output_dir,
                processing_limit,
            )
            composite_path = os.path.join(temp_dir, "composited.mp4")
            await asyncio.to_thread(
                composite_propainter_video,
                temporal_input_path,
                filled_path,
                composite_path,
                opaque_mask,
                max(0, min(int(mask_feather), 64)),
                crop_bounds,
            )
            filled_clip = VideoFileClip(composite_path)
            active_clip = filled_clip
        
        def process_frame(frame, apply_selected_mask=True):
            bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
            if apply_selected_mask and (polygon_points is not None or all(value is not None for value in (x, y, w, h))):
                bgr = apply_inpainting(
                    bgr, x, y, w, h, polygon_points, mask_padding, mask_feather
                )
                
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
            
        new_clip = active_clip.image_transform(
            lambda frame: process_frame(frame, processing_method == "opencv")
        )
        
        if format == "image/gif":
            new_clip.write_gif(out_path, logger=None, fps=15)
        else:
            if processing_method == "propainter":
                if hasattr(new_clip, "with_audio"):
                    new_clip = new_clip.with_audio(clip.audio)
                else:
                    new_clip = new_clip.set_audio(clip.audio)
            new_clip.write_videofile(out_path, codec="libx264", audio_codec="aac", logger=None)

        if new_clip:
            new_clip.close()
        if filled_clip:
            filled_clip.close()
        if clip:
            clip.close()

        def cleanup():
            shutil.rmtree(temp_dir, ignore_errors=True)
            if out_path and os.path.exists(out_path):
                os.remove(out_path)
                
        background_tasks.add_task(cleanup)

        filename = "cleaned_video.mp4" if format == "video/mp4" else "exported.gif"
        return FileResponse(out_path, media_type=format, filename=filename)

    except Exception as e:
        for video_clip in (new_clip, filled_clip, clip):
            if video_clip:
                try:
                    video_clip.close()
                except Exception:
                    pass
        shutil.rmtree(temp_dir, ignore_errors=True)
        if out_path and os.path.exists(out_path):
            os.remove(out_path)
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

# -----------------------------
# Advanced Generative AI Models
# -----------------------------
sd_inpaint_pipeline = None
sd_instruct_pipeline = None
class UnifiedModelManager:
    def __init__(self):
        self.sdxl_pipe = None
        self.sdxl_inpaint_pipe = None
        self.face_app = None
        self.sam_processor = None
        self.sam_model = None

    def get_sam_processor(self):
        if self.sam_processor is None:
            from transformers import SamProcessor
            print("Loading SAM Processor...")
            self.sam_processor = SamProcessor.from_pretrained("facebook/sam-vit-base")
        return self.sam_processor

    def get_sam_model(self):
        if self.sam_model is None:
            from transformers import SamModel
            print("Loading SAM Model...")
            self.sam_model = SamModel.from_pretrained("facebook/sam-vit-base").to("mps")
        return self.sam_model

    def get_face_app(self):
        if self.face_app is None:
            import insightface
            from insightface.app import FaceAnalysis
            print("Loading InsightFace Model...")
            self.face_app = FaceAnalysis(name="buffalo_l", providers=['CPUExecutionProvider'])
            self.face_app.prepare(ctx_id=0, det_size=(640, 640))
        return self.face_app

    def get_sdxl_pipeline(self):
        if self.sdxl_pipe is None:
            print("Loading SDXL-Lightning with IP-Adapter-FaceID... (This may take a while on first run)")
            base = "stabilityai/stable-diffusion-xl-base-1.0"
            repo = "ByteDance/SDXL-Lightning"
            
            from diffusers import StableDiffusionXLPipeline, EulerDiscreteScheduler
            self.sdxl_pipe = StableDiffusionXLPipeline.from_pretrained(
                base, 
                torch_dtype=torch.float16,
                variant="fp16"
            ).to("mps")
            
            self.sdxl_pipe.scheduler = EulerDiscreteScheduler.from_config(
                self.sdxl_pipe.scheduler.config, 
                timestep_spacing="trailing"
            )
            
            self.sdxl_pipe.load_lora_weights(repo, weight_name="sdxl_lightning_4step_lora.safetensors")
            self.sdxl_pipe.fuse_lora()
            
            # Load the FaceID adapter (requires image_encoder=None)
            self.sdxl_pipe.load_ip_adapter(
                "h94/IP-Adapter-FaceID", 
                subfolder=None, 
                weight_name="ip-adapter-faceid_sdxl.bin",
                image_encoder_folder=None
            )
            
            self.sdxl_pipe.enable_model_cpu_offload()
            self.sdxl_pipe.enable_attention_slicing()
            
        return self.sdxl_pipe

    def get_sdxl_inpaint_pipeline(self):
        if self.sdxl_inpaint_pipe is None:
            base_pipe = self.get_sdxl_pipeline()
            from diffusers import AutoPipelineForInpainting
            self.sdxl_inpaint_pipe = AutoPipelineForInpainting.from_pipe(base_pipe)
            self.sdxl_inpaint_pipe.enable_model_cpu_offload()
            self.sdxl_inpaint_pipe.enable_attention_slicing()
        return self.sdxl_inpaint_pipe

model_manager = UnifiedModelManager()

def get_sd_inpaint_pipeline():
    global sd_inpaint_pipeline
    if sd_inpaint_pipeline is None:
        print("Loading Stable Diffusion Inpainting model... (This may take a while on first run)")
        # Using a highly optimized SD Inpainting model for speed and quality on Mac
        model_id = "runwayml/stable-diffusion-inpainting"
        sd_inpaint_pipeline = StableDiffusionInpaintPipeline.from_pretrained(
            model_id, 
            torch_dtype=torch.float16, 
            variant="fp16"
        )
        sd_inpaint_pipeline = sd_inpaint_pipeline.to("mps")
        sd_inpaint_pipeline.enable_attention_slicing()
    return sd_inpaint_pipeline

def get_sd_instruct_pipeline():
    global sd_instruct_pipeline
    if sd_instruct_pipeline is None:
        print("Loading InstructPix2Pix model... (This may take a while on first run)")
        model_id = "timbrooks/instruct-pix2pix"
        sd_instruct_pipeline = StableDiffusionInstructPix2PixPipeline.from_pretrained(
            model_id, 
            torch_dtype=torch.float16, 
            safety_checker=None
        )
        sd_instruct_pipeline = sd_instruct_pipeline.to("mps")
        sd_instruct_pipeline.enable_attention_slicing()
    return sd_instruct_pipeline

def get_clipseg_models():
    global clipseg_processor, clipseg_model
    if clipseg_processor is None or clipseg_model is None:
        print("Loading CLIPSeg model for Auto-Masking...")
        processor_id = "CIDAS/clipseg-rd64-refined"
        clipseg_processor = CLIPSegProcessor.from_pretrained(processor_id)
        clipseg_model = CLIPSegForImageSegmentation.from_pretrained(processor_id)
    return clipseg_processor, clipseg_model

@app.post("/api/image/inpaint")
async def inpaint_image(
    image: UploadFile = File(...),
    mask: UploadFile = File(...),
    prompt: str = Form("")
):
    try:
        init_image = Image.open(image.file).convert("RGB")
        mask_image = Image.open(mask.file).convert("RGB")
        
        if init_image.size != mask_image.size:
            mask_image = mask_image.resize(init_image.size)
            
        pipe = get_sd_inpaint_pipeline()
        
        actual_prompt = prompt.strip()
        if not actual_prompt:
            actual_prompt = "background, seamless, high quality, highly detailed"
            
        print(f"Running manual inpainting with prompt: '{actual_prompt}'")
            
        output = pipe(
            prompt=actual_prompt, 
            image=init_image, 
            mask_image=mask_image,
            num_inference_steps=30
        ).images[0]
        
        img_byte_arr = io.BytesIO()
        output.save(img_byte_arr, format='PNG')
        img_byte_arr.seek(0)
        
        return Response(content=img_byte_arr.getvalue(), media_type="image/png")
        
    except Exception as e:
        print("Error during inpainting:", e)
        return JSONResponse(status_code=500, content={"message": str(e)})

@app.post("/api/image/smart-edit")
async def smart_edit_image(
    image: UploadFile = File(...),
    edit_type: str = Form("replace_object"), # "replace_object" or "global_edit"
    target_object: str = Form(""),
    prompt: str = Form("")
):
    try:
        init_image = Image.open(image.file).convert("RGB")
        
        # Max resolution to prevent OOM
        max_size = 1024
        if max(init_image.size) > max_size:
            init_image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

        actual_prompt = prompt.strip()
        
        if edit_type == "global_edit":
            print(f"Running InstructPix2Pix with prompt: '{actual_prompt}'")
            pipe = get_sd_instruct_pipeline()
            output = pipe(
                prompt=actual_prompt,
                image=init_image,
                num_inference_steps=30,
                image_guidance_scale=1.5
            ).images[0]
            
        elif edit_type == "replace_object":
            if not target_object.strip():
                return JSONResponse(status_code=400, content={"message": "Target object is required for Auto-Masking."})
                
            print(f"Running CLIPSeg for '{target_object}'...")
            processor, model = get_clipseg_models()
            
            # Predict mask
            inputs = processor(text=[target_object.strip()], images=[init_image], padding="max_length", return_tensors="pt")
            with torch.no_grad():
                outputs = model(**inputs)
            
            # Process output mask
            preds = outputs.logits.unsqueeze(1)
            preds = torch.sigmoid(preds[0][0])
            mask = preds.cpu().numpy()
            
            # Normalize and threshold mask
            mask = (mask - mask.min()) / (mask.max() - mask.min())
            mask = (mask > 0.4).astype(np.uint8) * 255
            
            # Convert mask to PIL Image and resize to match init_image
            mask_image = Image.fromarray(mask).convert("L")
            mask_image = mask_image.resize(init_image.size, Image.Resampling.LANCZOS)
            
            # Expand mask slightly for smoother inpainting (dilate)
            mask_np = np.array(mask_image)
            kernel = np.ones((15, 15), np.uint8)
            mask_np = cv2.dilate(mask_np, kernel, iterations=1)
            mask_image = Image.fromarray(mask_np).convert("RGB")
            
            print(f"Running Inpainting with prompt: '{actual_prompt}'")
            pipe = get_sd_inpaint_pipeline()
            output = pipe(
                prompt=actual_prompt,
                image=init_image,
                mask_image=mask_image,
                num_inference_steps=30
            ).images[0]
            
        else:
            return JSONResponse(status_code=400, content={"message": "Invalid edit_type."})

        # Save output to bytes
        img_byte_arr = io.BytesIO()
        output.save(img_byte_arr, format='PNG')
        img_byte_arr.seek(0)
        
        return Response(content=img_byte_arr.getvalue(), media_type="image/png")
        
    except Exception as e:
        print(f"Smart Edit Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"message": str(e)})

@app.post("/api/image/advanced-composite")
async def advanced_composite(
    prompt: str = Form(...),
    references_meta: str = Form(...), # JSON string of labels and types
    base_image: UploadFile = File(None),
    reference_images: Optional[List[UploadFile]] = File(None),
    reference_masks: Optional[List[UploadFile]] = File(None)
):
    try:
        print(f"Backend: Running Advanced Compositor with prompt: '{prompt}'")
        meta = json.loads(references_meta)
        
        # Load images
        loaded_images = []
        if reference_images:
            for file in reference_images:
                content = await file.read()
            img = Image.open(io.BytesIO(content)).convert("RGB")
            # Resize references to save memory during processing
            img.thumbnail((512, 512), Image.Resampling.LANCZOS)
            loaded_images.append(img)
            
        pipe = model_manager.get_sdxl_pipeline()
        face_app = model_manager.get_face_app()
        
        # Configure IP-Adapter
        pipe.set_ip_adapter_scale(0.6)
        
        # We append the labels to the prompt for better guidance
        augmented_prompt = prompt
        
        face_embeds = []
        for i, m in enumerate(meta):
            augmented_prompt += f", {m['label']} style"
            
            # Extract face ID using InsightFace
            cv_img = cv2.cvtColor(np.array(loaded_images[i]), cv2.COLOR_RGB2BGR)
            faces = face_app.get(cv_img)
            
            if len(faces) > 0:
                print(f"Detected face for {m['label']}")
                face_embed = torch.from_numpy(faces[0].normed_embedding).unsqueeze(0)
                face_embeds.append(face_embed)
            else:
                print(f"No face detected in {m['label']}, falling back to zero embedding")
                face_embeds.append(torch.zeros((1, 512)))
                
        print(f"Final Prompt: {augmented_prompt}")
        
        # Stack embeddings
        if len(face_embeds) > 0:
            faceid_embeds = torch.cat(face_embeds, dim=0)
        else:
            faceid_embeds = None

        # Read provided masks
        mask_images = []
        if reference_masks:
            for file in reference_masks:
                content = await file.read()
                m = Image.open(io.BytesIO(content)).convert("L")
                mask_images.append(m)

        # Prepare dummy masks if none provided from frontend yet (future-proofing for Phase 3)
        # IPAdapterMaskProcessor expects a list of PIL Images (binary masks)
        from diffusers.image_processor import IPAdapterMaskProcessor
        mask_processor = IPAdapterMaskProcessor()
        
        cross_attention_kwargs = None
        
        if len(mask_images) > 0:
            print("Applying Regional Masking...")
            # We must process masks to match the height and width of the output (1024x1024 for SDXL)
            processed_masks = mask_processor.preprocess(mask_images, height=1024, width=1024)
            # Add dummy empty masks for references that don't have masks, to keep shapes aligned
            # (diffusers IPAdapter masking logic is complex, for simplicity we just pass the masks we have)
            cross_attention_kwargs = {"ip_adapter_masks": processed_masks}
        
        # Hardcoded structural negative prompt for Nano-Banana quality
        negative_prompt = "(deformed, distorted, disfigured:1.3), poorly drawn, bad anatomy, wrong proportions, extra limbs, ugly, mutated"

        # Determine if we are doing img2img/inpainting or txt2img
        if base_image and len(mask_images) > 0:
            print("Running Regional IP-Adapter Inpainting...")
            content = await base_image.read()
            init_img = Image.open(io.BytesIO(content)).convert("RGB").resize((1024, 1024))
            
            # Combine all masks into one global mask for the inpainting model
            global_mask = np.zeros((1024, 1024), dtype=np.uint8)
            
            # Smart FaceID Logic: If we are masking the body, we do NOT want FaceID to generate a face inside the body.
            # We check if any reference actually has type 'face'. In the new UI, we will track this.
            # For now, if the mask is just for clothes, applying face_embeds will destroy it.
            # Let's apply FaceID ONLY if the mask corresponds to a 'face' type reference, otherwise None.
            has_face_mask = any('face' in r.get('type', '') for r in refs_meta)
            
            for m in mask_images:
                global_mask = np.maximum(global_mask, np.array(m.resize((1024, 1024))))
            global_mask_pil = Image.fromarray(global_mask)
            
            inpaint_pipe = model_manager.get_sdxl_inpaint_pipeline()
            inpaint_pipe.set_ip_adapter_scale(0.6)
            
            result = inpaint_pipe(
                prompt=augmented_prompt,
                negative_prompt=negative_prompt,
                image=init_img,
                mask_image=global_mask_pil,
                ip_adapter_image_embeds=[faceid_embeds] if (faceid_embeds is not None and has_face_mask) else None,
                num_inference_steps=4,
                guidance_scale=0,
                strength=0.99, # Crucial for Lightning 4-step inpainting
                cross_attention_kwargs=cross_attention_kwargs if has_face_mask else None
            ).images[0]
        else:
            print("Running Regional IP-Adapter Text2Image...")
            # Generate image using Lightning (4 steps)
            result = pipe(
                prompt=augmented_prompt,
                negative_prompt=negative_prompt,
                ip_adapter_image_embeds=[faceid_embeds] if faceid_embeds is not None else None,
                num_inference_steps=4,
                guidance_scale=0, # Lightning requires 0 guidance scale
                cross_attention_kwargs=cross_attention_kwargs
            ).images[0]
        
        # Encode result
        img_byte_arr = io.BytesIO()
        result.save(img_byte_arr, format='PNG')
        img_byte_arr.seek(0)
        
        # Flush to free memory
        if torch.backends.mps.is_available():
            torch.mps.empty_cache()
            import gc
            gc.collect()
            
        return Response(content=img_byte_arr.getvalue(), media_type="image/png")
        
    except Exception as e:
        print(f"Advanced Composite Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"message": str(e)})

@app.post("/api/image/segment")
async def segment_image(
    image: UploadFile = File(...),
    points: str = Form(...) # JSON string of [[x, y], [x, y]]
):
    try:
        content = await image.read()
        img = Image.open(io.BytesIO(content)).convert("RGB")
        
        pts = json.loads(points)
        if not pts:
            return JSONResponse(status_code=400, content={"message": "No points provided"})
            
        processor = model_manager.get_sam_processor()
        model = model_manager.get_sam_model()
        
        # SAM expects points as [[[x, y]]]
        input_points = [[pts]]
        inputs = processor(img, input_points=input_points, return_tensors="pt").to("mps")
        
        with torch.no_grad():
            outputs = model(**inputs)
            
        # The output masks are of shape [batch, 1, num_masks, height, width]
        masks = processor.image_processor.post_process_masks(
            outputs.pred_masks.cpu(), 
            inputs["original_sizes"].cpu(), 
            inputs["reshaped_input_sizes"].cpu()
        )
        
        # We take the mask with the highest score (typically the first or last depending on output structure)
        # outputs.iou_scores is [batch, 1, num_masks]
        best_mask_idx = torch.argmax(outputs.iou_scores[0, 0]).item()
        best_mask = masks[0][0, best_mask_idx].numpy()
        
        # Convert binary mask to an image (black and white)
        mask_img = (best_mask * 255).astype(np.uint8)
        mask_pil = Image.fromarray(mask_img)
        
        # Dilate mask slightly for seamless blending in downstream tasks
        mask_cv = np.array(mask_pil)
        kernel = np.ones((5,5), np.uint8)
        dilated_mask = cv2.dilate(mask_cv, kernel, iterations=1)
        dilated_pil = Image.fromarray(dilated_mask)
        
        img_byte_arr = io.BytesIO()
        dilated_pil.save(img_byte_arr, format='PNG')
        img_byte_arr.seek(0)
        
        if torch.backends.mps.is_available():
            torch.mps.empty_cache()
            import gc
            gc.collect()
            
        return Response(content=img_byte_arr.getvalue(), media_type="image/png")
        
    except Exception as e:
        print(f"SAM Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"message": str(e)})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
