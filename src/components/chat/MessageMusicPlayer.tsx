import { useEffect, useRef, useState } from "react";
import { Music, Download, Play, Pause, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { MusicMeta } from "@/lib/mediaUrl";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const BAR_COUNT = 28;

export function MessageMusicPlayer({ meta }: { meta: MusicMeta }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [seeking, setSeeking] = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => !seeking && setCurrent(a.currentTime);
    const onMeta = () => setDuration(a.duration || 0);
    const onEnd = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onMeta);
    a.addEventListener("ended", onEnd);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
  }, [seeking]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = muted;
    }
  }, [volume, muted]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  const progress = duration > 0 ? (current / duration) * 100 : 0;

  // deterministic pseudo-random bar heights based on file name
  const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
    const seed = (meta.name.charCodeAt(i % meta.name.length) + i * 17) % 100;
    return 30 + (seed % 70);
  });

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/10 p-3 sm:p-3.5 w-full max-w-full md:max-w-sm overflow-hidden shadow-sm">
      <audio ref={audioRef} src={meta.url} preload="metadata" className="hidden" />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className="h-11 w-11 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-sm hover:opacity-90 active:scale-95 transition"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="h-5 w-5 ml-0.5" fill="currentColor" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Music className="h-3 w-3 text-muted-foreground shrink-0" />
            <p className="text-sm font-medium truncate" title={meta.name}>
              {meta.name}
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground">{formatBytes(meta.size)}</p>
        </div>

        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" asChild>
          <a href={meta.url} download={meta.name} title="Download">
            <Download className="h-3.5 w-3.5" />
          </a>
        </Button>
      </div>

      {/* Waveform / seek */}
      <div
        className="relative mt-3 h-10 flex items-center gap-[2px] cursor-pointer select-none"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          const a = audioRef.current;
          if (a && duration > 0) {
            a.currentTime = Math.max(0, Math.min(duration, pct * duration));
            setCurrent(a.currentTime);
          }
        }}
      >
        {bars.map((h, i) => {
          const barPct = ((i + 0.5) / BAR_COUNT) * 100;
          const active = barPct <= progress;
          return (
            <div
              key={i}
              className={cn(
                "flex-1 rounded-full transition-colors",
                active ? "bg-primary" : "bg-muted-foreground/30"
              )}
              style={{ height: `${h}%` }}
            />
          );
        })}
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] tabular-nums text-muted-foreground">
        <span>{formatTime(current)}</span>
        <div className="flex items-center gap-1.5 flex-1 max-w-[100px] ml-auto">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className="text-muted-foreground hover:text-foreground transition"
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted || volume === 0 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          <Slider
            value={[muted ? 0 : volume * 100]}
            max={100}
            step={1}
            onValueChange={(v) => {
              const val = (v[0] ?? 0) / 100;
              setVolume(val);
              if (val > 0) setMuted(false);
            }}
            className="flex-1"
          />
        </div>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
