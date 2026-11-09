import { useEffect, useRef, useState } from "react";
import { signChatUrl } from "@/lib/mediaUrl";

interface ChatImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
}

const MAX_RETRIES = 4;

/**
 * Image that self-heals when its (signed) storage URL has expired, failed to
 * load, or isn't yet propagated — e.g. when rendered from cached messages with
 * stale signed URLs, or right after a realtime insert where the freshly
 * uploaded object isn't queryable yet. On error it re-signs the URL and retries
 * with backoff so the user never has to refresh the page. Caching is preserved.
 */
export function ChatImage({ src, ...rest }: ChatImageProps) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const retriesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCurrentSrc(src);
    retriesRef.current = 0;
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [src]);

  const handleError = () => {
    if (retriesRef.current >= MAX_RETRIES) return;
    const attempt = retriesRef.current + 1;
    retriesRef.current = attempt;
    // Backoff gives Supabase storage time to make a just-uploaded object
    // available before we re-sign and retry.
    const delay = Math.min(300 * attempt, 1500);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const fresh = await signChatUrl(src);
        // Cache-bust so the browser refetches instead of reusing a failed entry.
        const busted = fresh + (fresh.includes("?") ? "&" : "?") + "r=" + Date.now();
        setCurrentSrc(busted);
      } catch {
        /* leave as-is; further errors may retry until MAX_RETRIES */
      }
    }, delay);
  };

  return <img src={currentSrc} onError={handleError} {...rest} />;
}
