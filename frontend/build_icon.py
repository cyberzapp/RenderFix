"""Assemble the generated PNG sizes into a macOS ICNS container."""

from pathlib import Path
import struct


BUILD_DIR = Path(__file__).resolve().parent / "build"
ICONSET_DIR = BUILD_DIR / "RenderFix.iconset"
OUTPUT_PATH = BUILD_DIR / "icon.icns"

ICON_RESOURCES = [
    ("icon_16x16.png", b"icp4"),
    ("icon_16x16@2x.png", b"ic11"),
    ("icon_32x32.png", b"icp5"),
    ("icon_32x32@2x.png", b"ic12"),
    ("icon_128x128.png", b"ic07"),
    ("icon_128x128@2x.png", b"ic13"),
    ("icon_256x256.png", b"ic08"),
    ("icon_256x256@2x.png", b"ic14"),
    ("icon_512x512.png", b"ic09"),
    ("icon_512x512@2x.png", b"ic10"),
]

chunks = []
for filename, resource_type in ICON_RESOURCES:
    image_data = (ICONSET_DIR / filename).read_bytes()
    chunks.append(resource_type + struct.pack(">I", len(image_data) + 8) + image_data)

payload = b"".join(chunks)
OUTPUT_PATH.write_bytes(b"icns" + struct.pack(">I", len(payload) + 8) + payload)
