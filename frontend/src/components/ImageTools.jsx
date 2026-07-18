import React, { useState, useRef, useEffect } from 'react'
import { saveAs } from 'file-saver'
import ImageCropper from './ImageCropper'
import RefineModal from './RefineModal'

export default function ImageTools({ onPreviewReady }) {
  const [files, setFiles] = useState([])
  const [showRefine, setShowRefine] = useState(false)
  const [previewUrls, setPreviewUrls] = useState([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [cropRegion, setCropRegion] = useState(null)
  const [removeBg, setRemoveBg] = useState(false)

  // Options
  const [format, setFormat] = useState('image/png')
  const [resizeMode, setResizeMode] = useState('scale') // 'scale' or 'exact'
  const [scale, setScale] = useState(1.0)

  // Exact size options
  const [unit, setUnit] = useState('px')
  const [targetW, setTargetW] = useState(1920)
  const [targetH, setTargetH] = useState(1080)
  const [isRatioLocked, setIsRatioLocked] = useState(true)
  const [dpi, setDpi] = useState(300)

  // Compression options
  const [compressMode, setCompressMode] = useState('quality') // 'quality' or 'target'
  const [quality, setQuality] = useState(100)
  const [targetSize, setTargetSize] = useState(500)
  const [targetSizeUnit, setTargetSizeUnit] = useState('KB')
  const [fileDimensions, setFileDimensions] = useState(null) // {w, h}

  const [pages, setPages] = useState('all')
  const fileInputRef = useRef(null)

  useEffect(() => {
    const urls = files.map(f => f.type.startsWith('image/') ? URL.createObjectURL(f) : 'pdf')
    setPreviewUrls(urls)
    setActiveIndex(0)
    
    return () => {
      urls.forEach(url => {
        if (url !== 'pdf') URL.revokeObjectURL(url)
      })
    }
  }, [files])

  const handleFileChange = (newFiles) => {
    const validFiles = Array.from(newFiles).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
    
    if (validFiles.length > 0) {
      setFiles(validFiles)
      setFileDimensions(null)
      setCropRegion(null)
      
      const firstFile = validFiles[0]
      if (firstFile.type.startsWith('image/')) {
        const url = URL.createObjectURL(firstFile)

        const img = new Image()
        img.onload = () => {
          setFileDimensions({ w: img.naturalWidth, h: img.naturalHeight })
          setTargetW(img.naturalWidth)
          setTargetH(img.naturalHeight)
          URL.revokeObjectURL(url)
        }
        img.src = url
      } else {
        setTargetW(800)
        setTargetH(1131)
      }
    } else {
      alert("Please upload valid image or PDF files.")
    }
  }

  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") setIsDragging(true)
    else if (e.type === "dragleave") setIsDragging(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange(e.dataTransfer.files)
    }
  }

  const handleProcess = async () => {
    if (files.length === 0) return
    setIsProcessing(true)

    const formData = new FormData()
    files.forEach(f => formData.append('files', f))
    formData.append('format', format)
    formData.append('remove_bg', removeBg)

    if (compressMode === 'quality') {
      formData.append('quality', quality)
    } else {
      let bytes = targetSize
      if (targetSizeUnit === 'KB') bytes = targetSize * 1024
      if (targetSizeUnit === 'MB') bytes = targetSize * 1024 * 1024
      formData.append('target_bytes', Math.floor(bytes))
    }

    if (resizeMode === 'scale') {
      formData.append('scale', scale)
    } else {
      let finalW = targetW
      let finalH = targetH

      if (unit === 'in') {
        finalW = Math.round(targetW * dpi)
        finalH = Math.round(targetH * dpi)
      } else if (unit === 'cm') {
        finalW = Math.round((targetW / 2.54) * dpi)
        finalH = Math.round((targetH / 2.54) * dpi)
      }

      formData.append('target_w', finalW)
      formData.append('target_h', finalH)
    }

    if (files.some(f => f.type === 'application/pdf')) {
      formData.append('pages', pages)
    }

    if (cropRegion && files.length === 1 && !files[0].type.startsWith('application/pdf')) {
      formData.append('crop_x', cropRegion.x)
      formData.append('crop_y', cropRegion.y)
      formData.append('crop_w', cropRegion.w)
      formData.append('crop_h', cropRegion.h)
    }

    try {
      const response = await fetch('http://localhost:8000/api/image/process', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || "Failed to process")
      }

      const blob = await response.blob()

      if (blob.type === 'application/zip') {
        const filename = files.length > 1 ? 'batch_processed.zip' : 'pdf_pages.zip';
        saveAs(blob, filename)
      } else {
        const ext = format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png'
        const filename = files[0].name.startsWith('processed_') ? files[0].name : `processed_${files[0].name.split('.')[0]}.${ext}`
        
        // Update the current file directly instead of opening preview modal
        const newFile = new File([blob], filename, { type: blob.type })
        setFiles([newFile])
      }
    } catch (err) {
      alert(err.message)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <main className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 animate-fade-in-up">
      <section className="flex flex-col">
        <div className="glass-card aspect-video relative overflow-hidden flex items-center justify-center transition-all duration-300 hover:border-primary hover:shadow-[0_0_20px_rgba(99,102,241,0.3)]">
          {files.length === 0 ? (
            <div
              className={`w-full h-full flex flex-col items-center justify-center border-2 border-dashed rounded-2xl transition-colors cursor-pointer ${isDragging ? 'border-primary bg-primary/10' : 'border-slate-700 hover:border-slate-500 hover:bg-slate-800/50'
                }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                multiple
                className="hidden"
                ref={fileInputRef}
                onChange={(e) => handleFileChange(e.target.files)}
                accept="image/*,.pdf"
              />
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-primary text-4xl transition-transform duration-300 group-hover:scale-110 group-hover:bg-primary/20">
                <i className="ph-duotone ph-image text-5xl text-primary"></i>
              </div>
              <h3 className="text-2xl font-semibold text-white mb-2">Upload Images or PDFs</h3>
              <p className="text-slate-400">Drag & drop or click to browse</p>
              <p className="text-sm text-slate-500 mt-2">Supports multiple PNG, JPG, WebP, PDF</p>
            </div>
          ) : (
            <div className="w-full h-full relative group flex flex-col">
              <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-black">
                {previewUrls[activeIndex] === 'pdf' ? (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-slate-800/50">
                    <i className="ph-duotone ph-file-pdf text-6xl text-red-400 mb-4"></i>
                    <p className="text-xl font-medium text-white">{files[activeIndex].name}</p>
                  </div>
                ) : (
                  <>
                    {files.length === 1 ? (
                      <ImageCropper src={previewUrls[activeIndex]} cropRegion={cropRegion} setCropRegion={setCropRegion} />
                    ) : (
                      <img src={previewUrls[activeIndex]} className="w-full h-full object-contain" alt="Preview" />
                    )}
                  </>
                )}
              </div>
              
              {/* Thumbnail Strip */}
              {files.length > 1 && (
                <div className="h-24 bg-slate-900 border-t border-slate-800 flex items-center gap-3 px-4 overflow-x-auto shrink-0 z-10 custom-scrollbar">
                  {files.map((file, idx) => (
                    <button 
                      key={idx} 
                      onClick={() => setActiveIndex(idx)}
                      className={`h-16 w-16 shrink-0 rounded-lg overflow-hidden border-2 transition-all ${idx === activeIndex ? 'border-primary shadow-[0_0_10px_rgba(99,102,241,0.5)]' : 'border-transparent opacity-50 hover:opacity-100'}`}
                    >
                      {previewUrls[idx] === 'pdf' ? (
                        <div className="w-full h-full bg-slate-800 flex flex-col items-center justify-center p-1">
                          <i className="ph-fill ph-file-pdf text-red-400 text-xl"></i>
                          <span className="text-[8px] text-slate-400 mt-1 truncate w-full px-1 text-center font-medium leading-tight">{file.name}</span>
                        </div>
                      ) : (
                        <img src={previewUrls[idx]} className="w-full h-full object-cover" alt="thumb" />
                      )}
                    </button>
                  ))}
                </div>
              )}
              
              <div className="absolute top-4 right-4 flex gap-2 z-10">
                {previewUrls[activeIndex] !== 'pdf' && (
                  <button
                    onClick={() => saveAs(files[activeIndex], files[activeIndex].name)}
                    className="bg-black/60 text-white rounded-full w-10 h-10 flex items-center justify-center hover:bg-primary transition-colors shadow-lg"
                    title="Download Image"
                  >
                    <i className="ph-bold ph-download-simple text-lg"></i>
                  </button>
                )}
                <button
                  onClick={() => {
                    setFiles([])
                  }}
                  className="bg-black/60 text-white rounded-full w-10 h-10 flex items-center justify-center hover:bg-red-500 transition-colors shadow-lg"
                  title="Remove File"
                >
                  <i className="ph-bold ph-x text-lg"></i>
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-6 h-[calc(100vh-200px)] lg:h-auto">
        <div className="glass-card p-6 flex flex-col gap-6 overflow-y-auto h-full max-h-[80vh]">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-white shrink-0">
            <i className="ph-duotone ph-faders text-primary"></i>
            Image Settings
          </h2>

          <div className="flex flex-col gap-3 bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 shrink-0 cursor-pointer transition-colors hover:border-primary/50 hover:bg-slate-800/80" onClick={() => setRemoveBg(!removeBg)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${removeBg ? 'bg-primary text-white shadow-[0_0_15px_rgba(99,102,241,0.5)]' : 'bg-slate-700 text-slate-400'}`}>
                  <i className="ph-duotone ph-magic-wand text-xl"></i>
                </div>
                <div>
                  <h3 className="font-semibold text-white">AI Background Removal</h3>
                  <p className="text-xs text-slate-400">High-quality U2-Net cutout</p>
                </div>
              </div>
              <div className={`w-12 h-6 rounded-full transition-colors relative ${removeBg ? 'bg-primary' : 'bg-slate-700'}`}>
                <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${removeBg ? 'translate-x-6' : 'translate-x-0'}`}></div>
              </div>
            </div>
            {removeBg && (
              <div className="mt-2 text-xs text-primary bg-primary/10 border border-primary/20 p-2 rounded-lg">
                <i className="ph-fill ph-info mr-1"></i>
                Forces output to PNG to preserve transparency. First run will download the AI model.
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 shrink-0 cursor-pointer transition-colors hover:border-primary/50 hover:bg-slate-800/80" onClick={() => {
            if (files.length === 0) {
               alert("Please upload an image first!");
               return;
            }
            setShowRefine(true);
          }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center transition-colors bg-indigo-600 text-white shadow-[0_0_15px_rgba(79,70,229,0.5)]">
                  <i className="ph-duotone ph-sparkle text-xl"></i>
                </div>
                <div>
                  <h3 className="font-semibold text-white">Generative AI / Inpaint</h3>
                  <p className="text-xs text-slate-400">Change outfits, replace objects, or refine mask</p>
                </div>
              </div>
              <i className="ph-bold ph-caret-right text-slate-400"></i>
            </div>
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            <label className="font-medium text-slate-400 text-sm">Target Format</label>
            <div className="relative">
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="w-full bg-dark border border-slate-700 rounded-lg py-3 px-4 text-white appearance-none focus:outline-none focus:border-primary transition-colors"
              >
                <option value="image/jpeg">JPEG (Smaller Size)</option>
                <option value="image/png">PNG (High Quality)</option>
                <option value="image/webp">WebP (Modern)</option>
              </select>
              <i className="ph ph-caret-down absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"></i>
            </div>
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            <label className="font-medium text-slate-400 text-sm">Resize Method</label>
            <div className="flex bg-slate-800/50 p-1 rounded-xl border border-slate-700/50">
              <button
                onClick={() => setResizeMode('scale')}
                className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-all ${resizeMode === 'scale' ? 'bg-primary text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
              >
                By Scale
              </button>
              <button
                onClick={() => setResizeMode('exact')}
                className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-all ${resizeMode === 'exact' ? 'bg-primary text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
              >
                Exact Size
              </button>
            </div>
          </div>

          {resizeMode === 'scale' ? (
            <div className="flex flex-col gap-2 shrink-0">
              <label className="flex items-center justify-between font-medium text-slate-400 text-sm">
                Resolution Scale
                <span className="text-primary">{scale}x</span>
              </label>
              <input
                type="range"
                min="0.1" max="4.0" step="0.1"
                value={scale}
                onChange={(e) => setScale(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <p className="text-xs text-slate-500">Scale the dimensions up or down using Lanczos interpolation.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4 bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 shrink-0">
              <div className="flex items-end gap-2">
                <div className="flex-1 flex flex-col gap-2">
                  <label className="font-medium text-slate-400 text-xs">Width</label>
                  <input 
                    type="number" 
                    value={targetW} 
                    onChange={e => {
                      const newW = parseFloat(e.target.value) || 0
                      setTargetW(newW)
                      if (isRatioLocked) {
                        const ratio = fileDimensions ? (fileDimensions.w / fileDimensions.h) : (800 / 1131)
                        setTargetH(Math.round(newW / ratio))
                      }
                    }} 
                    className="w-full bg-dark border border-slate-700 rounded-lg py-2 px-3 text-white focus:outline-none focus:border-primary" 
                  />
                </div>
                
                <button 
                  onClick={() => setIsRatioLocked(!isRatioLocked)}
                  className={`flex-none w-10 h-[42px] mb-[2px] rounded-lg flex items-center justify-center transition-colors ${isRatioLocked ? 'bg-primary/20 text-primary' : 'bg-slate-700 text-slate-400 hover:text-white'}`}
                  title={isRatioLocked ? "Unlock Aspect Ratio" : "Lock Aspect Ratio"}
                >
                  {isRatioLocked ? <i className="ph-fill ph-link"></i> : <i className="ph ph-link-break"></i>}
                </button>

                <div className="flex-1 flex flex-col gap-2">
                  <label className="font-medium text-slate-400 text-xs">Height</label>
                  <input 
                    type="number" 
                    value={targetH} 
                    onChange={e => {
                      const newH = parseFloat(e.target.value) || 0
                      setTargetH(newH)
                      if (isRatioLocked) {
                        const ratio = fileDimensions ? (fileDimensions.w / fileDimensions.h) : (800 / 1131)
                        setTargetW(Math.round(newH * ratio))
                      }
                    }} 
                    className="w-full bg-dark border border-slate-700 rounded-lg py-2 px-3 text-white focus:outline-none focus:border-primary" 
                  />
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1 flex flex-col gap-2">
                  <label className="font-medium text-slate-400 text-xs">Unit</label>
                  <select value={unit} onChange={e => setUnit(e.target.value)} className="w-full bg-dark border border-slate-700 rounded-lg py-2 px-3 text-white focus:outline-none focus:border-primary appearance-none">
                    <option value="px">Pixels (px)</option>
                    <option value="in">Inches (in)</option>
                    <option value="cm">Centimeters (cm)</option>
                  </select>
                </div>
                {(unit === 'in' || unit === 'cm') && (
                  <div className="flex-1 flex flex-col gap-2">
                    <label className="font-medium text-slate-400 text-xs">DPI</label>
                    <input type="number" value={dpi} onChange={e => setDpi(parseFloat(e.target.value) || 300)} className="w-full bg-dark border border-slate-700 rounded-lg py-2 px-3 text-white focus:outline-none focus:border-primary" />
                  </div>
                )}
              </div>
            </div>
          )}

          {format !== 'image/png' && (
            <div className="flex flex-col gap-2 shrink-0">
              <label className="font-medium text-slate-400 text-sm">Compression Method</label>
              <div className="flex bg-slate-800/50 p-1 rounded-xl border border-slate-700/50">
                <button
                  onClick={() => setCompressMode('quality')}
                  className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-all ${compressMode === 'quality' ? 'bg-primary text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                >
                  By Quality
                </button>
                <button
                  onClick={() => setCompressMode('target')}
                  className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-all ${compressMode === 'target' ? 'bg-primary text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                >
                  Exact File Size
                </button>
              </div>
            </div>
          )}

          {(format === 'image/jpeg' || format === 'image/webp') && compressMode === 'quality' && (
            <div className="flex flex-col gap-2 shrink-0">
              <label className="flex items-center justify-between font-medium text-slate-400 text-sm">
                Quality (Compression)
                <span className="text-primary">{quality}%</span>
              </label>
              <input
                type="range"
                min="10" max="100" step="1"
                value={quality}
                onChange={(e) => setQuality(parseInt(e.target.value))}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>
          )}

          {(format === 'image/jpeg' || format === 'image/webp') && compressMode === 'target' && (
            <div className="flex flex-col gap-4 bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 shrink-0">
              <div className="flex gap-4">
                <div className="flex-1 flex flex-col gap-2">
                  <label className="font-medium text-slate-400 text-xs">Target Size</label>
                  <input type="number" value={targetSize} onChange={e => setTargetSize(parseFloat(e.target.value) || 0)} className="w-full bg-dark border border-slate-700 rounded-lg py-2 px-3 text-white focus:outline-none focus:border-primary" />
                </div>
                <div className="flex-1 flex flex-col gap-2">
                  <label className="font-medium text-slate-400 text-xs">Unit</label>
                  <select value={targetSizeUnit} onChange={e => setTargetSizeUnit(e.target.value)} className="w-full bg-dark border border-slate-700 rounded-lg py-2 px-3 text-white focus:outline-none focus:border-primary appearance-none">
                    <option value="B">Bytes (B)</option>
                    <option value="KB">Kilobytes (KB)</option>
                    <option value="MB">Megabytes (MB)</option>
                  </select>
                </div>
              </div>

              {/* BPP Warning Logic */}
              {(() => {
                let bytes = targetSize
                if (targetSizeUnit === 'KB') bytes = targetSize * 1024
                if (targetSizeUnit === 'MB') bytes = targetSize * 1024 * 1024

                // Estimate dimensions
                let w = targetW
                let h = targetH
                if (resizeMode === 'scale') {
                  if (fileDimensions) {
                    w = fileDimensions.w * scale
                    h = fileDimensions.h * scale
                  } else {
                    w = 1920 * scale // arbitrary fallback
                    h = 1080 * scale
                  }
                } else if (unit === 'in') {
                  w = targetW * dpi
                  h = targetH * dpi
                } else if (unit === 'cm') {
                  w = (targetW / 2.54) * dpi
                  h = (targetH / 2.54) * dpi
                }

                const bpp = (bytes * 8) / (w * h)

                if (bpp > 0 && bpp < 0.5) {
                  return (
                    <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 flex gap-3 text-red-200 text-sm items-start shrink-0">
                      <i className="ph-fill ph-warning-circle text-red-400 text-lg shrink-0 mt-0.5"></i>
                      <p>
                        <strong>Warning: Quality loss!</strong><br />
                        At this size ({bpp.toFixed(2)} bits/pixel), the image will suffer from severe compression artifacts and blurriness. Consider increasing the target size or lowering the resolution.
                      </p>
                    </div>
                  )
                }
                return null
              })()}
            </div>
          )}

          {files.some(f => f.type === 'application/pdf') && (
            <div className="flex flex-col gap-2 bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 shrink-0">
              <label className="font-medium text-slate-300 text-sm flex items-center gap-2">
                <i className="ph-duotone ph-files text-primary"></i>
                Pages to Extract
              </label>
              <input
                type="text"
                value={pages}
                onChange={(e) => setPages(e.target.value)}
                placeholder="e.g. all, 1, 1-3, 5"
                className="w-full bg-dark border border-slate-700 rounded-lg py-3 px-4 text-white focus:outline-none focus:border-primary transition-colors mt-1"
              />
              <p className="text-xs text-slate-400 mt-1">Specify "all" or specific pages like "1, 3-5". Multiple pages will download as a ZIP file.</p>
            </div>
          )}

          <div className="h-px bg-slate-700 w-full my-2 shrink-0"></div>

          <button
            onClick={handleProcess}
            disabled={files.length === 0 || isProcessing}
            className="w-full h-12 flex-none py-3.5 px-4 primary-gradient hover:-translate-y-1 text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(99,102,241,0.2)] hover:shadow-[0_0_25px_rgba(99,102,241,0.4)] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none mt-auto"
          >
            {isProcessing ? (
              <i className="ph ph-spinner animate-spin text-xl"></i>
            ) : (
              <>
                <i className="ph-duotone ph-magic-wand text-xl"></i>
                Process File
              </>
            )}
          </button>
        </div>
      </section>

      {showRefine && previewUrls.length > 0 && (
        <RefineModal 
          imageUrl={previewUrls[activeIndex]} 
          onClose={() => setShowRefine(false)}
          onSave={(blob) => {
            setShowRefine(false);
            const newFile = new File([blob], `refined_${files[activeIndex].name}`, { type: blob.type })
            setFiles([newFile])
          }}
        />
      )}
    </main>
  )
}
