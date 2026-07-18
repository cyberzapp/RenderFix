import React, { useRef, useState, useEffect } from 'react'

export default function ImageCropper({ src, cropRegion, setCropRegion }) {
  const containerRef = useRef(null)
  const imgRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [startPos, setStartPos] = useState({ x: 0, y: 0 })
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 })
  const [renderRect, setRenderRect] = useState(null)

  const calculateRenderRect = () => {
    if (!imgRef.current) return null
    const img = imgRef.current
    
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    if (!nw || !nh) return null

    const cw = img.offsetWidth
    const ch = img.offsetHeight

    const imgRatio = nw / nh
    const elementRatio = cw / ch

    let renderWidth, renderHeight, xOffset, yOffset

    if (imgRatio > elementRatio) {
      renderWidth = cw
      renderHeight = cw / imgRatio
      xOffset = 0
      yOffset = (ch - renderHeight) / 2
    } else {
      renderHeight = ch
      renderWidth = ch * imgRatio
      xOffset = (cw - renderWidth) / 2
      yOffset = 0
    }

    return { renderWidth, renderHeight, xOffset, yOffset, nw, nh }
  }

  useEffect(() => {
    if (!containerRef.current) return
    const resizeObserver = new ResizeObserver(() => {
      setRenderRect(calculateRenderRect())
    })
    resizeObserver.observe(containerRef.current)
    return () => resizeObserver.disconnect()
  }, [])

  const handleLoaded = () => {
    setRenderRect(calculateRenderRect())
  }

  const getRelativeCoords = (e) => {
    const rect = imgRef.current.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }
  }

  const handleMouseDown = (e) => {
    if (!renderRect) return
    e.preventDefault()
    setIsDrawing(true)
    const coords = getRelativeCoords(e)
    setStartPos(coords)
    setCurrentPos(coords)
    setCropRegion(null)
  }

  const handleMouseMove = (e) => {
    if (!isDrawing || !renderRect) return
    setCurrentPos(getRelativeCoords(e))
  }

  const handleMouseUp = () => {
    if (!isDrawing || !renderRect) return
    setIsDrawing(false)

    // Calculate box
    const minX = Math.min(startPos.x, currentPos.x)
    const maxX = Math.max(startPos.x, currentPos.x)
    const minY = Math.min(startPos.y, currentPos.y)
    const maxY = Math.max(startPos.y, currentPos.y)

    // Ensure within render rect bounds
    const rx = Math.max(renderRect.xOffset, minX)
    const ry = Math.max(renderRect.yOffset, minY)
    const rw = Math.min(renderRect.xOffset + renderRect.renderWidth, maxX) - rx
    const rh = Math.min(renderRect.yOffset + renderRect.renderHeight, maxY) - ry

    if (rw > 10 && rh > 10) {
      // Map back to natural dimensions
      const scaleX = renderRect.nw / renderRect.renderWidth
      const scaleY = renderRect.nh / renderRect.renderHeight
      
      const sourceX = (rx - renderRect.xOffset) * scaleX
      const sourceY = (ry - renderRect.yOffset) * scaleY
      const sourceW = rw * scaleX
      const sourceH = rh * scaleY

      setCropRegion({
        x: Math.round(sourceX),
        y: Math.round(sourceY),
        w: Math.round(sourceW),
        h: Math.round(sourceH)
      })
    }
  }

  // Draw the current dragging box visually
  const getDrawingStyle = () => {
    if (!isDrawing) return { display: 'none' }
    const x = Math.min(startPos.x, currentPos.x)
    const y = Math.min(startPos.y, currentPos.y)
    const w = Math.abs(currentPos.x - startPos.x)
    const h = Math.abs(currentPos.y - startPos.y)
    
    return {
      left: x,
      top: y,
      width: w,
      height: h,
      border: '2px solid #6366f1',
      backgroundColor: 'rgba(99, 102, 241, 0.2)'
    }
  }

  // Draw the finalized crop box
  const getCropStyle = () => {
    if (!cropRegion || !renderRect) return { display: 'none' }
    
    const scaleX = renderRect.renderWidth / renderRect.nw
    const scaleY = renderRect.renderHeight / renderRect.nh
    
    const rx = cropRegion.x * scaleX + renderRect.xOffset
    const ry = cropRegion.y * scaleY + renderRect.yOffset
    const rw = cropRegion.w * scaleX
    const rh = cropRegion.h * scaleY

    return {
      left: rx,
      top: ry,
      width: rw,
      height: rh,
      border: '2px solid #10b981',
      backgroundColor: 'rgba(16, 185, 129, 0.2)',
      boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)'
    }
  }

  return (
    <div 
      ref={containerRef}
      className="w-full h-full relative cursor-crosshair overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <img 
        ref={imgRef}
        src={src} 
        onLoad={handleLoaded}
        className="w-full h-full object-contain pointer-events-none" 
        alt="Preview" 
      />
      
      {/* Overlay for completed crop */}
      {cropRegion && !isDrawing && (
        <div className="absolute pointer-events-none transition-all" style={getCropStyle()}>
          <div className="absolute -top-6 left-0 bg-emerald-500 text-white text-[10px] px-1.5 py-0.5 rounded shadow whitespace-nowrap">
            Cropped: {cropRegion.w}x{cropRegion.h}
          </div>
        </div>
      )}

      {/* Overlay for actively drawing */}
      {isDrawing && (
        <div className="absolute pointer-events-none" style={getDrawingStyle()}></div>
      )}
      
      {/* Help text */}
      {!cropRegion && !isDrawing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 backdrop-blur-md text-white/70 px-4 py-2 rounded-full text-sm flex items-center gap-2">
            <i className="ph ph-crop"></i>
            Click and drag to crop
          </div>
        </div>
      )}
    </div>
  )
}
