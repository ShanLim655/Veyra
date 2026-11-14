import { useState, useRef, useCallback } from "react";
import { Capacitor } from "@capacitor/core";

interface UseVoiceRecorderOptions {
  onRecordingComplete?: (blob: Blob, duration: number) => void;
  onError?: (error: Error) => void;
  onPermissionNeeded?: () => void;
}

// Get the best supported audio MIME type for the current browser
function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') {
    return '';
  }
  
  const types = [
    'audio/mp4',
    'audio/aac', 
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/wav',
    '',
  ];
  
  for (const type of types) {
    if (type === '' || MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

// Check microphone permission status
async function checkMicrophonePermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    // Try Permissions API first (not supported on iOS Safari)
    if (navigator.permissions && navigator.permissions.query) {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return result.state as 'granted' | 'denied' | 'prompt';
    }
  } catch {
    // Permissions API not supported or failed
  }
  return 'unknown';
}

export function useVoiceRecorder({ onRecordingComplete, onError, onPermissionNeeded }: UseVoiceRecorderOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<'unknown' | 'checking' | 'granted' | 'denied' | 'prompt'>('unknown');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    analyserRef.current = null;
  }, []);

  const updateAudioLevel = useCallback(() => {
    if (analyserRef.current && mediaRecorderRef.current?.state === 'recording') {
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      setAudioLevel(Math.min(1, average / 128));
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    }
  }, []);

  const requestPermissionAndRecord = useCallback(async () => {
    setError(null);
    setPermissionStatus('checking');
    
    // Check for basic support
    if (typeof MediaRecorder === 'undefined') {
      const errorMessage = "Voice recording is not supported in this browser.";
      setError(errorMessage);
      setPermissionStatus('denied');
      onError?.(new Error(errorMessage));
      return;
    }
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const errorMessage = "Microphone access requires HTTPS. Please make sure you're on a secure connection.";
      setError(errorMessage);
      setPermissionStatus('denied');
      onError?.(new Error(errorMessage));
      return;
    }

    // Check current permission status. Inside the Capacitor shell the
    // Permissions API can misreport 'denied' (the real gate is the Android
    // runtime prompt that getUserMedia triggers), so only trust it on web.
    const currentPermission = await checkMicrophonePermission();
    const isNative = Capacitor.isNativePlatform();

    if (currentPermission === 'denied' && !isNative) {
      const errorMessage = "Microphone access was denied. Please enable it in your browser settings.";
      setError(errorMessage);
      setPermissionStatus('denied');
      onError?.(new Error(errorMessage));
      return;
    }

    // Notify that we're about to request permission
    if (currentPermission === 'prompt' || currentPermission === 'unknown') {
      onPermissionNeeded?.();
    }
    
    try {
      // This will trigger the browser's permission prompt on mobile
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true, // Use simple constraint for maximum compatibility
      });
      
      setPermissionStatus('granted');
      streamRef.current = stream;

      // Set up audio analysis
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;
      
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Get supported MIME type
      const mimeType = getSupportedMimeType();
      const options: MediaRecorderOptions = {};
      if (mimeType) {
        options.mimeType = mimeType;
      }
      
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const duration = (Date.now() - startTimeRef.current) / 1000;
        
        if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { 
            type: mediaRecorder.mimeType || 'audio/mp4'
          });
          
          if (blob.size > 0) {
            onRecordingComplete?.(blob, duration);
          }
        }
        
        cleanup();
      };

      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        const errorMessage = "Recording failed. Please try again.";
        setError(errorMessage);
        onError?.(new Error(errorMessage));
        cleanup();
        setIsRecording(false);
      };

      // Start recording
      mediaRecorder.start(1000);
      startTimeRef.current = Date.now();
      setIsRecording(true);
      setRecordingDuration(0);

      // Start duration timer
      timerRef.current = setInterval(() => {
        setRecordingDuration((Date.now() - startTimeRef.current) / 1000);
      }, 100);

      // Start audio level monitoring
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);

    } catch (err) {
      console.error("Error accessing microphone:", err);
      let errorMessage = "Could not access microphone. Please check your browser settings.";
      
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errorMessage = isNative
            ? "Microphone permission was denied. Enable it in Android Settings → Apps → Veyra → Permissions → Microphone, then try again."
            : "Microphone access denied. Please allow microphone access and try again.";
          setPermissionStatus('denied');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          errorMessage = "No microphone found on this device.";
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          errorMessage = "Microphone is being used by another app.";
        } else if (err.name === 'AbortError') {
          errorMessage = "Recording was interrupted.";
        } else if (err.name === 'SecurityError') {
          errorMessage = "Microphone access blocked. Please use HTTPS.";
        }
      }
      
      setError(errorMessage);
      onError?.(new Error(errorMessage));
      cleanup();
    }
  }, [onRecordingComplete, onError, onPermissionNeeded, updateAudioLevel, cleanup]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setAudioLevel(0);
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.onerror = null;
      
      if (mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    }
    
    chunksRef.current = [];
    cleanup();
    setIsRecording(false);
    setRecordingDuration(0);
    setAudioLevel(0);
  }, [cleanup]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return {
    isRecording,
    recordingDuration,
    formattedDuration: formatDuration(recordingDuration),
    audioLevel,
    error,
    permissionStatus,
    startRecording: requestPermissionAndRecord,
    stopRecording,
    cancelRecording,
  };
}
