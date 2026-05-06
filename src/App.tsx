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
    updateCameraTransform,
    recordings,
    error,
    setError,
    cameraShape,
    setCameraShape,
    isBgRemovalEnabled,
    setIsBgRemovalEnabled,
    customBgImage,
    setCustomBgImage
  } = useMediaRecorder();

  const containerRef = useRef<HTMLDivElement>(null);
  const draggableRef = useRef<HTMLDivElement>(null);
  
  const [isDocumentPipOpen, setIsDocumentPipOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  type InteractionMode = 'idle' | 'drag' | 'resize' | 'rotate';
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('idle');
  const transformRef = useRef({ x: 0.05, y: 0.05, scale: 0.2, rotation: 0 });
  const interactionStartRef = useRef({ mouseX: 0, mouseY: 0, startX: 0, startY: 0, startScale: 0, startRotation: 0, startW: 0, startH: 0, cw: 0, ch: 0 });

  useEffect(() => {
    // Initial sync
    updateCameraTransform(transformRef.current.x, transformRef.current.y, transformRef.current.scale, transformRef.current.rotation);
  }, [updateCameraTransform]);


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

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent, mode: InteractionMode) => {
    if (!draggableRef.current || !containerRef.current) return;
    if (mode !== 'drag') e.stopPropagation();
    
    setInteractionMode(mode);
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    
    interactionStartRef.current = {
      mouseX: clientX,
      mouseY: clientY,
      startX: transformRef.current.x,
      startY: transformRef.current.y,
      startScale: transformRef.current.scale,
      startRotation: transformRef.current.rotation,
      startW: containerRect.width * transformRef.current.scale,
      startH: (containerRect.width * transformRef.current.scale) / (cameraShape === 'circle' ? 1 : (16/9)),
      cw: containerRect.width,
      ch: containerRect.height
    };
  };

  const handlePointerMove = (e: MouseEvent | TouchEvent) => {
    if (interactionMode === 'idle' || !containerRef.current || !draggableRef.current) return;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
    
    const start = interactionStartRef.current;
    const dx = clientX - start.mouseX;
    const dy = clientY - start.mouseY;
    
    let newX = start.startX;
    let newY = start.startY;
    let newScale = start.startScale;
    let newRotation = start.startRotation;
    
    if (interactionMode === 'drag') {
      newX = start.startX + (dx / start.cw);
      newY = start.startY + (dy / start.ch);
      
      // Bounding constraints
      const maxNormX = 1 - newScale;
      const aspect = cameraShape === 'circle' ? 1 : (16/9);
      const hScale = (newScale * start.cw) / aspect / start.ch;
      const maxNormY = 1 - hScale;
      
      newX = Math.max(0, Math.min(newX, maxNormX));
      newY = Math.max(0, Math.min(newY, maxNormY));
      
    } else if (interactionMode === 'resize') {
      const newWidth = start.startW + dx;
      newScale = Math.max(0.1, Math.min(1.0, newWidth / start.cw)); // min 10%, max 100% width
      
      // Bounding constraints: don't scale beyond screen edges
      const maxScaleX = 1 - newX;
      const aspect = cameraShape === 'circle' ? 1 : (16/9);
      const maxScaleY = (1 - newY) * start.ch * aspect / start.cw;
      newScale = Math.min(newScale, maxScaleX, maxScaleY);
      
    } else if (interactionMode === 'rotate') {
      newRotation = start.startRotation + (dx / 2);
    }
    
    transformRef.current = { x: newX, y: newY, scale: newScale, rotation: newRotation };
    updateCameraTransform(newX, newY, newScale, newRotation);
    
    const el = draggableRef.current;
    el.style.left = `${newX * 100}%`;
    el.style.top = `${newY * 100}%`;
    el.style.width = `${newScale * 100}%`;
    el.style.transform = `rotate(${newRotation}deg)`;
  };

  const handlePointerUp = () => {
    setInteractionMode('idle');
  };

  useEffect(() => {
    if (interactionMode !== 'idle') {
      window.addEventListener('mousemove', handlePointerMove);
      window.addEventListener('mouseup', handlePointerUp);
      window.addEventListener('touchmove', handlePointerMove, { passive: false });
      window.addEventListener('touchend', handlePointerUp);
    } else {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
    }
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [interactionMode]);

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

            {isCameraEnabled && (
              <div style={{
                flex: 1, 
                border: cameraShape === 'none' ? 'none' : '4px solid #000', 
                overflow: 'hidden', 
                background: cameraShape === 'none' ? 'transparent' : 'var(--accent-cyan)', 
                position: 'relative',
                borderRadius: cameraShape === 'circle' ? '50%' : '0',
                aspectRatio: cameraShape === 'circle' ? '1 / 1' : 'auto',
                margin: cameraShape === 'circle' ? '0 auto' : '0',
                maxHeight: cameraShape === 'circle' ? '100%' : 'auto',
                boxShadow: cameraShape === 'none' ? 'none' : '4px 4px 0 #000',
              }}>
                <video 
                  autoPlay 
                  playsInline 
                  muted 
                  ref={(el) => { if (el) { el.srcObject = cameraVideoRef.current?.srcObject || null; } }}
                  style={{ 
                    width: '100%', height: '100%', objectFit: 'cover', 
                    transform: 'scaleX(-1)',
                    borderRadius: cameraShape === 'circle' ? '50%' : '0'
                  }} 
                />
              </div>
            )}

            <div className="flex-col gap-2 mt-auto">
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
                onMouseDown={(e) => handlePointerDown(e, 'drag')}
                onTouchStart={(e) => handlePointerDown(e, 'drag')}
                style={{ 
                   left: `${transformRef.current.x * 100}%`, 
                   top: `${transformRef.current.y * 100}%`,
                   width: `${transformRef.current.scale * 100}%`,
                   transform: `rotate(${transformRef.current.rotation}deg)`,
                   borderRadius: cameraShape === 'circle' ? '50%' : '0',
                   aspectRatio: cameraShape === 'circle' ? '1 / 1' : '16 / 9',
                   background: cameraShape === 'none' ? 'transparent' : 'var(--accent-cyan)',
                   border: cameraShape === 'none' ? 'none' : '4px solid #000',
                   boxShadow: cameraShape === 'none' ? 'none' : '4px 4px 0 #000',
                   padding: cameraShape === 'none' ? '0' : '4px',
                   touchAction: 'none'
                }}
              >
                <div 
                   className="transform-handle rotate-handle" 
                   onMouseDown={(e) => handlePointerDown(e, 'rotate')}
                   onTouchStart={(e) => handlePointerDown(e, 'rotate')}
                >
                   ⟳
                </div>
                
                <video 
                  ref={attachCameraStream} 
                  className="camera-video" 
                  autoPlay 
                  playsInline 
                  muted 
                  style={{ 
                     borderRadius: cameraShape === 'circle' ? '50%' : '0',
                     border: cameraShape === 'none' ? 'none' : '2px solid #000',
                     pointerEvents: 'none'
                  }}
                />

                <div 
                   className="transform-handle resize-handle" 
                   onMouseDown={(e) => handlePointerDown(e, 'resize')}
                   onTouchStart={(e) => handlePointerDown(e, 'resize')}
                >
                   ⤡
                </div>
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
              <label className="flex-between gap-2" style={{ justifyContent: 'space-between' }}>
                <span className="flex-center gap-2">Shape</span>
              </label>
              <select value={cameraShape} onChange={e => setCameraShape(e.target.value as any)} disabled={isRecording}>
                 <option value="rectangle">Rectangle</option>
                 <option value="circle">Circle</option>
                 <option value="none">None (Transparent)</option>
              </select>
            </div>

            <div className="flex-col gap-2">
              <label className="flex-between gap-2" style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
                <span className="flex-center gap-2" title="Uses local AI to remove your background">Remove BG</span>
                <input type="checkbox" checked={isBgRemovalEnabled} onChange={e => setIsBgRemovalEnabled(e.target.checked)} />
              </label>

              {isBgRemovalEnabled && (
                <div style={{ marginTop: '0.5rem', background: 'var(--bg-main)', padding: '0.5rem', border: '2px solid #000' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Virtual Background Image</label>
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setCustomBgImage(URL.createObjectURL(file));
                      } else {
                        setCustomBgImage(null);
                      }
                    }} 
                    style={{ fontSize: '0.8rem', width: '100%' }}
                  />
                  {customBgImage && (
                    <button className="btn btn-sm mt-2" onClick={() => setCustomBgImage(null)} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', width: '100%' }}>
                      Clear Background
                    </button>
                  )}
                </div>
              )}
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
