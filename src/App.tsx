import React, { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Mic, Video, StopCircle, Pause, Play, Download, AlertCircle, Maximize2 } from 'lucide-react';
import { useMediaRecorder } from './hooks/useMediaRecorder';

function PiPWindow({ children, onClose }: { children: ReactNode, onClose: () => void }) {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);

  useEffect(() => {
    let activePipWindow: Window | null = null;
    const init = async () => {
      try {
        const dpip = (window as any).documentPictureInPicture;
        activePipWindow = await dpip.requestWindow({ width: 220, height: 160 });
        
        // Copy styles
        Array.from(document.styleSheets).forEach((styleSheet) => {
          try {
            const cssRules = Array.from(styleSheet.cssRules).map((rule) => rule.cssText).join('');
            const style = document.createElement('style');
            style.textContent = cssRules;
            activePipWindow!.document.head.appendChild(style);
          } catch (e) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.type = styleSheet.type;
            link.media = typeof styleSheet.media === 'string' ? styleSheet.media : styleSheet.media.mediaText;
            if (styleSheet.href) link.href = styleSheet.href;
            activePipWindow!.document.head.appendChild(link);
          }
        });

        activePipWindow!.addEventListener('pagehide', () => {
          onClose();
        });
        setPipWindow(activePipWindow);
      } catch (err) {
        console.error("Document PiP error", err);
        onClose();
      }
    };
    init();

    return () => {
      if (activePipWindow) activePipWindow.close();
    };
  }, []);

  if (!pipWindow) return null;
  return createPortal(children, pipWindow.document.body);
}

function App() {
  const {
    isRecording,
    isPaused,
    devices,
    selectedAudioId,
    setSelectedAudioId,
    selectedVideoId,
    setSelectedVideoId,
    isCameraEnabled,
    setIsCameraEnabled,
    isAudioEnabled,
    setIsAudioEnabled,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    screenVideoRef,
    cameraVideoRef,
    attachCameraStream,
    updateCameraPosition,
    recordings,
    error,
    setError
  } = useMediaRecorder();

  const containerRef = useRef<HTMLDivElement>(null);
  const draggableRef = useRef<HTMLDivElement>(null);
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDocumentPipOpen, setIsDocumentPipOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // Handle PWA Install Prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  // Handle Dragging
  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (!draggableRef.current) return;
    setIsDragging(true);
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const rect = draggableRef.current.getBoundingClientRect();
    setDragOffset({
      x: clientX - rect.left,
      y: clientY - rect.top
    });
  };

  const handleMouseMove = (e: MouseEvent | TouchEvent) => {
    if (!isDragging || !containerRef.current || !draggableRef.current) return;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const draggableRect = draggableRef.current.getBoundingClientRect();
    
    let newX = clientX - containerRect.left - dragOffset.x;
    let newY = clientY - containerRect.top - dragOffset.y;
    
    // Constrain to container
    newX = Math.max(0, Math.min(newX, containerRect.width - draggableRect.width));
    newY = Math.max(0, Math.min(newY, containerRect.height - draggableRect.height));
    
    draggableRef.current.style.left = `${newX}px`;
    draggableRef.current.style.top = `${newY}px`;
    
    // Update normalized position for the canvas compositing
    updateCameraPosition(newX / containerRect.width, newY / containerRect.height);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleMouseMove, { passive: false });
      window.addEventListener('touchend', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isDragging]);

  const requestPiP = async () => {
    if ('documentPictureInPicture' in window) {
      setIsDocumentPipOpen(true);
    } else if (cameraVideoRef.current && document.pictureInPictureEnabled) {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          await cameraVideoRef.current.requestPictureInPicture();
        }
      } catch (err) {
        console.error("PiP failed", err);
      }
    }
  };

  return (
    <div className="container">
      {isDocumentPipOpen && (
        <PiPWindow onClose={() => setIsDocumentPipOpen(false)}>
          <div style={{ padding: '1rem', height: '100vh', display: 'flex', flexDirection: 'column', gap: '1rem', background: 'var(--bg-main)' }}>
            <h3 style={{ fontSize: '1rem', borderBottom: '4px solid #000', paddingBottom: '0.5rem', textAlign: 'center' }}>Tapee Controls</h3>

            <div className="flex-col gap-2">
                {!isRecording ? (
                  <button className="btn btn-primary" onClick={startRecording} style={{ width: '100%' }}>
                    <Video size={16} /> Start Recording
                  </button>
                ) : (
                  <>
                    <button className={`btn ${isPaused ? 'btn-primary' : 'btn-secondary'}`} onClick={isPaused ? resumeRecording : pauseRecording} style={{ width: '100%' }}>
                      {isPaused ? <Play size={16} /> : <Pause size={16} />}
                      {isPaused ? 'Resume' : 'Pause'}
                    </button>
                    <button className="btn btn-danger animate-pulse-red" onClick={stopRecording} style={{ width: '100%' }}>
                      <StopCircle size={16} /> Stop Recording
                    </button>
                  </>
                )}
            </div>
          </div>
        </PiPWindow>
      )}

      <header className="mb-8 flex-between">
        <div className="flex-center gap-2">
          <div className="btn-icon">
            <Video size={28} />
          </div>
          <h1 className="text-2xl text-gradient">Tapee</h1>
        </div>
        <div className="text-sm text-muted">
          Screen & Camera Recorder
        </div>
      </header>

      {error && (
        <div className="glass-panel p-4 mb-6 flex-center gap-2" style={{ background: 'var(--accent-pink)' }}>
          <AlertCircle color="#000" />
          <span style={{ color: '#000', fontWeight: 800 }}>{error}</span>
          <button className="btn btn-secondary ml-auto" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '2rem', alignItems: 'start' }} className="controls-grid">
        
        {/* Main Preview Area */}
        <div className="flex-col gap-4">
          <div className="preview-container" ref={containerRef}>
            {/* Screen Video */}
            <video 
              ref={screenVideoRef} 
              className="preview-video" 
              autoPlay 
              playsInline 
              muted 
            />
            
            {/* Draggable Camera Overlay */}
            {isCameraEnabled && (
              <div 
                className="camera-draggable" 
                ref={draggableRef}
                onMouseDown={handleMouseDown}
                onTouchStart={handleMouseDown}
                style={{ left: '5%', top: '5%' }}
              >
                <video 
                  ref={attachCameraStream} 
                  className="camera-video" 
                  autoPlay 
                  playsInline 
                  muted 
                />
              </div>
            )}
            
            {!isRecording && !isPaused && (
              <div className="flex-center flex-col gap-2" style={{ position: 'absolute', inset: 0, background: 'rgba(253, 224, 71, 0.8)', pointerEvents: 'none' }}>
                <Video size={48} color="#000" />
                <p style={{ fontWeight: 800, color: '#000' }}>READY TO RECORD</p>
              </div>
            )}
          </div>

          <div className="glass-panel p-4 flex-center gap-4">
            {!isRecording ? (
              <button className="btn btn-primary" onClick={startRecording} style={{ width: '100%' }}>
                <Video size={20} />
                Start Recording
              </button>
            ) : (
              <>
                <button className={`btn ${isPaused ? 'btn-primary' : 'btn-secondary'}`} onClick={isPaused ? resumeRecording : pauseRecording} style={{ flex: 1 }}>
                  {isPaused ? <Play size={20} /> : <Pause size={20} />}
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
                <button className="btn btn-danger animate-pulse-red" onClick={stopRecording} style={{ flex: 2 }}>
                  <StopCircle size={20} />
                  Stop Recording
                </button>
              </>
            )}
          </div>
        </div>

        {/* Sidebar Controls */}
        <div className="flex-col gap-6">
          <div className="glass-panel p-6 flex-col gap-6">
            <h3 className="text-lg">Settings</h3>

            {deferredPrompt && (
              <button 
                className="btn btn-primary mb-4" 
                onClick={handleInstallClick} 
                style={{ width: '100%' }}
              >
                <Download size={16} /> Install App
              </button>
            )}

            <div className="flex-col gap-2">
              <label className="flex-between gap-2" style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
                <span className="flex-center gap-2" title="Always-on-top global recording controls"><Maximize2 size={16} /> Floating Controls</span>
                <input 
                  type="checkbox" 
                  checked={isDocumentPipOpen} 
                  onChange={e => {
                    if (e.target.checked) {
                      requestPiP();
                    } else {
                      setIsDocumentPipOpen(false);
                    }
                  }} 
                />
              </label>
            </div>
            
            <div className="flex-col gap-2">
              <label className="flex-between gap-2" style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
                <span className="flex-center gap-2"><Mic size={16} /> Microphone</span>
                <input type="checkbox" checked={isAudioEnabled} onChange={e => setIsAudioEnabled(e.target.checked)} />
              </label>
              {isAudioEnabled && (
                <select 
                  value={selectedAudioId} 
                  onChange={e => setSelectedAudioId(e.target.value)}
                  disabled={isRecording}
                >
                  <option value="default">System Default</option>
                  {devices.audio.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0,5)}`}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex-col gap-2">
              <label className="flex-between gap-2" style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
                <span className="flex-center gap-2"><Camera size={16} /> Camera</span>
                <input type="checkbox" checked={isCameraEnabled} onChange={e => setIsCameraEnabled(e.target.checked)} />
              </label>
              {isCameraEnabled && (
                <select 
                  value={selectedVideoId} 
                  onChange={e => setSelectedVideoId(e.target.value)}
                  disabled={isRecording}
                >
                  <option value="default">System Default</option>
                  {devices.video.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0,5)}`}</option>
                  ))}
                </select>
              )}
            </div>
            <p className="text-sm text-muted" style={{ borderTop: '2px solid #000', paddingTop: '1rem', marginTop: '1rem' }}>
              System audio will be captured automatically when you share your screen.
            </p>
          </div>

          <div className="glass-panel p-6 flex-col gap-4">
            <h3 className="text-lg">Recordings</h3>
            {recordings.length === 0 ? (
              <p className="text-sm text-muted text-center py-4">No recordings yet.</p>
            ) : (
              <div className="flex-col gap-2">
                {recordings.map((rec, i) => (
                  <div key={i} className="flex-between p-2" style={{ background: 'var(--accent-yellow)', border: '2px solid #000' }}>
                    <span className="text-sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px', fontWeight: 600 }}>
                      {rec.name}
                    </span>
                    <a href={rec.url} download={rec.name} className="btn-icon" style={{ width: 32, height: 32, padding: 0 }} title="Download">
                      <Download size={16} />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
