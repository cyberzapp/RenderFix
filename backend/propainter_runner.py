"""Compatibility entry point for ProPainter's legacy video loading API."""

import inspect
import os
import re
import sys
from pathlib import Path

import av
import torch
import torchvision


propainter_dir = Path(os.environ.get(
    "RENDERFIX_PROPAINTER_DIR",
    Path(__file__).resolve().parent / ".propainter" / "ProPainter",
)).resolve()
inference_script = propainter_dir / "inference_propainter.py"
if not inference_script.is_file():
    raise FileNotFoundError(f"ProPainter inference script not found: {inference_script}")

# torchvision removed io.read_video in recent releases. ProPainter only needs
# the decoded RGB video tensor and its frame rate, so provide that interface
# through the PyAV dependency already required by ProPainter.
if not hasattr(torchvision.io, "read_video"):
    def read_video(filename, pts_unit="sec"):
        with av.open(str(filename)) as container:
            video_stream = container.streams.video[0]
            fps = video_stream.average_rate or video_stream.base_rate
            frames = [
                torch.from_numpy(frame.to_ndarray(format="rgb24"))
                for frame in container.decode(video_stream)
            ]
        if not frames:
            raise RuntimeError(f"No video frames could be decoded from {filename}")
        return torch.stack(frames), None, {"video_fps": float(fps or 30)}

    torchvision.io.read_video = read_video

# PyTorch 2.6+ defaults to weights_only=True. ProPainter's official pretrained
# checkpoints are trusted model files and include metadata requiring full load.
if "weights_only" in inspect.signature(torch.load).parameters:
    original_torch_load = torch.load

    def load_checkpoint(*args, **kwargs):
        kwargs.setdefault("weights_only", False)
        return original_torch_load(*args, **kwargs)

    torch.load = load_checkpoint

sys.path.insert(0, str(propainter_dir))
source = inference_script.read_text(encoding="utf-8")
source, patched_batches = re.subn(
    r"(if frames\.size\(-1\) <= 640:\s*\n\s*)short_clip_len = 12",
    r"\1short_clip_len = 4",
    source,
    count=1,
)
if patched_batches != 1:
    raise RuntimeError("ProPainter's optical-flow batching block is not recognized")

exec(compile(source, str(inference_script), "exec"), {
    "__name__": "__main__",
    "__file__": str(inference_script),
})
