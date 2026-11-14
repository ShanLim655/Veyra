import { useEffect, useRef, useState } from "react";
import { Search, Loader2, Star, TrendingUp, Heart } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fetchTrendingGifs, searchGifs, type GifItem } from "@/lib/giphy";
import {
  getFavoriteGifs,
  subscribeGifFavorites,
  toggleFavoriteGif,
} from "@/lib/gifFavorites";
import { cn } from "@/lib/utils";

interface GifPickerProps {
  onSelect: (gif: GifItem) => void;
  className?: string;
}

type Tab = "trending" | "favorites";

const LONG_PRESS_MS = 450;

export function GifPicker({ onSelect, className }: GifPickerProps) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("trending");
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [favorites, setFavorites] = useState<GifItem[]>(() => getFavoriteGifs());
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(
    () => new Set(getFavoriteGifs().map((gif) => gif.id)),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const longPressRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({
    timer: null,
    fired: false,
  });

  useEffect(() => subscribeGifFavorites(() => {
    const items = getFavoriteGifs();
    setFavorites(items);
    setFavoriteIds(new Set(items.map((gif) => gif.id)));
  }), []);

  const searching = query.trim().length > 0;

  useEffect(() => {
    if (searching || tab !== "trending") return;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    fetchTrendingGifs()
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
  }, [searching, tab]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const timer = setTimeout(
      () => {
        const requestId = ++requestRef.current;
        setLoading(true);
        setError(null);
        searchGifs(trimmed)
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
      300,
    );
    return () => clearTimeout(timer);
  }, [query]);

  const visibleGifs = searching || tab === "trending" ? gifs : favorites;
  // Favorites render from localStorage — no fetch, so never show a spinner.
  const showLoading = (searching || tab === "trending") && loading && visibleGifs.length === 0;

  const clearLongPress = () => {
    if (longPressRef.current.timer) {
      clearTimeout(longPressRef.current.timer);
      longPressRef.current.timer = null;
    }
    longPressRef.current.fired = false;
  };

  const startLongPress = (gif: GifItem) => {
    clearLongPress();
    longPressRef.current.timer = setTimeout(() => {
      longPressRef.current.fired = true;
      toggleFavoriteGif(gif);
      try { navigator.vibrate?.(30); } catch { /* haptics unsupported */ }
    }, LONG_PRESS_MS);
  };

  const handleTileClick = (gif: GifItem) => {
    if (longPressRef.current.fired) {
      longPressRef.current.fired = false;
      return;
    }
    onSelect(gif);
  };

  const handleFavoriteClick = (gif: GifItem, event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    toggleFavoriteGif(gif);
  };

  return (
    <div className={cn("flex flex-col", className ?? "w-[min(420px,calc(100vw-2rem))]")}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search GIFs…"
          className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
        />
      </div>

      {!searching && (
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <TabButton
            active={tab === "trending"}
            onClick={() => setTab("trending")}
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            label="Trending"
          />
          <TabButton
            active={tab === "favorites"}
            onClick={() => setTab("favorites")}
            icon={<Heart className="h-3.5 w-3.5" />}
            label="Favorites"
            count={favorites.length}
          />
          <span className="ml-auto pr-1 text-[10px] text-muted-foreground">Hold a GIF to favorite</span>
        </div>
      )}

      <div className="h-[min(420px,58vh)] overflow-y-auto overscroll-contain p-2 sm:h-[380px]">
        {showLoading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {error}
          </div>
        ) : visibleGifs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
            {tab === "favorites" && !searching ? (
              <>
                <Star className="h-8 w-8 text-muted-foreground/50" />
                <p>No favorite GIFs yet.</p>
                <p className="text-xs">Press and hold a GIF — or tap the star — to save it here.</p>
              </>
            ) : (
              <p>No GIFs found.</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {visibleGifs.map((gif) => {
              const favorited = favoriteIds.has(gif.id);
              return (
                <div
                  key={gif.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleTileClick(gif)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleTileClick(gif);
                    }
                  }}
                  onTouchStart={() => startLongPress(gif)}
                  onTouchEnd={clearLongPress}
                  onTouchMove={clearLongPress}
                  onTouchCancel={clearLongPress}
                  onContextMenu={(event) => event.preventDefault()}
                  className={cn(
                    "group relative cursor-pointer overflow-hidden rounded-md bg-muted select-none",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    "[-webkit-touch-callout:none] [-webkit-user-select:none] [touch-action:manipulation]",
                  )}
                  title={gif.title}
                >
                  <img
                    src={gif.previewUrl}
                    alt={gif.title}
                    loading="lazy"
                    draggable={false}
                    className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-105"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
                    <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white opacity-0 transition-opacity group-hover:opacity-100">
                      GIF
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
                    aria-pressed={favorited}
                    onClick={(event) => handleFavoriteClick(gif, event)}
                    className={cn(
                      "absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full",
                      "bg-black/50 backdrop-blur-sm transition-opacity",
                      "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100",
                      "hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300",
                    )}
                  >
                    <Star
                      className={cn(
                        "h-4 w-4 transition-colors",
                        favorited ? "fill-yellow-300 text-yellow-300" : "text-yellow-200/90",
                      )}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {loading && visibleGifs.length > 0 && (
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

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {icon}
      {label}
      {typeof count === "number" && count > 0 && (
        <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{count}</span>
      )}
    </button>
  );
}
