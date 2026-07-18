import React, { useState } from 'react'

export default function Controls({ onExportSingle, onExportMultiple, onExportVideo, isProcessing, hasVideo, duration, currentTime, isPlaying, isUpscale, setIsUpscale, onTogglePlay, onSeek }) {
  const [fps, setFps] = useState(1.0)
  const [format, setFormat] = useState('image/png')
  const [videoFormat, setVideoFormat] = useState('video/mp4')
  
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [watermarkText, setWatermarkText] = useState('')
  const [watermarkPosition, setWatermarkPosition] = useState('bottom-right')

  const formatTime = (seconds) => {
    if (isNaN(seconds)) return "00:00"
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = Math.floor(seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  return (
    <div className="glass-card p-6 flex flex-col gap-6">
      <h2 className="flex items-center gap-2 text-xl font-semibold text-white">
        <i className="ph-duotone ph-aperture text-primary"></i>
        Video Settings
      </h2>

      {/* Playback Controls */}
      <div className="flex items-center gap-4 bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
        <button 
          onClick={onTogglePlay}
          disabled={!hasVideo}
          className="w-12 h-12 flex items-center justify-center bg-slate-700/50 rounded-full text-white hover:bg-primary hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {isPlaying ? <i className="ph-fill ph-pause text-xl"></i> : <i className="ph-fill ph-play text-xl ml-1"></i>}
        </button>
        
        <div className="flex-1 flex flex-col gap-2">
          <input 
            type="range" 
            min="0" 
            max={duration || 100} 
            step="0.01"
            value={currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            disabled={!hasVideo}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <div className="flex justify-between text-xs font-medium text-slate-400 tabular-nums">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>
      
      <div className="h-px bg-slate-700 w-full"></div>
      
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 font-medium text-slate-400 text-sm">
          Frames Per Second (FPS)
          <span className="text-primary cursor-help" title="Determines how many frames to extract per second of video.">
            <i className="ph ph-info"></i>
          </span>
        </label>
        <div className="flex items-center gap-4">
          <input 
            type="range" 
            min="0.1" max="60" step="0.1" 
            value={fps} 
            onChange={(e) => setFps(parseFloat(e.target.value))}
            className="flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <div className="bg-primary/10 text-primary px-3 py-1 rounded-md font-semibold min-w-[80px] text-center text-sm">
            {fps.toFixed(1)} FPS
          </div>
        </div>
      </div>
      
      <div className="flex flex-col gap-2">
        <label className="font-medium text-slate-400 text-sm">Image Format</label>
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

      {/* Upscale Toggle */}
      <div className="flex items-center justify-between bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
        <div className="flex flex-col">
          <span className="font-semibold text-white flex items-center gap-2">
            <i className="ph-duotone ph-arrows-out-simple text-primary"></i>
            Lanczos 2x Upscale
          </span>
          <span className="text-xs text-slate-400">Enhance resolution of exported files</span>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input 
            type="checkbox" 
            className="sr-only peer" 
            checked={isUpscale}
            onChange={(e) => setIsUpscale(e.target.checked)}
          />
          <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
        </label>
      </div>

      <div className="h-px bg-slate-700 w-full"></div>
      
      {/* Trimming & Watermarking */}
      <div className="flex flex-col gap-4 bg-slate-800/30 p-4 rounded-xl border border-slate-700/30">
        <h3 className="font-semibold text-slate-300 text-sm">Trim Range (Optional)</h3>
        <div className="flex gap-4">
          <div className="flex-1 flex flex-col gap-2">
            <label className="text-xs text-slate-400">Start Time (sec)</label>
            <input 
              type="number" 
              placeholder="0.0"
              min="0"
              step="0.1"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full bg-dark border border-slate-700 rounded-lg py-2 px-3 text-white focus:outline-none focus:border-primary text-sm"
            />
          </div>
          <div className="flex-1 flex flex-col gap-2">
            <label className="text-xs text-slate-400">End Time (sec)</label>
            <input 
              type="number" 
              placeholder={duration ? duration.toFixed(1) : "End"}
              min="0"
              step="0.1"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full bg-dark border border-slate-700 rounded-lg py-2 px-3 text-white focus:outline-none focus:border-primary text-sm"
            />
          </div>
        </div>

        <h3 className="font-semibold text-slate-300 text-sm mt-2">Add Watermark (Optional)</h3>
        <div className="flex flex-col gap-3">
          <input 
            type="text" 
            placeholder="Watermark Text"
            value={watermarkText}
            onChange={(e) => setWatermarkText(e.target.value)}
            className="w-full bg-dark border border-slate-700 rounded-lg py-2 px-3 text-white focus:outline-none focus:border-primary text-sm"
          />
          <select 
            value={watermarkPosition}
            onChange={(e) => setWatermarkPosition(e.target.value)}
            className="w-full bg-dark border border-slate-700 rounded-lg py-2 px-3 text-white appearance-none focus:outline-none focus:border-primary text-sm"
          >
            <option value="bottom-right">Bottom Right</option>
            <option value="bottom-left">Bottom Left</option>
            <option value="top-right">Top Right</option>
            <option value="top-left">Top Left</option>
            <option value="center">Center</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-4 mt-2">
        <button 
          onClick={() => onExportSingle(format)}
          disabled={!hasVideo || isProcessing}
          className="flex items-center justify-center gap-2 w-full py-3 px-6 rounded-lg font-semibold transition-all border border-slate-700 hover:bg-slate-700/50 hover:border-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? <i className="ph-duotone ph-spinner-gap animate-spin"></i> : <i className="ph ph-image"></i>}
          Export Current Frame
        </button>
        <button 
          onClick={() => onExportMultiple(fps, format, { startTime, endTime, watermarkText, watermarkPosition })}
          disabled={!hasVideo || isProcessing}
          className="primary-gradient flex items-center justify-center gap-2 w-full py-3 px-6 rounded-lg font-semibold transition-transform hover:-translate-y-1 shadow-[0_4px_15px_rgba(99,102,241,0.4)] hover:shadow-[0_6px_20px_rgba(99,102,241,0.6)] disabled:opacity-50 disabled:transform-none disabled:cursor-not-allowed"
        >
          {isProcessing ? <i className="ph-duotone ph-spinner-gap animate-spin"></i> : <i className="ph ph-files"></i>}
          {isProcessing ? "Processing via AI..." : "Export Multiple Frames (ZIP)"}
        </button>
        
        <div className="flex gap-2">
          <select 
            value={videoFormat} 
            onChange={(e) => setVideoFormat(e.target.value)}
            className="w-1/3 bg-slate-800 border border-slate-700 rounded-lg py-3 px-3 text-white appearance-none focus:outline-none focus:border-primary text-sm transition-colors"
          >
            <option value="video/mp4">MP4</option>
            <option value="image/gif">GIF</option>
          </select>
          <button 
            onClick={() => onExportVideo(videoFormat, { startTime, endTime, watermarkText, watermarkPosition })}
            disabled={!hasVideo || isProcessing}
            className="w-2/3 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {isProcessing ? <i className="ph-duotone ph-spinner-gap animate-spin"></i> : <i className="ph ph-video-camera"></i>}
            {isProcessing ? "Processing..." : `Export ${videoFormat === 'image/gif' ? 'GIF' : 'Video'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
