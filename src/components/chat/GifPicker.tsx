import { useEffect, useRef, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fetchTrendingGifs, searchGifs, type GifItem } from "@/lib/giphy";
import { cn } from "@/lib/utils";

interface GifPickerProps {
  onSelect: (gif: GifItem) => void;
}

export function GifPicker({ onSelect }: GifPickerProps) {
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(
      () => {
        const requestId = ++requestRef.current;
        setLoading(true);
        setError(null);
        const request = trimmed ? searchGifs(trimmed) : fetchTrendingGifs();
        request
          .then((results) => {
            if (requestRef.current !== requestId) return;
            setGifs(results);
          })
          .catch((err) => {
            if (requestRef.current !== requestId) return;
            setGifs([]);
            setError(err instanceof Error ? err.message : "Could not load GIFs.");
          })
          .finally(() => {
            if (requestRef.current === requestId) setLoading(false);
          });
      },
      trimmed ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="flex w-[min(420px,calc(100vw-2rem))] flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search GIFs…"
          className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
          autoFocus
        />
      </div>

      <div className="h-[380px] overflow-y-auto p-2">
        {loading && gifs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {error}
          </div>
        ) : gifs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No GIFs found.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {gifs.map((gif) => (
              <button
                key={gif.id}
                type="button"
                onClick={() => onSelect(gif)}
                className={cn(
                  "group relative overflow-hidden rounded-md bg-muted",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                )}
                title={gif.title}
              >
                <img
                  src={gif.previewUrl}
                  alt={gif.title}
                  loading="lazy"
                  className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-105"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
                  <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white opacity-0 transition-opacity group-hover:opacity-100">
                    GIF
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
        {loading && gifs.length > 0 && (
          <div className="flex justify-center py-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
      </div>

      <div className="border-t border-border px-3 py-1.5 text-right text-[10px] text-muted-foreground">
        Powered by GIPHY
      </div>
    </div>
  );
}
