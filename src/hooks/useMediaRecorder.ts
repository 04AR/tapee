import { useState, useRef, useEffect, useCallback } from 'react';

interface DeviceList {
  audio: MediaDeviceInfo[];
  video: MediaDeviceInfo[];
}

export const useMediaRecorder = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [devices, setDevices] = useState<DeviceList>({ audio: [], video: [] });
  const [selectedAudioId, setSelectedAudioId] = useState<string>('default');
  const [selectedVideoId, setSelectedVideoId] = useState<string>('default');
  const [error, setError] = useState<string | null>(null);
  
  const [recordings, setRecordings] = useState<{ url: string, name: string }[]>([]);

  const [cameraShape, setCameraShape] = useState<'rectangle' | 'circle' | 'none'>('rectangle');
  const [isBgRemovalEnabled, setIsBgRemovalEnabled] = useState(false);
  const [customBgImage, setCustomBgImage] = useState<string | null>(null);

  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null); // For UI
  const rawCameraVideoRef = useRef<HTMLVideoElement>(document.createElement('video')); // Hidden for processing
  const processedCameraCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const selfieSegmentationRef = useRef<any>(null);
  const isSegmentingRef = useRef(false);
  const customBgImageRef = useRef<HTMLImageElement | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const bgWorkerRef = useRef<Worker | null>(null);
  const rawCameraStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  // Position, scale, and rotation for the camera overlay
  // x, y are normalized 0-1 relative to screen width/height
  // scale is normalized relative to screen width
  // rotation is in degrees
  const cameraTransformRef = useRef({ x: 0.05, y: 0.05, scale: 0.2, rotation: 0 }); 

  // Audio Context for mixing
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Silent Audio for MediaSession trick
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Initial load of devices and worker
  useEffect(() => {
    const getDevices = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); // Request permission to see labels
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        setDevices({
          audio: allDevices.filter(d => d.kind === 'audioinput'),
          video: allDevices.filter(d => d.kind === 'videoinput')
        });
      } catch (err) {
        console.error("Error fetching devices", err);
        setError("Could not access camera/microphone. Please check permissions.");
      }
    };
    getDevices();
    
    // Setup hidden raw camera video
    rawCameraVideoRef.current.autoplay = true;
    rawCameraVideoRef.current.playsInline = true;
    rawCameraVideoRef.current.muted = true;

    // Create hidden elements for compositing
    if (!compositeCanvasRef.current) {
      compositeCanvasRef.current = document.createElement('canvas');
      compositeCanvasRef.current.width = 1920;
      compositeCanvasRef.current.height = 1080;
    }
    
    if (!processedCameraCanvasRef.current) {
      processedCameraCanvasRef.current = document.createElement('canvas');
      cameraStreamRef.current = processedCameraCanvasRef.current.captureStream(30);
    }

    // Setup Web Worker to drive the rendering loop (bypasses background tab throttling)
    const workerCode = `
      let intervalId = null;
      self.onmessage = function(e) {
        if (e.data === 'start') {
          intervalId = setInterval(() => self.postMessage('tick'), 1000 / 30);
        } else if (e.data === 'stop') {
          if (intervalId) clearInterval(intervalId);
          intervalId = null;
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    workerRef.current = new Worker(URL.createObjectURL(blob));
    bgWorkerRef.current = new Worker(URL.createObjectURL(blob));
    bgWorkerRef.current.postMessage('start');
    
    // Setup Silent Audio Loop for MediaSession Notification
    const audio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA");
    audio.loop = true;
    silentAudioRef.current = audio;
    
    return () => {
      stopScreenTracks();
      stopCameraTracks();
      if (workerRef.current) {
        workerRef.current.postMessage('stop');
        workerRef.current.terminate();
      }
      if (bgWorkerRef.current) {
        bgWorkerRef.current.postMessage('stop');
        bgWorkerRef.current.terminate();
      }
      audio.pause();
    };
  }, []);

  const stopScreenTracks = () => {
    if (screenVideoRef.current && screenVideoRef.current.srcObject) {
      const stream = screenVideoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      screenVideoRef.current.srcObject = null;
    }
  };

  const stopCameraTracks = () => {
    if (rawCameraStreamRef.current) {
      rawCameraStreamRef.current.getTracks().forEach(track => track.stop());
      rawCameraStreamRef.current = null;
    }
    if (rawCameraVideoRef.current) rawCameraVideoRef.current.srcObject = null;
  };

  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);

  // Keep camera feed active regardless of recording state
  useEffect(() => {
    const startCamera = async () => {
      if (!isCameraEnabled && !isAudioEnabled) {
         stopCameraTracks();
         return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: isCameraEnabled ? { deviceId: selectedVideoId !== 'default' ? { exact: selectedVideoId } : undefined } : false,
          audio: isAudioEnabled ? { deviceId: selectedAudioId !== 'default' ? { exact: selectedAudioId } : undefined } : false
        });
        stopCameraTracks();
        rawCameraStreamRef.current = stream;
        rawCameraVideoRef.current.srcObject = stream;
        
        // Wait for video to load metadata so we have dimensions
        rawCameraVideoRef.current.onloadedmetadata = async () => {
          rawCameraVideoRef.current.width = rawCameraVideoRef.current.videoWidth;
          rawCameraVideoRef.current.height = rawCameraVideoRef.current.videoHeight;
          await rawCameraVideoRef.current.play();
          
          // Re-attach the processed stream to the UI
          if (cameraVideoRef.current && cameraStreamRef.current) {
            cameraVideoRef.current.srcObject = cameraStreamRef.current;
          }
        };
      } catch (err) {
        console.error("Camera preview failed", err);
      }
    };
    startCamera();
  }, [selectedVideoId, selectedAudioId, isCameraEnabled, isAudioEnabled]);

  // Load Custom BG Image
  useEffect(() => {
    if (customBgImage) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = customBgImage;
      img.onload = () => {
        customBgImageRef.current = img;
      };
    } else {
      customBgImageRef.current = null;
    }
  }, [customBgImage]);

  // Load MediaPipe
  useEffect(() => {
    if (isBgRemovalEnabled && !selfieSegmentationRef.current) {
      import('@mediapipe/selfie_segmentation').then((module) => {
        const SelfieSegmentationClass = module.SelfieSegmentation || (module.default as any)?.SelfieSegmentation || (window as any).SelfieSegmentation;
        if (!SelfieSegmentationClass) {
           console.error("Could not find SelfieSegmentation in module", module);
           return;
        }
        const selfieSegmentation = new SelfieSegmentationClass({locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
        }});
        selfieSegmentation.setOptions({
          modelSelection: 1, // 0 for general, 1 for landscape (faster)
        });
        selfieSegmentation.onResults((results) => {
          if (!processedCameraCanvasRef.current) return;
          const ctx = processedCameraCanvasRef.current.getContext('2d');
          if (!ctx) return;
          
          ctx.save();
          ctx.clearRect(0, 0, processedCameraCanvasRef.current.width, processedCameraCanvasRef.current.height);
          
          // Draw the mask
          ctx.drawImage(results.segmentationMask, 0, 0, processedCameraCanvasRef.current.width, processedCameraCanvasRef.current.height);
          
          // Only overwrite existing pixels with the raw camera frame
          ctx.globalCompositeOperation = 'source-in';
          ctx.drawImage(results.image, 0, 0, processedCameraCanvasRef.current.width, processedCameraCanvasRef.current.height);
          
          // Inject custom background behind the masked image
          if (customBgImageRef.current) {
            ctx.globalCompositeOperation = 'destination-over';
            ctx.drawImage(customBgImageRef.current, 0, 0, processedCameraCanvasRef.current.width, processedCameraCanvasRef.current.height);
          }
          
          ctx.restore();
          isSegmentingRef.current = false;
        });
        
        // Pre-initialize to download model early
        selfieSegmentation.initialize().then(() => {
          selfieSegmentationRef.current = selfieSegmentation;
        }).catch(err => {
          console.error("Failed to initialize SelfieSegmentation", err);
        });
      });
    }
  }, [isBgRemovalEnabled]);

  // Process frames loop
  useEffect(() => {
    let isProcessing = false;
    const processFrame = async () => {
      if (isProcessing) return;
      isProcessing = true;
      
      const video = rawCameraVideoRef.current;
      if (isCameraEnabled && video && video.readyState >= 2 && processedCameraCanvasRef.current) {
        const canvas = processedCameraCanvasRef.current;
        if (canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        if (isBgRemovalEnabled && selfieSegmentationRef.current) {
          if (!isSegmentingRef.current) {
            isSegmentingRef.current = true;
            await selfieSegmentationRef.current.send({ image: video }).catch((err: any) => {
              console.error("MediaPipe inference error:", err);
              isSegmentingRef.current = false;
            });
          }
        } else {
          // No BG removal, just draw the raw frame to canvas
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }
        }
      }
      isProcessing = false;
    };
    
    if (bgWorkerRef.current) {
      bgWorkerRef.current.onmessage = () => {
        processFrame();
      };
    }
    
    return () => {
      if (bgWorkerRef.current) {
         bgWorkerRef.current.onmessage = null;
      }
    };
  }, [isCameraEnabled, isBgRemovalEnabled]);

  const attachCameraStream = useCallback((videoElement: HTMLVideoElement | null) => {
    cameraVideoRef.current = videoElement;
    if (videoElement && cameraStreamRef.current) {
      videoElement.srcObject = cameraStreamRef.current;
      videoElement.play().catch(console.error);
    }
  }, []);

  const getStreams = async () => {
    stopScreenTracks();
    setError(null);
    try {
      let screenStream: MediaStream | null = null;
      
      // 1. Get Screen Stream (if supported by browser/device)
      if (navigator.mediaDevices.getDisplayMedia) {
        try {
          screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: 'monitor' },
            audio: true // system audio
          });
        } catch (e) {
          console.warn("Screen sharing cancelled or failed", e);
        }
      }

      if (!screenStream && !isCameraEnabled) {
         throw new Error("Screen sharing is not supported/granted. Please enable Camera to record.");
      }

      if (screenStream && screenVideoRef.current) {
        screenVideoRef.current.srcObject = screenStream;
        await screenVideoRef.current.play();
      }

      // 2. Camera stream is already active from the useEffect above
      const cameraStream = (isCameraEnabled || isAudioEnabled) ? cameraStreamRef.current : null;

      return { screenStream, cameraStream };
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to start capture");
      return null;
    }
  };

  // Called by the Web Worker tick to draw a single frame
  const drawComposite = useCallback(() => {
    if (!compositeCanvasRef.current) return;
    const ctx = compositeCanvasRef.current.getContext('2d');
    if (!ctx) return;

    const hasScreen = screenVideoRef.current && screenVideoRef.current.videoWidth > 0 && screenVideoRef.current.srcObject;
    const hasCamera = isCameraEnabled && cameraVideoRef.current && cameraVideoRef.current.videoWidth > 0;

    if (!hasScreen && !hasCamera) return;

    // Sync canvas size
    if (hasScreen) {
      if (compositeCanvasRef.current.width !== screenVideoRef.current!.videoWidth) {
        compositeCanvasRef.current.width = screenVideoRef.current!.videoWidth;
        compositeCanvasRef.current.height = screenVideoRef.current!.videoHeight;
      }
    } else if (hasCamera) {
      if (compositeCanvasRef.current.width !== cameraVideoRef.current!.videoWidth) {
        compositeCanvasRef.current.width = cameraVideoRef.current!.videoWidth;
        compositeCanvasRef.current.height = cameraVideoRef.current!.videoHeight;
      }
    }

    const cW = compositeCanvasRef.current.width;
    const cH = compositeCanvasRef.current.height;

    // Draw Screen or Background
    if (hasScreen) {
      ctx.drawImage(screenVideoRef.current!, 0, 0, cW, cH);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cW, cH);
    }

    // Draw Camera
    if (hasCamera) {
      if (hasScreen) {
        // Draw Camera as PiP
        const videoW = cameraVideoRef.current!.videoWidth || 1280;
        const videoH = cameraVideoRef.current!.videoHeight || 720;
        const camAspect = videoW / videoH;
        
        const scale = cameraTransformRef.current.scale ?? 0.2;
        const rot = cameraTransformRef.current.rotation ?? 0;
        const tx = cameraTransformRef.current.x ?? 0.05;
        const ty = cameraTransformRef.current.y ?? 0.05;

        const pipWidth = cW * scale;
        const pipHeight = pipWidth / camAspect;
        
        const posX = tx * cW;
        const posY = ty * cH;
        const rotationRad = (rot * Math.PI) / 180;

        ctx.save();
        
        // Translate to the center of the PiP to apply rotation
        ctx.translate(posX + pipWidth / 2, posY + pipHeight / 2);
        ctx.rotate(rotationRad);
        ctx.translate(-pipWidth / 2, -pipHeight / 2);
        
        if (cameraShape !== 'none') {
          ctx.shadowColor = '#000';
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 8;
          ctx.shadowOffsetY = 8;
        }
        
        ctx.beginPath();
        
        if (cameraShape === 'circle') {
           const radius = pipWidth / 2;
           // For circle, we want a square aspect ratio. Let's adjust pipHeight to equal pipWidth
           const adjustedPipHeight = pipWidth;
           ctx.arc(radius, radius, radius, 0, Math.PI * 2);
           ctx.fillStyle = '#22d3ee';
           ctx.fill();
           ctx.lineWidth = 6;
           ctx.strokeStyle = '#000';
           ctx.stroke();
           ctx.clip();
           
           // Mirror camera horizontally
           ctx.translate(pipWidth, 0);
           ctx.scale(-1, 1);
           
           // We need to center the camera video in the square box
           const srcAspect = videoW / videoH;
           let drawW = pipWidth;
           let drawH = pipWidth / srcAspect;
           if (drawH < adjustedPipHeight) {
              drawH = adjustedPipHeight;
              drawW = adjustedPipHeight * srcAspect;
           }
           const offX = (drawW - pipWidth) / 2;
           const offY = (drawH - adjustedPipHeight) / 2;
           
           ctx.drawImage(cameraVideoRef.current!, -offX, -offY, drawW, drawH);
        } else if (cameraShape === 'none') {
           ctx.rect(0, 0, pipWidth, pipHeight);
           ctx.clip();
           
           // Mirror camera horizontally
           ctx.translate(pipWidth, 0);
           ctx.scale(-1, 1);
           ctx.drawImage(cameraVideoRef.current!, 0, 0, pipWidth, pipHeight);
        } else {
           ctx.rect(0, 0, pipWidth, pipHeight);
           ctx.fillStyle = '#22d3ee'; // Cyan background behind video
           ctx.fill();
           ctx.lineWidth = 6;
           ctx.strokeStyle = '#000';
           ctx.stroke();
           ctx.clip();

           // Mirror camera horizontally
           ctx.translate(pipWidth, 0);
           ctx.scale(-1, 1);
           ctx.drawImage(cameraVideoRef.current!, 0, 0, pipWidth, pipHeight);
        }
        ctx.restore();
      } else {
        // Draw Camera Full Screen (mirrored)
        ctx.save();
        ctx.translate(cW, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(cameraVideoRef.current!, 0, 0, cW, cH);
        ctx.restore();
      }
    }
  }, [isCameraEnabled, cameraShape]);

  const startRecording = async () => {
    const streams = await getStreams();
    if (!streams) return;

    const { screenStream } = streams;

    // Start render loop via Web Worker
    if (workerRef.current) {
      workerRef.current.onmessage = () => {
        if (!isPaused) drawComposite();
      };
      workerRef.current.postMessage('start');
    }

    // Setup Canvas Stream for Video
    const canvasStream = compositeCanvasRef.current!.captureStream(30);

    // Setup Web Audio for Audio mixing
    audioContextRef.current = new AudioContext();
    const destNode = audioContextRef.current.createMediaStreamDestination();

    // Mix Mic Audio
    if (isAudioEnabled && rawCameraStreamRef.current && rawCameraStreamRef.current.getAudioTracks().length > 0) {
      const micSource = audioContextRef.current.createMediaStreamSource(new MediaStream([rawCameraStreamRef.current.getAudioTracks()[0]]));
      micSource.connect(destNode);
    }

    // Mix System Audio
    if (screenStream && screenStream.getAudioTracks().length > 0) {
      const sysSource = audioContextRef.current.createMediaStreamSource(new MediaStream([screenStream.getAudioTracks()[0]]));
      sysSource.connect(destNode);
    }

    // Combine Video and Mixed Audio
    const mixedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...destNode.stream.getAudioTracks()
    ]);

    // Setup Recorder
    const options = { mimeType: 'video/webm; codecs=vp9' };
    let recorder;
    try {
      recorder = new MediaRecorder(mixedStream, options);
    } catch (e) {
      recorder = new MediaRecorder(mixedStream); // fallback
    }

    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      setRecordings(prev => [...prev, { url, name: `Recording_${new Date().toLocaleString().replace(/[/,: ]/g, '_')}.webm` }]);
      
      // Stop the screen recording tracks, but KEEP the camera tracks alive for the preview
      stopScreenTracks();
      
      if (workerRef.current) {
        workerRef.current.postMessage('stop');
      }
      if (audioContextRef.current) audioContextRef.current.close();
      
      if (silentAudioRef.current) silentAudioRef.current.pause();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('play', null);
        try { navigator.mediaSession.setActionHandler('stop', null); } catch (e) {}
      }
      
      setIsRecording(false);
      setIsPaused(false);
    };

    recorder.start(1000); // chunk every 1s
    setIsRecording(true);
    
    // Start silent audio to trigger MediaSession
    if (silentAudioRef.current) {
      silentAudioRef.current.play().catch(console.error);
    }
    
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Recording in Progress...',
        artist: 'Tapee',
        album: 'Screen & Camera Recorder',
        artwork: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' }
        ]
      });
      navigator.mediaSession.playbackState = 'playing';

      navigator.mediaSession.setActionHandler('pause', () => pauseRecording());
      navigator.mediaSession.setActionHandler('play', () => resumeRecording());
      try { navigator.mediaSession.setActionHandler('stop', () => stopRecording()); } catch (error) {}
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    }
  };

  const updateCameraTransform = useCallback((x: number, y: number, scale: number, rotation: number) => {
    cameraTransformRef.current = { x, y, scale, rotation };
  }, []);

  return {
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
  };
};
