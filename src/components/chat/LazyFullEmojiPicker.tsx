import { lazy, Suspense } from "react";

const FullEmojiPicker = lazy(() =>
  import("@/components/chat/FullEmojiPicker").then(({ FullEmojiPicker: Picker }) => ({ default: Picker })),
);

export function LazyFullEmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  return (
    <Suspense fallback={<div className="p-3 text-sm text-muted-foreground">Loading emoji…</div>}>
      <FullEmojiPicker onSelect={onSelect} />
    </Suspense>
  );
}
