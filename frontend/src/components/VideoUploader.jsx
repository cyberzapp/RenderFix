import React, { useRef } from 'react'

export default function VideoUploader({ onUpload }) {
  const fileInputRef = useRef(null)

  const handleDragOver = (e) => {
    e.preventDefault()
    e.currentTarget.classList.add('bg-indigo-500/10')
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.currentTarget.classList.remove('bg-indigo-500/10')
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.currentTarget.classList.remove('bg-indigo-500/10')
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUpload(e.dataTransfer.files[0])
    }
  }

  const handleChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files[0])
    }
  }

  return (
    <div 
      className="w-full h-full flex flex-col items-center justify-center gap-4 p-8 cursor-pointer transition-all hover:bg-indigo-500/5 group"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
    >
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-primary text-4xl transition-transform duration-300 group-hover:scale-110 group-hover:bg-primary/20">
        <i className="ph ph-upload-simple"></i>
      </div>
      <h3 className="text-2xl font-semibold">Upload a Video</h3>
      <p className="text-slate-400">Drag & drop or click to browse</p>
      <p className="text-sm text-slate-500 -mt-2">Supports MP4, WebM, MOV</p>
      
      <input 
        type="file" 
        ref={fileInputRef}
        accept="video/*" 
        className="hidden"
        onChange={handleChange}
      />
    </div>
  )
}
