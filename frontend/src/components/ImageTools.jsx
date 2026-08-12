import React, { useState, useRef } from 'react'
import SuperEditor from './SuperEditor'

export default function ImageTools({ onPreviewReady }) {
  const [files, setFiles] = useState([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

  const handleFileChange = (newFiles) => {
    const validFiles = Array.from(newFiles).filter(f => f.type.startsWith('image/'))
    if (validFiles.length > 0) {
      setFiles(validFiles)
    } else {
      alert("Please upload valid image files.")
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

  // If we have an image, launch the SuperEditor!
  if (files.length > 0) {
    return (
      <SuperEditor 
        file={files[0]} 
        onCancel={() => setFiles([])}
        onSave={(blob) => {
          const newFile = new File([blob], `renderfix_${Date.now()}.png`, { type: blob.type || 'image/png' })
          setFiles([newFile])
          alert("Image saved to your workspace!");
        }}
      />
    )
  }

  return (
    <main className="flex-1 flex flex-col p-8 bg-[#0f172a] overflow-hidden">
      <div className="flex items-center justify-between mb-8 shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <i className="ph-duotone ph-aperture text-primary text-4xl"></i>
            RenderFix Studio
          </h1>
          <p className="text-slate-400">The Ultimate AI-Powered Unified Editor.</p>
        </div>
      </div>

      <div 
        className={`flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-3xl transition-all duration-300 ${isDragging ? 'border-primary bg-primary/10' : 'border-slate-700 bg-slate-900/50 hover:bg-slate-800'}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input 
          type="file" 
          ref={fileInputRef}
          onChange={(e) => handleFileChange(e.target.files)}
          accept="image/*"
          className="hidden"
        />
        
        <div className="text-center">
          <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl relative">
            <i className="ph-duotone ph-upload-simple text-4xl text-primary animate-bounce"></i>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Upload an Image</h2>
          <p className="text-slate-400 mb-8 max-w-md mx-auto">
            Drag and drop an image here to launch the Super Editor, featuring local SAM masking and Nano-Banana AI inpainting.
          </p>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="primary-gradient text-white px-8 py-4 rounded-xl font-bold hover:shadow-[0_0_30px_rgba(99,102,241,0.5)] hover:-translate-y-1 transition-all flex items-center gap-2 mx-auto"
          >
            <i className="ph-bold ph-plus"></i> Browse Files
          </button>
        </div>
      </div>
    </main>
  )
}
