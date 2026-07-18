import { useState, useRef } from 'react'
import VideoUploader from './components/VideoUploader'
import VideoPlayer from './components/VideoPlayer'
import Controls from './components/Controls'
import ImageTools from './components/ImageTools'
import PreviewModal from './components/PreviewModal'
import { saveAs } from 'file-saver'

function App() {
  const [previewData, setPreviewData] = useState(null)
  const [videoFile, setVideoFile] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)
  const [watermarkRegion, setWatermarkRegion] = useState(null) // {x, y, w, h}
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isUpscale, setIsUpscale] = useState(false)
  const [activeTab, setActiveTab] = useState('video')
  
  const videoRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const handleTogglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play()
      setIsPlaying(true)
    } else {
      videoRef.current.pause()
      setIsPlaying(false)
    }
  }

  const handleSeek = (val) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = val
    setCurrentTime(val)
  }

  const handleFileUpload = (file) => {
    if (file && file.type.startsWith('video/')) {
      setVideoFile(file)
      setVideoUrl(URL.createObjectURL(file))
      setWatermarkRegion(null)
      setCurrentTime(0)
    } else {
      alert("Please upload a valid video file.")
    }
  }

  const handleExportSingle = async (format) => {
    if (!videoFile || isProcessing) return;
    setIsProcessing(true);

    const formData = new FormData();
    formData.append('file', videoFile);
    formData.append('timestamp', currentTime);
    formData.append('format', format);
    formData.append('scale', isUpscale ? 2.0 : 1.0);
    
    if (watermarkRegion) {
      formData.append('x', watermarkRegion.x);
      formData.append('y', watermarkRegion.y);
      formData.append('w', watermarkRegion.w);
      formData.append('h', watermarkRegion.h);
    }

    try {
      const response = await fetch('http://localhost:8000/api/export/single', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error("Failed to export frame");
      
      const blob = await response.blob();
      const ext = format === 'image/jpeg' ? 'jpg' : format === 'image/webp' ? 'webp' : 'png';
      setPreviewData({ blob, filename: `frame_${currentTime.toFixed(2).replace('.','_')}s.${ext}`, originalFile: videoFile });
    } catch (err) {
      alert(err.message);
    } finally {
      setIsProcessing(false);
    }
  }

  const handleExportMultiple = async (fps, format) => {
    if (!videoFile || isProcessing) return;
    setIsProcessing(true);

    const formData = new FormData();
    formData.append('file', videoFile);
    formData.append('fps', fps);
    formData.append('format', format);
    formData.append('scale', isUpscale ? 2.0 : 1.0);
    
    if (watermarkRegion) {
      formData.append('x', watermarkRegion.x);
      formData.append('y', watermarkRegion.y);
      formData.append('w', watermarkRegion.w);
      formData.append('h', watermarkRegion.h);
    }
    
    if (options.startTime !== undefined && options.startTime !== '') formData.append('start_time', options.startTime);
    if (options.endTime !== undefined && options.endTime !== '') formData.append('end_time', options.endTime);
    if (options.watermarkText) {
      formData.append('watermark_text', options.watermarkText);
      formData.append('watermark_position', options.watermarkPosition || 'bottom-right');
    }

    try {
      const response = await fetch('http://localhost:8000/api/export/multiple', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error("Failed to export frames");
      
      const blob = await response.blob();
      setPreviewData({ blob, filename: "video_frames.zip", originalFile: videoFile });
    } catch (err) {
      alert(err.message);
    } finally {
      setIsProcessing(false);
    }
  }

  const handleExportVideo = async (format = 'video/mp4', options = {}) => {
    if (!videoFile || isProcessing) {
      return;
    }
    setIsProcessing(true);

    const formData = new FormData();
    formData.append('file', videoFile);
    formData.append('scale', isUpscale ? 2.0 : 1.0);
    formData.append('format', format);
    
    if (watermarkRegion) {
      formData.append('x', watermarkRegion.x);
      formData.append('y', watermarkRegion.y);
      formData.append('w', watermarkRegion.w);
      formData.append('h', watermarkRegion.h);
    }
    
    if (options.startTime !== undefined && options.startTime !== '') formData.append('start_time', options.startTime);
    if (options.endTime !== undefined && options.endTime !== '') formData.append('end_time', options.endTime);
    if (options.watermarkText) {
      formData.append('watermark_text', options.watermarkText);
      formData.append('watermark_position', options.watermarkPosition || 'bottom-right');
    }

    try {
      const response = await fetch('http://localhost:8000/api/export/video', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error("Failed to export video");
      
      const blob = await response.blob();
      const filename = format === 'image/gif' ? 'exported.gif' : 'cleaned_video.mp4';
      setPreviewData({ blob, filename, originalFile: videoFile });
    } catch (err) {
      alert(err.message);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto p-8 flex flex-col gap-8">
      <header className="flex flex-col items-center text-center animate-fade-in-down mb-2">
        <div className="flex items-center gap-3 text-4xl text-primary mb-2">
          <i className="ph-fill ph-film-strip drop-shadow-[0_0_10px_rgba(99,102,241,0.5)]"></i>
          <h1 className="font-bold bg-gradient-to-r from-primary to-purple-500 bg-clip-text text-transparent">FrameX</h1>
        </div>
        <p className="text-slate-400 font-light text-lg mb-6">Professional Media Extraction & AI Inpainting</p>
        
        <div className="flex bg-slate-800/50 p-1 rounded-xl border border-slate-700/50">
          <button
            onClick={() => setActiveTab('video')}
            className={`px-6 py-2.5 rounded-lg font-semibold flex items-center gap-2 transition-all ${activeTab === 'video' ? 'bg-primary text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}
          >
            <i className="ph-fill ph-video-camera"></i>
            Video Tools
          </button>
          <button
            onClick={() => setActiveTab('image')}
            className={`px-6 py-2.5 rounded-lg font-semibold flex items-center gap-2 transition-all ${activeTab === 'image' ? 'bg-primary text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}
          >
            <i className="ph-fill ph-image"></i>
            Image & PDF Tools
          </button>
        </div>
      </header>

      {activeTab === 'video' ? (
        <main className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 animate-fade-in-up">
          <section className="flex flex-col">
            <div className="glass-card aspect-video relative overflow-hidden flex items-center justify-center transition-all duration-300 hover:border-primary hover:shadow-[0_0_20px_rgba(99,102,241,0.3)]">
              {!videoUrl ? (
                <VideoUploader onUpload={handleFileUpload} />
              ) : (
                <VideoPlayer 
                  src={videoUrl} 
                  videoRef={videoRef}
                  watermarkRegion={watermarkRegion}
                  setWatermarkRegion={setWatermarkRegion}
                  onTimeUpdate={setCurrentTime}
                  onDurationChange={setDuration}
                  isPlaying={isPlaying}
                  setIsPlaying={setIsPlaying}
                />
              )}
            </div>
          </section>

          <section className="flex flex-col gap-6">
            <Controls 
              onExportSingle={handleExportSingle}
              onExportMultiple={handleExportMultiple}
              onExportVideo={handleExportVideo}
              isProcessing={isProcessing}
              hasVideo={!!videoFile}
              duration={duration}
              currentTime={currentTime}
              isPlaying={isPlaying}
              isUpscale={isUpscale}
              setIsUpscale={setIsUpscale}
              onTogglePlay={handleTogglePlay}
              onSeek={handleSeek}
            />
          </section>
        </main>
      ) : (
        <ImageTools onPreviewReady={(blob, filename, originalFile) => setPreviewData({ blob, filename, originalFile })} />
      )}

      {previewData && (
        <PreviewModal 
          blob={previewData.blob} 
          filename={previewData.filename} 
          originalFile={previewData.originalFile}
          onClose={() => setPreviewData(null)} 
        />
      )}
    </div>
  )
}

export default App
