import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Square, Mic } from "lucide-react";
import { cn } from "@/lib/utils";

interface VoiceRecordingIndicatorProps {
  isRecording: boolean;
  duration: string;
  audioLevel: number;
  onCancel: () => void;
  onStop: () => void;
  isUploading?: boolean;
}

export function VoiceRecordingIndicator({
  isRecording,
  duration,
  audioLevel,
  onCancel,
  onStop,
  isUploading = false,
}: VoiceRecordingIndicatorProps) {
  const [bars, setBars] = useState<number[]>(() => Array(20).fill(4));

  // Animate waveform bars based on audio level
  useEffect(() => {
    if (!isRecording) return;

    const interval = setInterval(() => {
      setBars(prev => 
        prev.map(() => {
          const baseHeight = 4;
          const maxHeight = 24;
          const levelInfluence = audioLevel * maxHeight;
          const randomVariation = Math.random() * 8;
          return Math.max(baseHeight, Math.min(maxHeight, levelInfluence + randomVariation));
        })
      );
    }, 75);

    return () => clearInterval(interval);
  }, [isRecording, audioLevel]);

  if (!isRecording && !isUploading) return null;

  return (
    <div className="flex items-center gap-3 w-full p-2 bg-destructive/10 rounded-lg border border-destructive/20 animate-in fade-in slide-in-from-bottom-2 duration-200">
      {/* Pulsing mic indicator */}
      <div className="relative flex items-center justify-center">
        <div 
          className={cn(
            "absolute inset-0 bg-destructive/30 rounded-full animate-ping",
            isUploading && "animate-none"
          )}
          style={{ 
            animationDuration: '1.5s',
            transform: `scale(${1 + audioLevel * 0.5})`,
          }}
        />
        <div className="relative h-8 w-8 flex items-center justify-center bg-destructive rounded-full">
          <Mic className="h-4 w-4 text-destructive-foreground" />
        </div>
      </div>

      {/* Duration display */}
      <div className="flex flex-col gap-1 flex-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-destructive tabular-nums">
            {isUploading ? "Sending..." : duration}
          </span>
          <span className="text-xs text-muted-foreground">
            {isUploading ? "Please wait" : "Recording"}
          </span>
        </div>
        
        {/* Waveform visualization */}
        <div className="flex items-center gap-0.5 h-6">
          {bars.map((height, i) => (
            <div
              key={i}
              className={cn(
                "w-1 rounded-full transition-all duration-75",
                isUploading ? "bg-muted-foreground/40" : "bg-destructive/60"
              )}
              style={{
                height: isUploading ? 4 : height,
              }}
            />
          ))}
        </div>
      </div>

      {/* Cancel button */}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={onCancel}
        disabled={isUploading}
        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-9 w-9"
      >
        <X className="h-5 w-5" />
      </Button>

      {/* Stop/Send button */}
      <Button
        type="button"
        size="icon"
        onClick={onStop}
        disabled={isUploading}
        className="bg-destructive hover:bg-destructive/90 h-9 w-9"
      >
        {isUploading ? (
          <div className="h-4 w-4 border-2 border-destructive-foreground border-t-transparent rounded-full animate-spin" />
        ) : (
          <Square className="h-4 w-4 fill-current" />
        )}
      </Button>
    </div>
  );
}
