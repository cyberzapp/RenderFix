import React, { useEffect, useState, useRef } from 'react';
import { saveAs } from 'file-saver';

export default function PreviewModal({ blob, filename, originalFile, onClose }) {
  const [url, setUrl] = useState(null);
  const [originalUrl, setOriginalUrl] = useState(null);
  const [sliderPos, setSliderPos] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (blob) {
      const objUrl = URL.createObjectURL(blob);
      setUrl(objUrl);
      return () => URL.revokeObjectURL(objUrl);
    }
  }, [blob]);

  useEffect(() => {
    if (originalFile && originalFile.type.startsWith('image/')) {
      const objUrl = URL.createObjectURL(originalFile);
      setOriginalUrl(objUrl);
      return () => URL.revokeObjectURL(objUrl);
    }
  }, [originalFile]);

  if (!blob || !url) return null;

  const isImage = blob.type.startsWith('image/') && blob.type !== 'image/gif';
  const isGif = blob.type === 'image/gif';
  const isVideo = blob.type.startsWith('video/');
  const isZip = blob.type === 'application/zip';

  const handleDownload = () => {
    saveAs(blob, filename);
    onClose();
  };

  const handleMove = (e) => {
    if (!isDragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const x = clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPos(percent);
  };

  const stopDrag = () => setIsDragging(false);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', stopDrag);
      window.addEventListener('touchmove', handleMove, { passive: false });
      window.addEventListener('touchend', stopDrag);
      return () => {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', stopDrag);
        window.removeEventListener('touchmove', handleMove);
        window.removeEventListener('touchend', stopDrag);
      };
    }
  }, [isDragging]);

  const showCompare = isImage && originalUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <i className="ph-duotone ph-eye text-primary"></i>
            {showCompare ? "Compare Before / After" : "Preview Result"}
          </h2>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center transition-colors text-slate-400 hover:text-white"
          >
            <i className="ph ph-x"></i>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden p-6 flex items-center justify-center bg-black/60 relative select-none">
          {showCompare && (
            <div 
              ref={containerRef}
              className="relative max-w-full max-h-[70vh] flex items-center justify-center shadow-2xl rounded-lg overflow-hidden group"
              onMouseDown={() => setIsDragging(true)}
              onTouchStart={() => setIsDragging(true)}
            >
              {/* Background pattern to show transparency */}
              <div className="absolute inset-0 z-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+PHJlY3Qgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjMmUyZTMzIiAvPjxyZWN0IHg9IjEwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiMzZjNmNDYiIC8+PHJlY3QgeT0iMTAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iIzNmM2Y0NiIgLz48cmVjdCB4PSIxMCIgeT0iMTAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iIzJlMmUzMyIgLz48L3N2Zz4=')] bg-repeat" />

              {/* Processed Image (After) - Base */}
              <img 
                src={url} 
                className="max-h-[70vh] max-w-[100%] block object-contain relative z-10 opacity-100 transition-opacity" 
                alt="Processed" 
                draggable="false"
              />

              {/* Original Image (Before) - Clipped on top */}
              <div 
                className="absolute inset-0 z-20 overflow-hidden" 
                style={{ width: `${sliderPos}%` }}
              >
                <img 
                  src={originalUrl} 
                  className="max-h-[70vh] max-w-none block object-contain absolute top-0 left-0 h-full" 
                  alt="Original"
                  draggable="false"
                  onLoad={(e) => {
                     e.target.style.width = `${containerRef.current?.getBoundingClientRect().width}px`;
                  }}
                />
              </div>

              {/* Slider Line */}
              <div 
                className="absolute top-0 bottom-0 z-30 w-1 bg-white cursor-ew-resize flex items-center justify-center transition-all hover:bg-primary"
                style={{ left: `calc(${sliderPos}% - 2px)` }}
              >
                <div className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center shadow-lg transform -translate-x-1/2">
                  <i className="ph-bold ph-arrows-left-right text-sm"></i>
                </div>
              </div>

              {/* Labels */}
              <div className="absolute bottom-4 left-4 z-40 bg-black/70 backdrop-blur text-white px-3 py-1 rounded text-sm font-semibold pointer-events-none shadow-md">
                Before
              </div>
              <div className="absolute bottom-4 right-4 z-40 bg-black/70 backdrop-blur text-white px-3 py-1 rounded text-sm font-semibold pointer-events-none shadow-md">
                After
              </div>
            </div>
          )}

          {!showCompare && (isImage || isGif) && (
            <img 
              src={url} 
              alt="Processed Preview" 
              className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-2xl border border-slate-700/50"
            />
          )}

          {isVideo && (
            <video 
              src={url} 
              controls 
              autoPlay
              loop
              className="max-w-full max-h-[70vh] rounded-lg shadow-2xl border border-slate-700/50"
            />
          )}

          {isZip && (
            <div className="flex flex-col items-center justify-center text-center p-12 bg-slate-800/50 rounded-2xl border border-slate-700/50">
              <div className="w-28 h-28 rounded-full bg-primary/20 flex items-center justify-center text-primary text-6xl mb-6 shadow-[0_0_30px_rgba(99,102,241,0.3)]">
                <i className="ph-duotone ph-file-zip"></i>
              </div>
              <h3 className="text-3xl font-bold text-white mb-3">Batch Process Complete</h3>
              <p className="text-slate-400 max-w-md text-lg">
                Your files have been successfully processed and packaged into a ZIP archive.
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-800/30 flex items-center justify-between">
          <div className="text-sm text-slate-400 flex items-center gap-2">
            <i className="ph-fill ph-file text-slate-500"></i>
            {filename}
            <span className="text-slate-600 font-mono">
              ({(blob.size / 1024 / 1024).toFixed(2)} MB)
            </span>
          </div>
          
          <div className="flex gap-3">
            <button 
              onClick={onClose}
              className="px-6 py-2.5 rounded-lg font-medium bg-slate-800 hover:bg-slate-700 text-white transition-colors"
            >
              Discard
            </button>
            <button 
              onClick={handleDownload}
              className="px-8 py-2.5 rounded-lg font-bold bg-primary hover:bg-primary-hover text-white shadow-[0_0_15px_rgba(99,102,241,0.4)] hover:shadow-[0_0_25px_rgba(99,102,241,0.6)] transition-all flex items-center gap-2"
            >
              <i className="ph-bold ph-download-simple"></i>
              Download
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
