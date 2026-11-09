import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type TextareaProps = React.ComponentProps<typeof Textarea>;

interface AutoResizeTextareaProps extends TextareaProps {
  /** Max number of visible lines before the textarea starts scrolling. */
  maxRows?: number;
  /** Min number of visible lines. */
  minRows?: number;
}

/**
 * A Textarea that auto-grows with its content up to `maxRows` line breaks,
 * after which it becomes scrollable.
 */
export const AutoResizeTextarea = forwardRef<HTMLTextAreaElement, AutoResizeTextareaProps>(
  ({ maxRows = 23, minRows = 1, className, value, onChange, style, ...rest }, ref) => {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);
    useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement, []);

    const resize = () => {
      const el = innerRef.current;
      if (!el) return;
      // Reset height so scrollHeight reflects current content
      el.style.height = "auto";
      const computed = window.getComputedStyle(el);
      const lineHeightRaw = computed.lineHeight;
      let lineHeight = parseFloat(lineHeightRaw);
      if (!lineHeight || Number.isNaN(lineHeight)) {
        // Fallback when line-height is "normal"
        const fontSize = parseFloat(computed.fontSize) || 16;
        lineHeight = fontSize * 1.5;
      }
      const paddingTop = parseFloat(computed.paddingTop) || 0;
      const paddingBottom = parseFloat(computed.paddingBottom) || 0;
      const borderTop = parseFloat(computed.borderTopWidth) || 0;
      const borderBottom = parseFloat(computed.borderBottomWidth) || 0;
      const maxHeight =
        lineHeight * maxRows + paddingTop + paddingBottom + borderTop + borderBottom;
      const next = Math.min(el.scrollHeight + borderTop + borderBottom, maxHeight);
      el.style.height = `${next}px`;
      el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
    };

    useLayoutEffect(() => {
      resize();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    useEffect(() => {
      const onResize = () => resize();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, []);

    return (
      <Textarea
        ref={innerRef}
        value={value}
        onChange={onChange}
        rows={minRows}
        className={cn("resize-none overflow-hidden", className)}
        style={style}
        {...rest}
      />
    );
  }
);

AutoResizeTextarea.displayName = "AutoResizeTextarea";
