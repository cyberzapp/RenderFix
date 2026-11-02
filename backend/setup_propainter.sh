#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$BACKEND_DIR/.propainter"
REPO_DIR="$INSTALL_DIR/ProPainter"
VENV_DIR="$INSTALL_DIR/venv"

if ! command -v git >/dev/null 2>&1; then
  echo "Git is required to download ProPainter."
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to download ProPainter's pretrained weights."
  exit 1
fi

PYTHON_BIN="${PYTHON_BIN:-}"
if [[ -z "$PYTHON_BIN" ]]; then
  for candidate in python3.11 python3.10 python3.9 python3.8; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "$PYTHON_BIN" ]] || ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python 3.8–3.11 is required. Set PYTHON_BIN to its executable and retry."
  exit 1
fi

mkdir -p "$INSTALL_DIR"
if [[ ! -f "$REPO_DIR/inference_propainter.py" ]]; then
  git clone --depth 1 https://github.com/sczhou/ProPainter.git "$REPO_DIR"
fi

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install -r "$REPO_DIR/requirements.txt"

WEIGHTS_DIR="$REPO_DIR/weights"
mkdir -p "$WEIGHTS_DIR"
for weight in ProPainter.pth recurrent_flow_completion.pth raft-things.pth; do
  if [[ ! -s "$WEIGHTS_DIR/$weight" ]]; then
    curl --fail --location --retry 2 \
      "https://github.com/sczhou/ProPainter/releases/download/v0.1.0/$weight" \
      --output "$WEIGHTS_DIR/$weight"
  fi
done

echo
echo "ProPainter is installed in $INSTALL_DIR."
echo "Its pretrained checkpoints are ready for the first temporal export."
