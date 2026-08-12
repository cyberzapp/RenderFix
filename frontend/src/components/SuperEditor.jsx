import React, { useState, useRef, useEffect } from 'react';
import ImageCropper from './ImageCropper';
import { saveAs } from 'file-saver';

export default function SuperEditor({ file, onSave, onCancel }) {
  const [activeTool, setActiveTool] = useState('crop'); // crop, resize, removeBg, ai, export
  const [baseImageUrl, setBaseImageUrl] = useState(null);
  const [fileDimensions, setFileDimensions] = useState({ w: 1920, h: 1080 });
  const [currentFile, setCurrentFile] = useState(file);
  
  // Basic Tools State
  const [cropRegion, setCropRegion] = useState(null);
  const [resizeMode, setResizeMode] = useState('scale'); // 'scale' or 'exact'
  const [scale, setScale] = useState(1.0);
  const [targetW, setTargetW] = useState(1920);
  const [targetH, setTargetH] = useState(1080);
  const [isRatioLocked, setIsRatioLocked] = useState(true);
  const [isProcessingBasic, setIsProcessingBasic] = useState(false);

  // Export State
  const [format, setFormat] = useState('image/png');
  const [compressMode, setCompressMode] = useState('quality'); // 'quality' or 'target'
  const [quality, setQuality] = useState(100);
  const [targetSize, setTargetSize] = useState(500);
  const [targetSizeUnit, setTargetSizeUnit] = useState('KB');

  // AI State
  const [references, setReferences] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [masks, setMasks] = useState({});
  const [activeReferenceId, setActiveReferenceId] = useState(null);
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [resultImage, setResultImage] = useState(null);
  
  useEffect(() => {
    if (currentFile) {
      const url = URL.createObjectURL(currentFile);
      setBaseImageUrl(url);
      
      const img = new Image();
      img.onload = () => {
        setFileDimensions({ w: img.naturalWidth, h: img.naturalHeight });
        setTargetW(img.naturalWidth);
        setTargetH(img.naturalHeight);
      };
      img.src = url;
      
      return () => URL.revokeObjectURL(url);
    }
  }, [currentFile]);

  const handleApplyBasicTools = async (toolType) => {
    setIsProcessingBasic(true);
    try {
      const formData = new FormData();
      formData.append('files', currentFile);
      formData.append('format', currentFile.type || 'image/png');
      
      if (toolType === 'crop' && cropRegion) {
        formData.append('crop_x', cropRegion.x);
        formData.append('crop_y', cropRegion.y);
        formData.append('crop_w', cropRegion.w);
        formData.append('crop_h', cropRegion.h);
      } else if (toolType === 'resize') {
        if (resizeMode === 'scale') {
          formData.append('scale', scale);
        } else {
          formData.append('target_w', targetW);
          formData.append('target_h', targetH);
        }
      } else if (toolType === 'removeBg') {
        formData.append('remove_bg', true);
      }

      const response = await fetch('http://localhost:8000/api/image/process', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error("Processing failed");
      const blob = await response.blob();
      const newFile = new File([blob], currentFile.name, { type: blob.type });
      setCurrentFile(newFile);
      setCropRegion(null); // Reset crop
    } catch (err) {
      alert("Error applying changes: " + err.message);
    } finally {
      setIsProcessingBasic(false);
    }
  };

  const handleDownload = async () => {
    setIsProcessingBasic(true);
    try {
      const formData = new FormData();
      // If we have an AI generation result, we should download that. Otherwise, currentFile.
      const fileToDownload = resultImage ? await fetch(resultImage).then(r => r.blob()) : currentFile;
      
      formData.append('files', fileToDownload, 'image.png');
      formData.append('format', format);
      
      if (compressMode === 'quality') {
        formData.append('quality', quality);
      } else {
        let bytes = targetSize;
        if (targetSizeUnit === 'KB') bytes = targetSize * 1024;
        if (targetSizeUnit === 'MB') bytes = targetSize * 1024 * 1024;
        formData.append('target_bytes', Math.floor(bytes));
      }

      const response = await fetch('http://localhost:8000/api/image/process', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error("Processing failed");
      const blob = await response.blob();
      
      const ext = format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png';
      const filename = `renderfix_final_${Date.now()}.${ext}`;
      saveAs(blob, filename);
    } catch (err) {
      alert("Error downloading: " + err.message);
    } finally {
      setIsProcessingBasic(false);
    }
  };

  const handleImageClick = async (e) => {
    if (activeTool !== 'ai') return;
    if (!activeReferenceId) {
      alert("Please select a Reference Image from the left panel first to bind the mask to.");
      return;
    }

    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scaleX = e.target.naturalWidth / rect.width;
    const scaleY = e.target.naturalHeight / rect.height;
    const trueX = Math.round(x * scaleX);
    const trueY = Math.round(y * scaleY);
    
    setIsSegmenting(true);
    try {
      const formData = new FormData();
      formData.append('image', currentFile);
      formData.append('points', JSON.stringify([trueX, trueY]));
      
      const res = await fetch('http://localhost:8000/api/image/segment', {
        method: 'POST',
        body: formData
      });
      
      if (!res.ok) throw new Error("Segmentation failed");
      const maskBlob = await res.blob();
      const maskUrl = URL.createObjectURL(maskBlob);
      setMasks(prev => ({ ...prev, [activeReferenceId]: maskUrl }));
    } catch (err) {
      alert("Failed to segment object: " + err.message);
    } finally {
      setIsSegmenting(false);
    }
  };

  const handleGenerate = async () => {
    if (!prompt) {
      alert("Please enter a prompt.");
      return;
    }
    
    setIsProcessing(true);
    try {
      if (references.length === 0) {
        // Fallback to InstructPix2Pix if no references/masks are provided
        const formData = new FormData();
        formData.append('prompt', prompt);
        formData.append('edit_type', 'global_edit');
        formData.append('target_object', '');
        formData.append('image', currentFile);
        
        const response = await fetch('http://localhost:8000/api/image/smart-edit', {
          method: 'POST',
          body: formData,
        });
        
        if (!response.ok) throw new Error("Failed to generate composition");
        const blob = await response.blob();
        setResultImage(URL.createObjectURL(blob));
      } else {
        // Advanced Composite with IP-Adapter
        const formData = new FormData();
        formData.append('prompt', prompt);
        
        const refData = references.map(r => ({ label: r.label, type: r.type, has_mask: !!masks[r.id] }));
        formData.append('references_meta', JSON.stringify(refData));
        
        formData.append('base_image', currentFile, 'base.png');
        
        for (const r of references) {
          formData.append('reference_images', r.file);
          if (masks[r.id]) {
              const maskFetch = await fetch(masks[r.id]);
              const maskBlob = await maskFetch.blob();
              formData.append('reference_masks', maskBlob, `mask_${r.id}.png`);
          }
        }

        const response = await fetch('http://localhost:8000/api/image/advanced-composite', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) throw new Error("Failed to generate composition");
        const blob = await response.blob();
        setResultImage(URL.createObjectURL(blob));
      }
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0f172a] flex flex-col h-screen animate-fade-in">
      {/* Top Header */}
      <div className="h-14 border-b border-slate-800 bg-slate-900 flex items-center justify-between px-6 shrink-0">
        <h1 className="text-white font-bold flex items-center gap-2">
          <i className="ph-fill ph-aperture text-primary text-xl"></i> Super Editor
        </h1>
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="text-slate-400 hover:text-white px-4 py-1.5 rounded-lg hover:bg-slate-800 transition-colors text-sm font-medium">
            Cancel
          </button>
          <button 
            onClick={() => {
              if (resultImage) {
                fetch(resultImage).then(r => r.blob()).then(blob => onSave(blob));
              } else {
                onSave(currentFile);
              }
            }}
            className="primary-gradient text-white px-5 py-1.5 rounded-lg font-bold shadow-lg text-sm hover:-translate-y-0.5 transition-all"
          >
            Save Changes & Exit
          </button>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Toolbar */}
        <div className="w-16 border-r border-slate-800 bg-slate-900 flex flex-col items-center py-4 gap-4 shrink-0">
          <ToolButton icon="ph-crop" label="Crop" active={activeTool === 'crop'} onClick={() => setActiveTool('crop')} />
          <ToolButton icon="ph-arrows-out-simple" label="Resize" active={activeTool === 'resize'} onClick={() => setActiveTool('resize')} />
          <ToolButton icon="ph-scissors" label="Remove BG" active={activeTool === 'removeBg'} onClick={() => setActiveTool('removeBg')} />
          <div className="w-8 h-px bg-slate-800 my-2"></div>
          <ToolButton icon="ph-magic-wand" label="AI Compose" active={activeTool === 'ai'} onClick={() => setActiveTool('ai')} highlight />
          <div className="flex-1"></div>
          <ToolButton icon="ph-download-simple" label="Export" active={activeTool === 'export'} onClick={() => setActiveTool('export')} />
        </div>

        {/* Tools Panel (Dynamic based on selected tool) */}
        <div className="w-80 border-r border-slate-800 bg-slate-900/50 flex flex-col shrink-0 overflow-y-auto custom-scrollbar">
          {activeTool === 'crop' && (
            <div className="p-5 flex flex-col h-full">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <i className="ph-fill ph-crop text-primary"></i> Crop Image
              </h3>
              <p className="text-sm text-slate-400 mb-6">Draw a rectangle on the canvas to crop your image.</p>
              
              {cropRegion && (
                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700 mb-4 text-xs text-slate-300">
                  Selected Region:<br/>
                  W: {Math.round(cropRegion.w)}px | H: {Math.round(cropRegion.h)}px
                </div>
              )}
              
              <div className="mt-auto">
                <button
                  onClick={() => handleApplyBasicTools('crop')}
                  disabled={!cropRegion || isProcessingBasic}
                  className="w-full py-2.5 bg-primary text-white rounded-lg font-bold disabled:opacity-50 text-sm transition-all hover:bg-indigo-500"
                >
                  {isProcessingBasic ? 'Cropping...' : 'Apply Crop'}
                </button>
              </div>
            </div>
          )}
          
          {activeTool === 'resize' && (
            <div className="p-5 flex flex-col h-full">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <i className="ph-fill ph-arrows-out-simple text-primary"></i> Resize Image
              </h3>
              
              <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-700 mb-6">
                <button 
                  onClick={() => setResizeMode('scale')}
                  className={`flex-1 py-1.5 rounded text-xs font-semibold transition-colors ${resizeMode === 'scale' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
                >Scale</button>
                <button 
                  onClick={() => setResizeMode('exact')}
                  className={`flex-1 py-1.5 rounded text-xs font-semibold transition-colors ${resizeMode === 'exact' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
                >Exact Pixels</button>
              </div>

              {resizeMode === 'scale' ? (
                <div className="space-y-3">
                  <div className="flex justify-between text-xs font-medium text-slate-400">
                    <span>0.1x</span>
                    <span className="text-primary text-sm font-bold">{scale.toFixed(1)}x</span>
                    <span>4.0x</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="4.0"
                    step="0.1"
                    value={scale}
                    onChange={(e) => setScale(Number(e.target.value))}
                    className="w-full accent-primary bg-slate-700 rounded-full h-2"
                  />
                  <div className="text-center text-xs text-slate-400 mt-2">
                    Result: {Math.round(fileDimensions.w * scale)} x {Math.round(fileDimensions.h * scale)}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 space-y-1">
                      <label className="text-xs text-slate-400 font-semibold uppercase">Width (px)</label>
                      <input
                        type="number"
                        value={targetW}
                        onChange={(e) => {
                          const w = Number(e.target.value);
                          setTargetW(w);
                          if (isRatioLocked && fileDimensions.w > 0) {
                            setTargetH(Math.round(w * (fileDimensions.h / fileDimensions.w)));
                          }
                        }}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-white focus:border-primary outline-none transition-colors"
                      />
                    </div>
                    
                    <button 
                      onClick={() => setIsRatioLocked(!isRatioLocked)}
                      className={`mt-5 p-2 rounded-lg transition-colors ${isRatioLocked ? 'text-primary bg-primary/10' : 'text-slate-500 hover:text-slate-300 bg-slate-800'}`}
                    >
                      <i className={`ph-bold ${isRatioLocked ? 'ph-link' : 'ph-link-break'} text-lg`}></i>
                    </button>

                    <div className="flex-1 space-y-1">
                      <label className="text-xs text-slate-400 font-semibold uppercase">Height (px)</label>
                      <input
                        type="number"
                        value={targetH}
                        onChange={(e) => {
                          const h = Number(e.target.value);
                          setTargetH(h);
                          if (isRatioLocked && fileDimensions.h > 0) {
                            setTargetW(Math.round(h * (fileDimensions.w / fileDimensions.h)));
                          }
                        }}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-white focus:border-primary outline-none transition-colors"
                      />
                    </div>
                  </div>
                </div>
              )}
              
              <div className="mt-auto">
                <button
                  onClick={() => handleApplyBasicTools('resize')}
                  disabled={isProcessingBasic}
                  className="w-full py-2.5 bg-primary text-white rounded-lg font-bold disabled:opacity-50 text-sm transition-all hover:bg-indigo-500"
                >
                  {isProcessingBasic ? 'Resizing...' : 'Apply Resize'}
                </button>
              </div>
            </div>
          )}
          
          {activeTool === 'removeBg' && (
            <div className="p-5 flex flex-col h-full">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <i className="ph-fill ph-scissors text-primary"></i> Background Removal
              </h3>
              <p className="text-sm text-slate-400 mb-6">Automatically remove the background using AI.</p>
              
              <div className="mt-auto">
                <button
                  onClick={() => handleApplyBasicTools('removeBg')}
                  disabled={isProcessingBasic}
                  className="w-full py-2.5 bg-primary text-white rounded-lg font-bold disabled:opacity-50 text-sm transition-all hover:bg-indigo-500 flex items-center justify-center gap-2"
                >
                  {isProcessingBasic ? <><i className="ph-bold ph-spinner animate-spin"></i> Processing...</> : 'Remove Background'}
                </button>
              </div>
            </div>
          )}
          
          {activeTool === 'ai' && (
            <div className="flex flex-col h-full">
              <div className="p-5 border-b border-slate-800">
                <h3 className="text-white font-semibold flex items-center gap-2 mb-4">
                  <i className="ph-fill ph-magic-wand text-primary"></i> Studio Compositor
                </h3>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe what you want to generate in the masked area..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-primary min-h-[100px] resize-none"
                />
                <button
                  onClick={handleGenerate}
                  disabled={isProcessing || !prompt}
                  className="w-full mt-3 py-2.5 primary-gradient text-white rounded-lg font-bold disabled:opacity-50 text-sm flex items-center justify-center gap-2 transition-all hover:shadow-[0_0_20px_rgba(99,102,241,0.4)]"
                >
                  {isProcessing ? <><i className="ph ph-spinner animate-spin"></i> Generating...</> : 'Render Scene'}
                </button>
              </div>
              <div className="p-5 flex-1 overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">References</label>
                  <label className="text-xs bg-slate-800 text-white px-2 py-1 rounded hover:bg-slate-700 transition-colors cursor-pointer border border-slate-700">
                    + Add Reference
                    <input type="file" multiple accept="image/*" onChange={(e) => {
                      const newRefs = Array.from(e.target.files).map(f => ({
                        id: Math.random().toString(36).substring(7),
                        file: f, url: URL.createObjectURL(f), label: 'Face', type: 'face'
                      }));
                      setReferences([...references, ...newRefs]);
                    }} className="hidden" />
                  </label>
                </div>
                
                <div className="space-y-3">
                  {references.length === 0 && (
                    <div className="text-center p-4 bg-slate-900/50 rounded-lg border border-dashed border-slate-800 text-xs text-slate-500">
                      Upload face or style references to bind to masks.
                    </div>
                  )}
                  {references.map(ref => (
                    <div 
                      key={ref.id} 
                      className={`flex gap-3 bg-slate-800 p-2 rounded-lg border cursor-pointer transition-colors ${activeReferenceId === ref.id ? 'border-primary ring-1 ring-primary/50' : 'border-slate-700'}`}
                      onClick={() => setActiveReferenceId(ref.id)}
                    >
                      <div className="relative shrink-0">
                        <img src={ref.url} alt="Ref" className="w-12 h-12 object-cover rounded" />
                        {masks[ref.id] && <div className="absolute -top-1.5 -right-1.5 bg-green-500 w-4 h-4 rounded-full border-2 border-slate-900 shadow-sm flex items-center justify-center text-[8px] text-white"><i className="ph-bold ph-check"></i></div>}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <input
                          type="text"
                          value={ref.label}
                          onChange={(e) => {
                            setReferences(references.map(r => r.id === ref.id ? { ...r, label: e.target.value } : r));
                          }}
                          className="w-full bg-slate-900 border-none rounded p-1 text-xs text-white focus:ring-1 focus:ring-primary mb-1"
                          onClick={e => e.stopPropagation()}
                        />
                        <select
                          value={ref.type}
                          onChange={(e) => setReferences(references.map(r => r.id === ref.id ? { ...r, type: e.target.value } : r))}
                          className="w-full bg-slate-900 border-none rounded p-1 text-[10px] text-slate-400"
                          onClick={e => e.stopPropagation()}
                        >
                          <option value="face">Face Identity</option>
                          <option value="style">Style/Object</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          
          {activeTool === 'export' && (
            <div className="p-5 flex flex-col h-full">
              <h3 className="text-white font-semibold mb-6 flex items-center gap-2">
                <i className="ph-fill ph-download-simple text-primary"></i> Export & Download
              </h3>
              
              <div className="space-y-6 flex-1 overflow-y-auto">
                <div className="space-y-3">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Format</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['image/png', 'image/jpeg', 'image/webp'].map(fmt => (
                      <button
                        key={fmt}
                        onClick={() => setFormat(fmt)}
                        className={`py-2 px-3 rounded-lg text-xs font-bold transition-all border ${format === fmt ? 'bg-primary/10 border-primary text-primary' : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'}`}
                      >
                        {fmt.split('/')[1].toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Compression</label>
                    <div className="flex bg-slate-900 rounded-md p-0.5 border border-slate-700">
                      <button 
                        onClick={() => setCompressMode('quality')}
                        className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors ${compressMode === 'quality' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
                      >Quality</button>
                      <button 
                        onClick={() => setCompressMode('target')}
                        className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors ${compressMode === 'target' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
                      >Target Size</button>
                    </div>
                  </div>

                  {compressMode === 'quality' ? (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs font-medium">
                        <span className="text-slate-500">Low</span>
                        <span className="text-primary">{quality}%</span>
                        <span className="text-slate-500">High</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="100"
                        value={quality}
                        onChange={(e) => setQuality(Number(e.target.value))}
                        className="w-full accent-primary bg-slate-700 rounded-full h-1.5"
                      />
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={targetSize}
                        onChange={(e) => setTargetSize(Number(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-white focus:border-primary outline-none transition-colors"
                      />
                      <select
                        value={targetSizeUnit}
                        onChange={(e) => setTargetSizeUnit(e.target.value)}
                        className="bg-slate-800 border border-slate-700 rounded-lg px-2 text-white focus:border-primary outline-none text-sm"
                      >
                        <option value="KB">KB</option>
                        <option value="MB">MB</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-auto pt-4">
                <button
                  onClick={handleDownload}
                  disabled={isProcessingBasic}
                  className="w-full py-3 primary-gradient text-white rounded-xl font-bold disabled:opacity-50 text-sm transition-all hover:shadow-[0_0_20px_rgba(99,102,241,0.4)] hover:-translate-y-1 flex items-center justify-center gap-2"
                >
                  {isProcessingBasic ? <><i className="ph-bold ph-spinner animate-spin"></i> Processing...</> : <><i className="ph-bold ph-download-simple text-lg"></i> Download to Computer</>}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Center Canvas */}
        <div className="flex-1 bg-slate-950 flex flex-col relative overflow-hidden p-8">
          <div className="absolute inset-0 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3hF0ARMgH8OjgBwDwcAwaGCAcAYaGCAMQ6OAHAPByDBwDAwAP0w8EZk07HIAAAAASUVORK5CYII=')] opacity-20"></div>
          
          <div className="flex-1 flex items-center justify-center relative z-10">
            {isSegmenting && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm rounded-xl">
                <div className="text-white flex flex-col items-center gap-3">
                  <i className="ph-duotone ph-spinner animate-spin text-4xl text-primary"></i>
                  <p className="font-semibold text-sm tracking-wider uppercase">Segmenting Region</p>
                </div>
              </div>
            )}
            
            {resultImage ? (
              <img src={resultImage} alt="Result" className="max-w-full max-h-full object-contain rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.5)]" />
            ) : baseImageUrl ? (
              activeTool === 'crop' ? (
                <div className="relative w-full h-full p-4 flex items-center justify-center">
                  <ImageCropper 
                    src={baseImageUrl} 
                    cropRegion={cropRegion} 
                    setCropRegion={setCropRegion} 
                  />
                </div>
              ) : (
                <div className="relative max-w-full max-h-full flex items-center justify-center shadow-[0_0_50px_rgba(0,0,0,0.5)] rounded-xl cursor-crosshair group">
                  <img 
                    src={baseImageUrl} 
                    alt="Workspace" 
                    className="max-w-full max-h-full object-contain rounded-xl"
                    onClick={handleImageClick}
                  />
                  {Object.entries(masks).map(([refId, maskUrl]) => (
                    <img 
                      key={refId}
                      src={maskUrl} 
                      alt="Mask" 
                      className="absolute inset-0 w-full h-full object-contain pointer-events-none mix-blend-screen rounded-xl"
                      style={{ 
                        filter: activeReferenceId === refId ? 'sepia(1) hue-rotate(200deg) saturate(3) opacity(0.7)' : 'sepia(1) hue-rotate(300deg) saturate(3) opacity(0.3)' 
                      }}
                    />
                  ))}
                </div>
              )
            ) : null}
          </div>
          
          {/* Top Canvas Controls */}
          {activeTool === 'ai' && !resultImage && (
             <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-slate-900/80 backdrop-blur-md px-5 py-2.5 rounded-full border border-slate-700/50 shadow-xl z-20 text-xs text-slate-300 font-medium flex items-center gap-2">
               <i className="ph-fill ph-info text-primary text-lg"></i> Select a reference, then click the image to auto-mask (SAM).
             </div>
          )}
          {resultImage && (
             <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-green-500/10 backdrop-blur-md px-5 py-2.5 rounded-full border border-green-500/50 shadow-xl z-20 text-xs text-green-400 font-medium flex items-center gap-2">
               <i className="ph-fill ph-check-circle text-lg"></i> Generation Complete. Click "Save Changes" to apply.
             </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolButton({ icon, label, active, onClick, highlight }) {
  return (
    <button 
      onClick={onClick}
      title={label}
      className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center transition-all ${active ? (highlight ? 'bg-primary text-white shadow-[0_0_15px_rgba(99,102,241,0.4)]' : 'bg-slate-700 text-white') : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
    >
      <i className={`text-xl ${active ? 'ph-fill' : 'ph-duotone'} ${icon}`}></i>
    </button>
  );
}
