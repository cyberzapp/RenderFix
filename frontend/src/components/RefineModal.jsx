import React, { useRef, useState, useEffect } from 'react';

export default function RefineModal({ imageUrl, onClose, onSave }) {
  const canvasRef = useRef(null);
  const maskCanvasRef = useRef(null);
  const containerRef = useRef(null);
  
  const [brushSize, setBrushSize] = useState(50);
  const [mode, setMode] = useState('restore'); // 'restore' = draw mask, 'erase' = erase mask
  const [isDrawing, setIsDrawing] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });
  
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const abortControllerRef = useRef(null);
  
  const [editingMode, setEditingMode] = useState('smart'); // 'smart' or 'manual'
  const [smartEditType, setSmartEditType] = useState('replace_object'); // 'replace_object' or 'global_edit'
  const [targetObject, setTargetObject] = useState('');
  
  // History for undo/redo (tracks main image only)
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  useEffect(() => {
    if (!imageUrl) return;
    
    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      maskCanvas.width = img.width;
      maskCanvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      saveHistoryState(canvas);
      
      // Calculate initial zoom to fit within the container
      if (containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const padding = 80; // 40px padding on each side
        const scaleX = (containerRect.width - padding) / img.width;
        const scaleY = (containerRect.height - padding) / img.height;
        // Use the smaller scale to ensure it fits, max out at 1 (100%)
        const initialZoom = Math.min(scaleX, scaleY, 1);
        // Round to 2 decimal places to avoid rendering glitches
        setZoom(Math.round(initialZoom * 100) / 100);
      }
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
      clearMask();
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      restoreCanvasFromDataUrl(history[newIndex]);
      clearMask();
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

  const clearMask = () => {
    const canvas = maskCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const getCanvasCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const handlePointerDown = (e) => {
    if (e.button === 1 || e.button === 2) { 
      setIsPanning(true);
      lastPos.current = { x: e.clientX, y: e.clientY };
      return;
    }
    
    setIsDrawing(true);
    const { x, y } = getCanvasCoordinates(e);
    lastPos.current = { x, y };
    
    const ctx = maskCanvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSize;
    
    if (mode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'white';
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
    const ctx = maskCanvasRef.current.getContext('2d');
    
    if (mode === 'erase') {
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'white';
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
    }
  };

  const handleSmartGenerate = async () => {
    if (isProcessing) return;
    
    if (smartEditType === 'replace_object' && !targetObject.trim()) {
      alert("Please specify the object you want to replace (e.g. 'shirt').");
      return;
    }
    
    setIsProcessing(true);
    abortControllerRef.current = new AbortController();
    
    try {
      const imageCanvas = canvasRef.current;
      const imageBlob = await new Promise(resolve => imageCanvas.toBlob(resolve, 'image/png'));
      
      const formData = new FormData();
      formData.append('image', imageBlob, 'image.png');
      formData.append('edit_type', smartEditType);
      formData.append('target_object', targetObject);
      formData.append('prompt', prompt);
      
      const response = await fetch('http://127.0.0.1:8000/api/image/smart-edit', {
        method: 'POST',
        body: formData,
        signal: abortControllerRef.current.signal
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText);
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const ctx = imageCanvas.getContext('2d');
        ctx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
        ctx.drawImage(img, 0, 0, imageCanvas.width, imageCanvas.height);
        saveHistoryState(imageCanvas);
        URL.revokeObjectURL(url);
        setIsProcessing(false);
      };
      img.src = url;
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log("Generation aborted by user");
      } else {
        console.error(err);
        alert("Failed to process image: " + err.message);
      }
      setIsProcessing(false);
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleGenerate = async (isWatermark = false) => {
    if (isProcessing) return;
    
    const imageCanvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    
    // Check if mask is empty
    const maskCtx = maskCanvas.getContext('2d');
    const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
    const hasMask = maskData.some((val, i) => i % 4 === 3 && val > 0); // check alpha channel
    if (!hasMask) {
      alert("Please draw a mask over the area you want to replace first.");
      return;
    }

    setIsProcessing(true);
    abortControllerRef.current = new AbortController();
    
    try {
      const imageBlob = await new Promise(resolve => imageCanvas.toBlob(resolve, 'image/png'));
      
      // Generate black/white mask for API
      const bwMaskCanvas = document.createElement('canvas');
      bwMaskCanvas.width = maskCanvas.width;
      bwMaskCanvas.height = maskCanvas.height;
      const bwCtx = bwMaskCanvas.getContext('2d');
      
      // Fill black background
      bwCtx.fillStyle = 'black';
      bwCtx.fillRect(0, 0, bwMaskCanvas.width, bwMaskCanvas.height);
      
      // Draw user's white mask
      bwCtx.globalCompositeOperation = 'source-over';
      bwCtx.drawImage(maskCanvas, 0, 0);
      
      // Force non-black pixels to pure white to avoid semi-transparent gray
      const bwData = bwCtx.getImageData(0, 0, bwMaskCanvas.width, bwMaskCanvas.height);
      for (let i = 0; i < bwData.data.length; i += 4) {
        if (bwData.data[i] > 0 || bwData.data[i+1] > 0 || bwData.data[i+2] > 0) {
          bwData.data[i] = 255;
          bwData.data[i+1] = 255;
          bwData.data[i+2] = 255;
          bwData.data[i+3] = 255;
        }
      }
      bwCtx.putImageData(bwData, 0, 0);
      
      const maskBlob = await new Promise(resolve => bwMaskCanvas.toBlob(resolve, 'image/png'));
      
      const formData = new FormData();
      formData.append('image', imageBlob, 'image.png');
      formData.append('mask', maskBlob, 'mask.png');
      formData.append('prompt', isWatermark ? '' : prompt);
      
      const response = await fetch('http://127.0.0.1:8000/api/image/inpaint', {
        method: 'POST',
        body: formData,
        signal: abortControllerRef.current.signal
      });
      
      if (!response.ok) {
        throw new Error(await response.text());
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const ctx = imageCanvas.getContext('2d');
        ctx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
        ctx.drawImage(img, 0, 0, imageCanvas.width, imageCanvas.height);
        saveHistoryState(imageCanvas);
        clearMask();
        URL.revokeObjectURL(url);
        setIsProcessing(false);
      };
      img.src = url;
      
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log("Generation aborted by user");
      } else {
        console.error(err);
        alert("Failed to process image: " + err.message);
      }
      setIsProcessing(false);
    } finally {
      abortControllerRef.current = null;
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
      <div className="w-full md:w-[320px] bg-white text-slate-900 border-r border-slate-200 flex flex-col shadow-xl z-20 h-full relative">
        {isProcessing && (
          <div className="absolute inset-0 bg-white/80 z-50 flex flex-col items-center justify-center backdrop-blur-sm">
            <i className="ph-bold ph-spinner animate-spin text-4xl text-primary mb-4"></i>
            <span className="font-semibold text-slate-700 animate-pulse text-center px-4 mb-6">AI is generating your image...<br/>(This can take up to 20 seconds)</span>
            <button 
              onClick={() => {
                if (abortControllerRef.current) {
                  abortControllerRef.current.abort();
                }
              }}
              className="px-6 py-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-full font-bold shadow-sm transition-colors flex items-center gap-2"
            >
              <i className="ph-bold ph-stop"></i> Stop Generation
            </button>
          </div>
        )}

        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <i className="ph-fill ph-magic-wand text-primary"></i>
            Refine & Generate
          </h2>
          <div className="flex gap-2">
            <button 
              onClick={handleUndo} 
              disabled={historyIndex <= 0 || isProcessing}
              className="w-8 h-8 rounded hover:bg-slate-100 flex items-center justify-center disabled:opacity-30 transition-colors"
            >
              <i className="ph-bold ph-arrow-u-up-left"></i>
            </button>
            <button 
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1 || isProcessing}
              className="w-8 h-8 rounded hover:bg-slate-100 flex items-center justify-center disabled:opacity-30 transition-colors"
            >
              <i className="ph-bold ph-arrow-u-up-right"></i>
            </button>
          </div>
        </div>

        <div className="p-6 flex flex-col gap-6 flex-1 overflow-auto">
          {/* Tool Selector */}
          <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
            <button 
              onClick={() => setEditingMode('manual')}
              className={`flex-1 py-3 px-2 rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors ${editingMode === 'manual' ? 'bg-white shadow-sm border border-slate-200 text-slate-900' : 'hover:bg-slate-200 text-slate-600'}`}
            >
              <i className="ph-fill ph-paint-brush"></i>
              <div>
                <div className="text-sm">Manual Mask</div>
              </div>
            </button>
            <button 
              onClick={() => setEditingMode('smart')}
              className={`flex-1 py-3 px-2 rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors ${editingMode === 'smart' ? 'bg-white shadow-sm border border-slate-200 text-slate-900' : 'hover:bg-slate-200 text-slate-600'}`}
            >
              <i className="ph-fill ph-magic-wand"></i>
              <div>
                <div className="text-sm">Smart Edit</div>
              </div>
            </button>
          </div>

          {editingMode === 'manual' ? (
            <>
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
              
              {/* Clear Mask */}
              <button 
                onClick={clearMask}
                className="text-xs font-semibold text-slate-500 hover:text-red-500 flex items-center gap-1 w-max transition-colors"
              >
                <i className="ph-bold ph-trash"></i> Clear current mask
              </button>

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
                <h3 className="font-semibold text-sm">AI Tools (Stable Diffusion)</h3>
                <button 
                  onClick={() => handleGenerate(true)}
                  disabled={isProcessing}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold shadow-lg transition-colors flex justify-center items-center gap-2 disabled:opacity-50"
                >
                  <i className="ph-bold ph-eraser"></i>
                  Remove Object / Watermark
                </button>
                <div className="text-xs text-center text-slate-500 font-medium">OR</div>
                <textarea 
                  placeholder="Describe what to generate in the masked area (e.g., 'A red leather jacket')"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm resize-none focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary h-24 text-slate-700"
                />
                <button 
                  onClick={() => handleGenerate(false)}
                  disabled={isProcessing}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-lg transition-colors flex justify-center items-center gap-2 disabled:opacity-50"
                >
                  <i className="ph-bold ph-sparkle"></i>
                  Generate Fill
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Smart Edit Tools */}
              <div className="flex bg-slate-100 rounded-lg p-1">
                <button 
                  onClick={() => setSmartEditType('replace_object')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-md transition-all ${smartEditType === 'replace_object' ? 'bg-white shadow border border-slate-200 text-slate-900' : 'text-slate-500'}`}
                >
                  Auto-Select Object
                </button>
                <button 
                  onClick={() => setSmartEditType('global_edit')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-md transition-all ${smartEditType === 'global_edit' ? 'bg-white shadow border border-slate-200 text-slate-900' : 'text-slate-500'}`}
                >
                  Global Edit
                </button>
              </div>

              <div className="flex flex-col gap-4 mt-2">
                {smartEditType === 'replace_object' && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Target Object</label>
                    <input 
                      type="text"
                      placeholder="e.g. 'shirt', 'face', 'car'"
                      value={targetObject}
                      onChange={(e) => setTargetObject(e.target.value)}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-slate-700"
                    />
                    <span className="text-[10px] text-slate-400">AI will automatically find and mask this object.</span>
                  </div>
                )}
                
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    {smartEditType === 'replace_object' ? 'New Generation Prompt' : 'Instruction Prompt'}
                  </label>
                  <textarea 
                    placeholder={smartEditType === 'replace_object' ? "e.g., 'A red leather jacket'" : "e.g., 'Make it look like a watercolor painting'"}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm resize-none focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary h-24 text-slate-700"
                  />
                  {smartEditType === 'global_edit' && (
                    <span className="text-[10px] text-slate-400">Tells the AI how to edit the whole image. No masking required.</span>
                  )}
                </div>
                
                <button 
                  onClick={handleSmartGenerate}
                  disabled={isProcessing}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-lg transition-colors flex justify-center items-center gap-2 disabled:opacity-50 mt-2"
                >
                  <i className="ph-bold ph-sparkle"></i>
                  {smartEditType === 'replace_object' ? 'Smart Replace' : 'Apply Global Edit'}
                </button>
              </div>
            </>
          )}
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
            className="flex-1 py-2.5 bg-green-600 rounded-lg font-semibold text-white hover:bg-green-700 transition-colors shadow-lg"
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
          <div className="relative shadow-2xl border border-slate-700/50">
            <canvas 
              ref={canvasRef} 
              className="block"
              style={{ maxWidth: 'none', touchAction: 'none' }}
            />
            <canvas 
              ref={maskCanvasRef} 
              className={`absolute inset-0 block cursor-crosshair ${editingMode === 'smart' ? 'hidden' : ''}`}
              style={{ maxWidth: 'none', touchAction: 'none', opacity: 0.6 }}
            />
          </div>
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
