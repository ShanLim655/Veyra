import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause } from "lucide-react";

interface VoiceMessagePlayerProps {
  url: string;
  duration?: number;
  isOwn: boolean;
}

export function VoiceMessagePlayer({ url, duration: initialDuration, isOwn }: VoiceMessagePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(url);
    audioRef.current = audio;

    audio.addEventListener("loadedmetadata", () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    });

    audio.addEventListener("timeupdate", () => {
      setCurrentTime(audio.currentTime);
    });

    audio.addEventListener("ended", () => {
      setIsPlaying(false);
      setCurrentTime(0);
    });

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, [url]);

  const togglePlayback = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-2 w-full min-w-0 sm:min-w-[180px]">
      <Button
        size="icon"
        variant="ghost"
        className={`h-8 w-8 flex-shrink-0 ${
          isOwn 
            ? "hover:bg-primary-foreground/20 text-primary-foreground" 
            : "hover:bg-primary/20 text-primary"
        }`}
        onClick={togglePlayback}
      >
        {isPlaying ? (
          <Pause className="h-4 w-4 fill-current" />
        ) : (
          <Play className="h-4 w-4 fill-current" />
        )}
      </Button>
      
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div 
          className={`h-1.5 rounded-full overflow-hidden ${
            isOwn ? "bg-primary-foreground/30" : "bg-primary/30"
          }`}
        >
          <div
            className={`h-full rounded-full transition-all ${
              isOwn ? "bg-primary-foreground" : "bg-primary"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between">
          <span className={`text-[10px] ${
            isOwn ? "text-primary-foreground/70" : "text-muted-foreground"
          }`}>
            {formatTime(currentTime)}
          </span>
          <span className={`text-[10px] ${
            isOwn ? "text-primary-foreground/70" : "text-muted-foreground"
          }`}>
            {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
