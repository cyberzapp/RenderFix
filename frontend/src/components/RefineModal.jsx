import React, { useRef, useState, useEffect } from 'react';

export default function RefineModal({ imageUrl, onClose, onSave }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [brushSize, setBrushSize] = useState(50);
  const [mode, setMode] = useState('erase'); // 'erase' or 'restore'
  const [isDrawing, setIsDrawing] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });
  
  // History for undo/redo
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  useEffect(() => {
    if (!imageUrl) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      saveHistoryState(canvas);
    };
  }, [imageUrl]);

  const saveHistoryState = (canvas) => {
    const dataUrl = canvas.toDataURL();
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(dataUrl);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      restoreCanvasFromDataUrl(history[newIndex]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      restoreCanvasFromDataUrl(history[newIndex]);
    }
  };

  const restoreCanvasFromDataUrl = (dataUrl) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
  };

  const getCanvasCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    // Account for zoom and CSS scaling
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const handlePointerDown = (e) => {
    if (e.button === 1 || e.button === 2) { // Middle or right click for pan
      setIsPanning(true);
      lastPos.current = { x: e.clientX, y: e.clientY };
      return;
    }
    
    setIsDrawing(true);
    const { x, y } = getCanvasCoordinates(e);
    lastPos.current = { x, y };
    
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSize;
    
    if (mode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'white'; // Representing mask for generative
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const handlePointerMove = (e) => {
    if (isPanning) {
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastPos.current = { x: e.clientX, y: e.clientY };
      return;
    }
    
    if (!isDrawing) return;
    
    const { x, y } = getCanvasCoordinates(e);
    const ctx = canvasRef.current.getContext('2d');
    
    if (mode === 'erase') {
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    
    lastPos.current = { x, y };
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    if (isDrawing) {
      setIsDrawing(false);
      saveHistoryState(canvasRef.current);
    }
  };

  const handleDone = () => {
    const canvas = canvasRef.current;
    canvas.toBlob((blob) => {
      onSave(blob);
    });
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900 flex flex-col md:flex-row font-sans animate-fade-in">
      {/* Sidebar */}
      <div className="w-full md:w-[320px] bg-white text-slate-900 border-r border-slate-200 flex flex-col shadow-xl z-20 h-full">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <i className="ph-fill ph-magic-wand text-primary"></i>
            Refine & Generate
          </h2>
          <div className="flex gap-2">
            <button 
              onClick={handleUndo} 
              disabled={historyIndex <= 0}
              className="w-8 h-8 rounded hover:bg-slate-100 flex items-center justify-center disabled:opacity-30 transition-colors"
            >
              <i className="ph-bold ph-arrow-u-up-left"></i>
            </button>
            <button 
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              className="w-8 h-8 rounded hover:bg-slate-100 flex items-center justify-center disabled:opacity-30 transition-colors"
            >
              <i className="ph-bold ph-arrow-u-up-right"></i>
            </button>
          </div>
        </div>

        <div className="p-6 flex flex-col gap-6 flex-1 overflow-auto">
          {/* Tool Selector */}
          <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
            <button className="flex-1 py-3 px-2 bg-white rounded-lg shadow-sm font-semibold flex items-center justify-center gap-2 border border-slate-200">
              <i className="ph-fill ph-paint-brush"></i>
              <div>
                <div className="text-sm">Brush</div>
                <div className="text-[10px] text-slate-400 font-normal">Manual</div>
              </div>
            </button>
            <button className="flex-1 py-3 px-2 hover:bg-slate-200 rounded-lg text-slate-600 font-semibold flex items-center justify-center gap-2 transition-colors">
              <i className="ph-fill ph-selection-all"></i>
              <div>
                <div className="text-sm">Object</div>
                <div className="text-[10px] text-slate-400 font-normal">Auto</div>
              </div>
            </button>
          </div>

          {/* Mode Toggle */}
          <div className="flex bg-slate-100 rounded-lg p-1">
            <button 
              onClick={() => setMode('erase')}
              className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${mode === 'erase' ? 'bg-white shadow border border-slate-200 text-slate-900' : 'text-slate-500'}`}
            >
              Erase
            </button>
            <button 
              onClick={() => setMode('restore')}
              className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${mode === 'restore' ? 'bg-white shadow border border-slate-200 text-slate-900' : 'text-slate-500'}`}
            >
              Draw Mask
            </button>
          </div>

          {/* Brush Size */}
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-center text-sm font-semibold">
              <span>Brush Size</span>
              <span className="text-slate-500">{brushSize}</span>
            </div>
            <input 
              type="range" 
              min="1" 
              max="200" 
              value={brushSize} 
              onChange={(e) => setBrushSize(parseInt(e.target.value))}
              className="w-full accent-primary"
            />
          </div>

          <hr className="border-slate-200" />

          {/* Generative AI Input */}
          <div className="flex flex-col gap-3">
            <h3 className="font-semibold text-sm">Generative AI (Inpaint)</h3>
            <textarea 
              placeholder="Describe what to generate in the masked area (e.g., 'A cyberpunk city background' or 'A red leather jacket')"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm resize-none focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary h-24 text-slate-700"
            />
            <button className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-lg transition-colors flex justify-center items-center gap-2">
              <i className="ph-bold ph-sparkle"></i>
              Generate
            </button>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 flex gap-3 bg-slate-50">
          <button 
            onClick={onClose}
            className="flex-1 py-2.5 bg-white border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleDone}
            className="flex-1 py-2.5 bg-slate-900 rounded-lg font-semibold text-white hover:bg-slate-800 transition-colors shadow-lg"
          >
            Done
          </button>
        </div>
      </div>

      {/* Canvas Area */}
      <div 
        ref={containerRef}
        className="flex-1 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+PHJlY3Qgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjMmUyZTMzIiAvPjxyZWN0IHg9IjEwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiMzZjNmNDYiIC8+PHJlY3QgeT0iMTAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iIzNmM2Y0NiIgLz48cmVjdCB4PSIxMCIgeT0iMTAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iIzJlMmUzMyIgLz48L3N2Zz4=')] bg-repeat overflow-hidden relative"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div 
          className="absolute top-1/2 left-1/2 origin-center transition-transform duration-75"
          style={{
            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
          }}
        >
          <canvas 
            ref={canvasRef} 
            className="shadow-2xl cursor-crosshair border border-slate-700/50 block"
            style={{ 
              maxWidth: 'none',
              touchAction: 'none'
            }}
          />
        </div>

        {/* Zoom Controls */}
        <div className="absolute bottom-6 right-6 bg-white rounded-lg shadow-xl flex items-center border border-slate-200">
          <button onClick={() => setZoom(z => Math.max(0.1, z - 0.1))} className="w-10 h-10 flex items-center justify-center hover:bg-slate-100 rounded-l-lg text-slate-700 transition-colors">
            <i className="ph-bold ph-minus"></i>
          </button>
          <div className="px-3 text-sm font-bold text-slate-700 font-mono w-16 text-center flex items-center justify-center">
            {Math.round(zoom * 100)}%
          </div>
          <button onClick={() => setZoom(z => Math.min(5, z + 0.1))} className="w-10 h-10 flex items-center justify-center hover:bg-slate-100 rounded-r-lg text-slate-700 transition-colors">
            <i className="ph-bold ph-plus"></i>
          </button>
        </div>
      </div>
    </div>
  );
}
