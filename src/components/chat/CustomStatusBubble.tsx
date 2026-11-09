import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CustomStatusEditor } from "@/components/chat/CustomStatusEditor";
import { CustomStatusData, isStatusActive } from "@/lib/customStatus";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface Props {
  status: CustomStatusData | null;
  isOwner?: boolean;
  onChange?: (next: CustomStatusData) => void;
}

/**
 * Discord-style custom-status bubble shown next to a profile avatar.
 * MUST be rendered inside a `relative` parent (typically the avatar wrapper).
 * Renders a big floating dot near the top-right of the avatar and a chat
 * bubble below it (with its own small connector dot), positioned absolutely.
 */
export function CustomStatusBubble({
  status,
  isOwner = false,
  onChange,
}: Props) {
  const isMobile = useIsMobile();
  const [hovering, setHovering] = useState(false);
  const [tappedOpen, setTappedOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const active = isStatusActive(status);
  if (!active && !isOwner) return null;

  const expanded = !isOwner && (isMobile ? tappedOpen : hovering);

  const handleClick = () => {
    if (isOwner) setEditorOpen(true);
    else if (isMobile) setTappedOpen((v) => !v);
  };

  const bubbleInner = (
    <div className="flex items-start gap-1.5">
      {!active && isOwner && (
        <Plus className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
      )}
      {active && status?.custom_status_emoji && (
        <span className="text-base leading-tight flex-shrink-0">
          {status.custom_status_emoji}
        </span>
      )}
      <span
        className={cn(
          "text-sm leading-snug break-words min-w-0",
          !active && "italic text-muted-foreground",
          !expanded && "line-clamp-2",
        )}
      >
        {active ? status?.custom_status_text : "What have you been listening to?"}
      </span>
    </div>
  );

  const bubble = (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={() => !isMobile && setHovering(true)}
      onMouseLeave={() => !isMobile && setHovering(false)}
      aria-label={isOwner ? (active ? "Edit your status" : "Set a status") : "Show status"}
      className={cn(
        "relative w-fit max-w-[16rem] text-left rounded-2xl bg-popover text-popover-foreground group",
        "border border-border shadow-md px-3.5 py-2",
        "transition-all duration-200 ease-out",
        isOwner && "cursor-pointer hover:bg-accent",
      )}
    >
      {/* Connector dot is merged into the bubble: no lower outline, plus a wide cover hides the bubble's top border where they meet. */}
      <span
        aria-hidden
        className={cn(
          "absolute -top-2 left-3 z-10 w-3.5 h-3.5 rounded-full bg-popover border border-border border-b-0 shadow-sm transition-colors duration-200",
          isOwner && "group-hover:bg-accent"
        )}
      />
      <span
        aria-hidden
        className={cn(
          "absolute -top-px left-[9px] z-20 h-2.5 w-6 bg-popover transition-colors duration-200",
          isOwner && "group-hover:bg-accent"
        )}
      />
      <span className="relative z-30 block">{bubbleInner}</span>
    </button>
  );

  // Layer that sits to the right of the avatar (parent must be `relative`).
  const layer = (
    <>
      {/* Big tail dot near top-right of the avatar */}
      <span
        aria-hidden
        className="absolute w-2.5 h-2.5 rounded-full bg-popover border border-border shadow-sm pointer-events-none"
        style={{ top: "16%", left: "calc(100% + 2px)" }}
      />
      {/* Bubble — lower than the big dot, overlapping the banner above the avatar slightly */}
      <div
        className="absolute pointer-events-auto"
        style={{ top: "32%", left: "calc(100% + 8px)" }}
      >
        {isOwner ? (
          <Popover open={editorOpen} onOpenChange={setEditorOpen}>
            <PopoverTrigger asChild>{bubble}</PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start" side="bottom">
              <CustomStatusEditor
                initial={status}
                onClose={() => setEditorOpen(false)}
                onSaved={(next) => onChange?.(next)}
              />
            </PopoverContent>
          </Popover>
        ) : (
          bubble
        )}
      </div>
    </>
  );

  return layer;
}
