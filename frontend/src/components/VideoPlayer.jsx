import React, { useRef, useState, useEffect } from 'react'

export default function VideoPlayer({ src, videoRef, watermarkRegion, setWatermarkRegion, onTimeUpdate, onDurationChange, currentTime, isPlaying, setIsPlaying }) {
  const containerRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [startPos, setStartPos] = useState({ x: 0, y: 0 })
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 })
  const [renderRect, setRenderRect] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Calculate actual rendered video dimensions due to object-fit: contain
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
    const resizeObserver = new ResizeObserver(() => {
      setRenderRect(calculateRenderRect())
    })
    resizeObserver.observe(containerRef.current)
    
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    
    return () => {
      resizeObserver.disconnect()
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen().catch(err => console.error(err))
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen()
      }
    }
  }

  const handleLoadedMetadata = () => {
    onDurationChange(videoRef.current.duration)
    setRenderRect(calculateRenderRect())
  }

  const handleTimeUpdate = () => {
    onTimeUpdate(videoRef.current.currentTime)
  }

  const togglePlay = () => {
    if (videoRef.current.paused) {
      videoRef.current.play()
      setIsPlaying(true)
    } else {
      videoRef.current.pause()
      setIsPlaying(false)
    }
  }

  // --- Drawing Logic ---

  const getRelativeCoords = (e) => {
    const rect = videoRef.current.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }
  }

  const handleMouseDown = (e) => {
    const coords = getRelativeCoords(e)
    setIsDrawing(true)
    setStartPos(coords)
    setCurrentPos(coords)
    setWatermarkRegion(null) // clear previous
  }

  const handleMouseMove = (e) => {
    if (!isDrawing) return
    setCurrentPos(getRelativeCoords(e))
  }

  const handleMouseUp = () => {
    if (!isDrawing) return
    setIsDrawing(false)
    
    if (!renderRect) return

    // Calculate bounding box in CSS pixels
    const cssX = Math.min(startPos.x, currentPos.x)
    const cssY = Math.min(startPos.y, currentPos.y)
    const cssW = Math.abs(currentPos.x - startPos.x)
    const cssH = Math.abs(currentPos.y - startPos.y)

    // Ignore tiny accidental clicks
    if (cssW < 10 || cssH < 10) return

    // Map CSS pixels to Video pixels
    const mappedX = cssX - renderRect.xOffset
    const mappedY = cssY - renderRect.yOffset

    const scaleX = renderRect.vw / renderRect.renderWidth
    const scaleY = renderRect.vh / renderRect.renderHeight

    const finalX = Math.max(0, mappedX * scaleX)
    const finalY = Math.max(0, mappedY * scaleY)
    
    // Ensure we don't bleed out of the actual video boundaries
    const maxW = renderRect.vw - finalX
    const maxH = renderRect.vh - finalY
    
    const finalW = Math.min(maxW, cssW * scaleX)
    const finalH = Math.min(maxH, cssH * scaleY)

    if (finalW > 0 && finalH > 0) {
      setWatermarkRegion({ x: finalX, y: finalY, w: finalW, h: finalH })
    }
  }

  // Calculate CSS preview box for the drawn/saved region
  let previewBox = null
  if (isDrawing) {
    previewBox = {
      left: Math.min(startPos.x, currentPos.x),
      top: Math.min(startPos.y, currentPos.y),
      width: Math.abs(currentPos.x - startPos.x),
      height: Math.abs(currentPos.y - startPos.y)
    }
  } else if (watermarkRegion && renderRect) {
    // Map back from video pixels to CSS pixels
    const scaleX = renderRect.renderWidth / renderRect.vw
    const scaleY = renderRect.renderHeight / renderRect.vh
    
    previewBox = {
      left: (watermarkRegion.x * scaleX) + renderRect.xOffset,
      top: (watermarkRegion.y * scaleY) + renderRect.yOffset,
      width: watermarkRegion.w * scaleX,
      height: watermarkRegion.h * scaleY
    }
  }

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col bg-black overflow-hidden group">
      {/* Video and Drawing Area */}
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

        {/* Overlay for drawing */}
        <div 
          className="absolute inset-0 cursor-crosshair z-10"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          title="Click and drag to select watermark area"
        >
          {previewBox && (
            <div 
              className="absolute border-2 border-primary border-dashed bg-primary/20 backdrop-blur-md"
              style={{
                left: previewBox.left,
                top: previewBox.top,
                width: previewBox.width,
                height: previewBox.height
              }}
            >
              {/* Close button for watermark region */}
              {!isDrawing && watermarkRegion && (
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setWatermarkRegion(null);
                  }}
                  className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-lg hover:bg-red-600 transition-colors pointer-events-auto"
                >
                  <i className="ph ph-x text-sm"></i>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Help tooltip */}
        <div className="absolute top-4 left-4 bg-black/60 text-white/80 px-3 py-1.5 rounded-full text-xs flex items-center gap-2 pointer-events-none z-20">
          <i className="ph ph-mouse"></i>
          Drag to select watermark
        </div>
      </div>

      {/* Separate Video Controls Bar */}
      <div className="bg-[#1e293b] border-t border-slate-700 p-4 flex items-center gap-4 shrink-0 z-20">
        <button 
          onClick={togglePlay} 
          className="text-white hover:text-primary transition-colors focus:outline-none"
        >
          {isPlaying ? <i className="ph-fill ph-pause text-2xl"></i> : <i className="ph-fill ph-play text-2xl"></i>}
        </button>
        <div className="flex-1 flex items-center">
          <input 
            type="range" 
            min="0" 
            max={videoRef.current?.duration || 100} 
            step="0.01"
            value={currentTime}
            onChange={(e) => {
              const val = parseFloat(e.target.value)
              videoRef.current.currentTime = val
              onTimeUpdate(val)
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
