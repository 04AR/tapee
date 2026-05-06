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

  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  // Position for the camera overlay (normalized 0-1 relative to screen width/height)
  const cameraPosRef = useRef({ x: 0.05, y: 0.05 }); 

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
    
    // Create hidden elements for compositing
    if (!compositeCanvasRef.current) {
      compositeCanvasRef.current = document.createElement('canvas');
      compositeCanvasRef.current.width = 1920;
      compositeCanvasRef.current.height = 1080;
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
    if (cameraVideoRef.current && cameraVideoRef.current.srcObject) {
      const stream = cameraVideoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      cameraVideoRef.current.srcObject = null;
    }
  };

  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);

  // Keep camera feed active regardless of recording state
  useEffect(() => {
    const startCamera = async () => {
      if (!isCameraEnabled && !isAudioEnabled) {
         stopCameraTracks();
         cameraStreamRef.current = null;
         return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: isCameraEnabled ? { deviceId: selectedVideoId !== 'default' ? { exact: selectedVideoId } : undefined } : false,
          audio: isAudioEnabled ? { deviceId: selectedAudioId !== 'default' ? { exact: selectedAudioId } : undefined } : false
        });
        stopCameraTracks();
        cameraStreamRef.current = stream;
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          await cameraVideoRef.current.play();
        }
      } catch (err) {
        console.error("Camera preview failed", err);
      }
    };
    startCamera();
  }, [selectedVideoId, selectedAudioId, isCameraEnabled, isAudioEnabled]);

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
      const cameraStream = (isCameraEnabled || isAudioEnabled) ? cameraVideoRef.current?.srcObject as MediaStream : null;

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
        const camAspect = cameraVideoRef.current!.videoWidth / Math.max(1, cameraVideoRef.current!.videoHeight);
        const pipWidth = cW * 0.2; // 20% of screen width
        const pipHeight = pipWidth / camAspect;
        
        const posX = cameraPosRef.current.x * cW;
        const posY = cameraPosRef.current.y * cH;

        ctx.save();
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 8;
        ctx.shadowOffsetY = 8;
        
        ctx.beginPath();
        ctx.rect(posX, posY, pipWidth, pipHeight);
        ctx.fillStyle = '#22d3ee'; // Cyan background behind video
        ctx.fill();
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        ctx.clip();

        // Mirror camera horizontally
        ctx.translate(posX + pipWidth, posY);
        ctx.scale(-1, 1);
        ctx.drawImage(cameraVideoRef.current!, 0, 0, pipWidth, pipHeight);
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
  }, [isCameraEnabled]);

  const startRecording = async () => {
    const streams = await getStreams();
    if (!streams) return;

    const { screenStream, cameraStream } = streams;

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
    if (isAudioEnabled && cameraStream && cameraStream.getAudioTracks().length > 0) {
      const micSource = audioContextRef.current.createMediaStreamSource(new MediaStream([cameraStream.getAudioTracks()[0]]));
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

  const updateCameraPosition = useCallback((x: number, y: number) => {
    cameraPosRef.current = { x, y };
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
    updateCameraPosition,
    recordings,
    error,
    setError
  };
};
