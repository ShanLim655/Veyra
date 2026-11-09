import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
import { useEffect, useState } from "react";

interface FullEmojiPickerProps {
  onSelect: (emoji: string) => void;
}

export function FullEmojiPicker({ onSelect }: FullEmojiPickerProps) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.innerWidth < 640
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const width = isMobile ? Math.min(window.innerWidth - 32, 320) : 320;
  const height = isMobile ? Math.min(window.innerHeight - 200, 360) : 400;

  return (
    <div
      style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}
      onPointerDownCapture={(e) => {
        // Prevent Radix Popover from treating touch-scroll as an outside interaction
        // that closes the picker or blocks scrolling on mobile.
        e.stopPropagation();
      }}
      onTouchStartCapture={(e) => e.stopPropagation()}
      onTouchMoveCapture={(e) => e.stopPropagation()}
    >
      <EmojiPicker
        onEmojiClick={(e) => onSelect(e.emoji)}
        theme={Theme.DARK}
        emojiStyle={EmojiStyle.NATIVE}
        lazyLoadEmojis
        width={width}
        height={height}
        previewConfig={{ showPreview: false }}
        searchPlaceholder="Search emoji..."
      />
    </div>
  );
}
