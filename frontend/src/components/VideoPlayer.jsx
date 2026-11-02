import React, { useRef, useState, useEffect } from 'react'

export default function VideoPlayer({
  src,
  videoRef,
  watermarkRegion,
  setWatermarkRegion,
  maskTool,
  onTimeUpdate,
  onDurationChange,
  currentTime,
  isPlaying,
  setIsPlaying,
}) {
  const containerRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [startPos, setStartPos] = useState({ x: 0, y: 0 })
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 })
  const [draftPoints, setDraftPoints] = useState([])
  const [renderRect, setRenderRect] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const calculateRenderRect = () => {
    if (!videoRef.current) return null
    const video = videoRef.current
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return null

    const cw = video.offsetWidth
    const ch = video.offsetHeight
    const videoRatio = vw / vh
    const elementRatio = cw / ch
    let renderWidth, renderHeight, xOffset, yOffset

    if (videoRatio > elementRatio) {
      renderWidth = cw
      renderHeight = cw / videoRatio
      xOffset = 0
      yOffset = (ch - renderHeight) / 2
    } else {
      renderHeight = ch
      renderWidth = ch * videoRatio
      xOffset = (cw - renderWidth) / 2
      yOffset = 0
    }

    return { renderWidth, renderHeight, xOffset, yOffset, vw, vh }
  }

  useEffect(() => {
    if (!containerRef.current) return
    const resizeObserver = new ResizeObserver(() => setRenderRect(calculateRenderRect()))
    resizeObserver.observe(containerRef.current)

    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      resizeObserver.disconnect()
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  useEffect(() => {
    setDraftPoints([])
    setIsDrawing(false)
  }, [src])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.().catch(err => console.error(err))
    } else {
      document.exitFullscreen?.()
    }
  }

  const handleLoadedMetadata = () => {
    onDurationChange(videoRef.current.duration)
    setRenderRect(calculateRenderRect())
  }

  const handleTimeUpdate = () => onTimeUpdate(videoRef.current.currentTime)

  const togglePlay = () => {
    if (videoRef.current.paused) {
      videoRef.current.play()
      setIsPlaying(true)
    } else {
      videoRef.current.pause()
      setIsPlaying(false)
    }
  }

  const getPointerPosition = (event, clampToVideo = true) => {
    if (!videoRef.current) return null
    const layout = calculateRenderRect()
    if (!layout) return null

    const rect = videoRef.current.getBoundingClientRect()
    const rawX = event.clientX - rect.left
    const rawY = event.clientY - rect.top
    const minX = layout.xOffset
    const minY = layout.yOffset
    const maxX = minX + layout.renderWidth
    const maxY = minY + layout.renderHeight

    if (!clampToVideo && (rawX < minX || rawX > maxX || rawY < minY || rawY > maxY)) {
      return null
    }

    const displayX = Math.max(minX, Math.min(rawX, maxX))
    const displayY = Math.max(minY, Math.min(rawY, maxY))
    return {
      x: ((displayX - minX) / layout.renderWidth) * layout.vw,
      y: ((displayY - minY) / layout.renderHeight) * layout.vh,
      displayX,
      displayY,
    }
  }

  const handlePointerDown = (event) => {
    if (event.target.closest('button')) return
    event.preventDefault()
    const point = getPointerPosition(event, false)
    if (!point) return

    if (maskTool === 'polygon') {
      setDraftPoints(points => [...points, { x: point.x, y: point.y }])
      return
    }

    setDraftPoints([])
    setWatermarkRegion(null)
    setIsDrawing(true)
    setStartPos({ x: point.displayX, y: point.displayY })
    setCurrentPos({ x: point.displayX, y: point.displayY })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event) => {
    if (!isDrawing) return
    const point = getPointerPosition(event)
    if (point) setCurrentPos({ x: point.displayX, y: point.displayY })
  }

  const handlePointerUp = (event) => {
    if (!isDrawing) return
    setIsDrawing(false)
    const point = getPointerPosition(event)
    const end = point ? { x: point.displayX, y: point.displayY } : currentPos

    const layout = calculateRenderRect()
    if (!layout) return

    const cssX = Math.min(startPos.x, end.x)
    const cssY = Math.min(startPos.y, end.y)
    const cssW = Math.abs(end.x - startPos.x)
    const cssH = Math.abs(end.y - startPos.y)
    if (cssW < 6 || cssH < 6) return

    const scaleX = layout.vw / layout.renderWidth
    const scaleY = layout.vh / layout.renderHeight
    const x = Math.max(0, Math.min(layout.vw - 1, (cssX - layout.xOffset) * scaleX))
    const y = Math.max(0, Math.min(layout.vh - 1, (cssY - layout.yOffset) * scaleY))
    const w = Math.min(layout.vw - x, cssW * scaleX)
    const h = Math.min(layout.vh - y, cssH * scaleY)

    if (w > 0 && h > 0) setWatermarkRegion({ type: 'rectangle', x, y, w, h })
  }

  const applyPolygon = () => {
    if (draftPoints.length < 3) return
    setWatermarkRegion({ type: 'polygon', points: draftPoints })
    setDraftPoints([])
  }

  const undoPolygonPoint = () => setDraftPoints(points => points.slice(0, -1))
  const cancelPolygon = () => setDraftPoints([])

  const layout = renderRect || calculateRenderRect()
  const svgWidth = videoRef.current?.offsetWidth || 1
  const svgHeight = videoRef.current?.offsetHeight || 1
  const toDisplayPoint = (point) => ({
    x: point.x * (layout?.renderWidth || 0) / (layout?.vw || 1) + (layout?.xOffset || 0),
    y: point.y * (layout?.renderHeight || 0) / (layout?.vh || 1) + (layout?.yOffset || 0),
  })

  let selectedPoints = []
  if (watermarkRegion?.type === 'polygon') {
    selectedPoints = watermarkRegion.points.map(toDisplayPoint)
  } else if (watermarkRegion) {
    const topLeft = toDisplayPoint({ x: watermarkRegion.x, y: watermarkRegion.y })
    selectedPoints = [
      topLeft,
      toDisplayPoint({ x: watermarkRegion.x + watermarkRegion.w, y: watermarkRegion.y }),
      toDisplayPoint({ x: watermarkRegion.x + watermarkRegion.w, y: watermarkRegion.y + watermarkRegion.h }),
      toDisplayPoint({ x: watermarkRegion.x, y: watermarkRegion.y + watermarkRegion.h }),
    ]
  }

  const draftDisplayPoints = draftPoints.map(toDisplayPoint)
  const drawingRect = isDrawing ? {
    x: Math.min(startPos.x, currentPos.x),
    y: Math.min(startPos.y, currentPos.y),
    width: Math.abs(currentPos.x - startPos.x),
    height: Math.abs(currentPos.y - startPos.y),
  } : null
  const selectedBounds = selectedPoints.length ? {
    x: Math.min(...selectedPoints.map(point => point.x)),
    y: Math.min(...selectedPoints.map(point => point.y)),
    right: Math.max(...selectedPoints.map(point => point.x)),
  } : null

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col bg-black overflow-hidden group">
      <div className="relative flex-1 min-h-0 w-full">
        <video
          ref={videoRef}
          src={src}
          className="w-full h-full object-contain pointer-events-none"
          playsInline
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onEnded={() => setIsPlaying(false)}
        />

        <div
          className="absolute inset-0 z-10 cursor-crosshair"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          title={maskTool === 'polygon' ? 'Click to add polygon points' : 'Drag to select a removal area'}
        >
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            preserveAspectRatio="none"
          >
            {drawingRect && (
              <rect
                x={drawingRect.x}
                y={drawingRect.y}
                width={drawingRect.width}
                height={drawingRect.height}
                fill="rgba(99,102,241,0.22)"
                stroke="#818cf8"
                strokeWidth="2"
                strokeDasharray="6 4"
              />
            )}
            {selectedPoints.length > 0 && (
              <polygon
                points={selectedPoints.map(point => `${point.x},${point.y}`).join(' ')}
                fill="rgba(99,102,241,0.22)"
                stroke="#818cf8"
                strokeWidth="2"
                strokeDasharray="6 4"
              />
            )}
            {draftDisplayPoints.length > 0 && (
              <>
                <polyline
                  points={draftDisplayPoints.map(point => `${point.x},${point.y}`).join(' ')}
                  fill="none"
                  stroke="#c4b5fd"
                  strokeWidth="3"
                  strokeDasharray="6 4"
                />
                {draftDisplayPoints.map((point, index) => (
                  <circle key={index} cx={point.x} cy={point.y} r="5" fill="#c4b5fd" />
                ))}
              </>
            )}
          </svg>

          {selectedBounds && (
            <button
              type="button"
              onPointerDown={event => event.stopPropagation()}
              onClick={() => setWatermarkRegion(null)}
              className="absolute z-20 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-lg hover:bg-red-600 transition-colors"
              style={{ left: selectedBounds.right, top: selectedBounds.y, transform: 'translate(-50%, -50%)' }}
              title="Clear removal mask"
              aria-label="Clear removal mask"
            >
              <i className="ph ph-x text-sm"></i>
            </button>
          )}

          <div className="absolute top-4 left-4 bg-black/60 text-white/90 px-3 py-1.5 rounded-full text-xs flex items-center gap-2 pointer-events-none z-20">
            <i className={`ph ${maskTool === 'polygon' ? 'ph-polygon' : 'ph-mouse'}`}></i>
            {maskTool === 'polygon' ? 'Click to outline · apply when ready' : 'Drag to select the removal area'}
          </div>

          {maskTool === 'polygon' && draftPoints.length > 0 && (
            <div
              className="absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/85 p-2 shadow-lg backdrop-blur"
              onPointerDown={event => event.stopPropagation()}
            >
              <span className="px-1 text-xs text-slate-300">{draftPoints.length} points</span>
              <button type="button" onClick={undoPolygonPoint} className="rounded px-2 py-1 text-xs text-white hover:bg-slate-700">Undo</button>
              <button
                type="button"
                onClick={applyPolygon}
                disabled={draftPoints.length < 3}
                className="rounded bg-primary px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
              >
                Apply mask
              </button>
              <button type="button" onClick={cancelPolygon} className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-700">Cancel</button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-[#1e293b] border-t border-slate-700 p-4 flex items-center gap-4 shrink-0 z-20">
        <button onClick={togglePlay} className="text-white hover:text-primary transition-colors focus:outline-none">
          {isPlaying ? <i className="ph-fill ph-pause text-2xl"></i> : <i className="ph-fill ph-play text-2xl"></i>}
        </button>
        <div className="flex-1 flex items-center">
          <input
            type="range"
            min="0"
            max={videoRef.current?.duration || 100}
            step="0.01"
            value={currentTime}
            onChange={(event) => {
              const value = parseFloat(event.target.value)
              videoRef.current.currentTime = value
              onTimeUpdate(value)
            }}
            className="w-full h-1.5 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-primary hover:h-2 transition-all"
          />
        </div>
        <button
          onClick={toggleFullscreen}
          className="text-white hover:text-primary transition-colors focus:outline-none"
          title="Toggle Fullscreen"
        >
          {isFullscreen ? <i className="ph-bold ph-corners-in text-2xl"></i> : <i className="ph-bold ph-corners-out text-2xl"></i>}
        </button>
      </div>
    </div>
  )
}
