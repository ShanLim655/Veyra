import { useEffect, useState } from "react";
import { FileText, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FileMeta } from "@/lib/mediaUrl";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const TEXT_EXTENSIONS = [
  "txt", "md", "log", "csv", "json", "xml", "yaml", "yml", "ini", "conf",
  "ts", "tsx", "js", "jsx", "py", "rb", "go", "rs", "java", "c", "cpp", "h",
  "html", "css", "scss", "sh", "bash", "sql", "env",
];

function isTextFile(meta: FileMeta): boolean {
  if (meta.mime?.startsWith("text/")) return true;
  const ext = meta.name.split(".").pop()?.toLowerCase();
  return !!ext && TEXT_EXTENSIONS.includes(ext);
}

export function MessageTextPreview({ meta }: { meta: FileMeta }) {
  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(meta.url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        if (cancelled) return;
        const limit = 2000;
        if (text.length > limit) {
          setContent(text.slice(0, limit));
          setTruncated(true);
        } else {
          setContent(text);
          setTruncated(false);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [meta.url]);

  return (
    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden w-full max-w-full md:max-w-md">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium truncate flex-1" title={meta.name}>
          {meta.name}
        </span>
        <span className="hidden min-[390px]:inline text-xs text-muted-foreground shrink-0">
          {formatBytes(meta.size)}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          asChild
        >
          <a href={meta.url} download={meta.name} title="Download full file">
            <Download className="h-3.5 w-3.5" />
          </a>
        </Button>
      </div>
      <div className="p-3 max-h-64 overflow-auto">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading preview…
          </div>
        )}
        {error && (
          <p className="text-xs text-destructive">Could not load preview.</p>
        )}
        {content !== null && (
          <pre className="text-xs whitespace-pre-wrap break-words font-mono text-foreground">
            {content}
            {truncated && (
              <span className="text-muted-foreground">
                {"\n\n… "}Preview truncated at 2000 characters. Download to view full file.
              </span>
            )}
          </pre>
        )}
      </div>
    </div>
  );
}

export function MessageFileCard({ meta }: { meta: FileMeta }) {
  if (isTextFile(meta)) {
    return <MessageTextPreview meta={meta} />;
  }
  return (
    <a
      href={meta.url}
      download={meta.name}
      className="flex items-center gap-2 sm:gap-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors px-2 sm:px-3 py-2 w-full max-w-full md:max-w-md no-underline overflow-hidden"
    >
      <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
        <FileText className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" title={meta.name}>
          {meta.name}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {formatBytes(meta.size)}
          {meta.mime ? ` · ${meta.mime}` : ""}
        </p>
      </div>
      <Download className="h-4 w-4 text-muted-foreground shrink-0" />
    </a>
  );
}
