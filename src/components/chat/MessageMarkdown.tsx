import React from "react";

/**
 * Discord-style markdown renderer.
 *
 * Supports:
 *  - *italic*, _italic_
 *  - **bold**, ***bold italic***
 *  - __underline__, __*underline italic*__, __**underline bold**__, __***underline bold italic***__
 *  - ~~strikethrough~~
 *  - `inline code` and ```multi-line code``` (with optional language)
 *  - ||spoiler||
 *  - > blockquote / >>> multiline blockquote
 *  - # / ## / ### headers, -# subtext
 *  - - / * unordered lists, 1. ordered lists
 *  - [label](url) masked links, plus bare http(s) URLs
 *  - \\x escapes
 */

interface MessageMarkdownProps {
  content: string;
  isOwn?: boolean;
  className?: string;
  /** Lowercased username of the viewer — used to color @mentions red when they target you. */
  myUsername?: string | null;
}


type InlineNode = string | React.ReactElement;

const URL_RE = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/;

function isSafeUrl(href: string): boolean {
  try {
    const url = new URL(href, "https://placeholder.invalid");
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function makeKey(prefix: string, i: number) {
  return `${prefix}-${i}`;
}

function renderLink(href: string, label: React.ReactNode, _isOwn: boolean, key: string) {
  return (
    <a
      key={key}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:opacity-80 transition-opacity text-link"
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </a>
  );
}

function Spoiler({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = React.useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        setRevealed(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setRevealed(true);
        }
      }}
      className={`rounded px-1 transition-colors ${
        revealed
          ? "bg-muted/40"
          : "bg-muted text-transparent select-none cursor-pointer hover:bg-muted/80"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * Parse inline markdown into React nodes.
 */
function parseInline(text: string, isOwn: boolean, keyPrefix = "i", myUsername?: string | null): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let i = 0;
  let nodeIdx = 0;

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    // auto-link bare URLs inside buffer
    const segments = buffer.split(new RegExp(URL_RE.source, "g"));
    segments.forEach((seg) => {
      if (!seg) return;
      if (URL_RE.test(seg)) {
        nodes.push(renderLink(seg, seg, isOwn, makeKey(keyPrefix + "-url", nodeIdx++)));
      } else {
        nodes.push(seg);
      }
    });
    buffer = "";
  };

  const pushNode = (node: React.ReactElement) => {
    flushBuffer();
    nodes.push(node);
  };

  // ordered list of inline tokens: [regexFromIndex, render]
  // Each matcher returns { length, node } if matched at position i, else null.
  type Match = { length: number; node: React.ReactElement };
  const tryMatch = (): Match | null => {
    // escape
    if (text[i] === "\\" && i + 1 < text.length) {
      const ch = text[i + 1];
      return { length: 2, node: <React.Fragment key={makeKey(keyPrefix + "-esc", nodeIdx++)}>{ch}</React.Fragment> };
    }
    // @mention / @everyone — word-boundary aware
    if (
      text[i] === "@" &&
      (i === 0 || !/[A-Za-z0-9_]/.test(text[i - 1]))
    ) {
      const rest = text.slice(i + 1);
      const m = rest.match(/^(everyone|[A-Za-z0-9_]{2,32})(?![A-Za-z0-9_])/);
      if (m) {
        const name = m[1];
        const lower = name.toLowerCase();
        const isEveryone = lower === "everyone";
        const isMe =
          isEveryone || (!!myUsername && lower === myUsername.toLowerCase());
        const cls = isMe
          ? "bg-destructive/20 text-destructive font-medium rounded px-1"
          : "bg-primary/20 text-primary font-medium rounded px-1";
        return {
          length: 1 + name.length,
          node: (
            <span
              key={makeKey(keyPrefix + "-mention", nodeIdx++)}
              className={cls}
              data-mention={lower}
            >
              @{name}
            </span>
          ),
        };
      }
    }

    // inline code `...`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        const code = text.slice(i + 1, end);
        return {
          length: end - i + 1,
          node: (
            <code
              key={makeKey(keyPrefix + "-code", nodeIdx++)}
              className="px-1 py-0.5 rounded bg-muted text-foreground font-mono text-[0.85em]"
            >
              {code}
            </code>
          ),
        };
      }
    }
    // spoiler ||...||
    if (text.startsWith("||", i)) {
      const end = text.indexOf("||", i + 2);
      if (end > i + 2) {
        const inner = text.slice(i + 2, end);
        return {
          length: end - i + 2,
          node: (
            <Spoiler key={makeKey(keyPrefix + "-spoil", nodeIdx++)}>
              {parseInline(inner, isOwn, keyPrefix + "-spoilbody-" + nodeIdx, myUsername)}
            </Spoiler>
          ),
        };
      }
    }
    // masked link [label](url)
    if (text[i] === "[") {
      const m = text.slice(i).match(/^\[([^\]\n]+)\]\(([^)\s]+)\)/);
      if (m) {
        const [full, label, url] = m;
        if (!isSafeUrl(url)) {
          return {
            length: full.length,
            node: (
              <React.Fragment key={makeKey(keyPrefix + "-unsafe", nodeIdx++)}>
                {parseInline(label, isOwn, keyPrefix + "-unsafelbl-" + nodeIdx, myUsername)}
              </React.Fragment>
            ),
          };
        }
        return {
          length: full.length,
          node: renderLink(
            url,
            parseInline(label, isOwn, keyPrefix + "-linklbl-" + nodeIdx, myUsername),
            isOwn,
            makeKey(keyPrefix + "-link", nodeIdx++)
          ),
        };
      }
    }
    // wrappers — try longest first
    const wrappers: Array<{ open: string; close: string; wrap: (kids: InlineNode[]) => React.ReactElement }> = [
      {
        open: "__***",
        close: "***__",
        wrap: (kids) => (
          <u key={makeKey(keyPrefix + "-ubi", nodeIdx++)}>
            <strong>
              <em>{kids}</em>
            </strong>
          </u>
        ),
      },
      {
        open: "__**",
        close: "**__",
        wrap: (kids) => (
          <u key={makeKey(keyPrefix + "-ub", nodeIdx++)}>
            <strong>{kids}</strong>
          </u>
        ),
      },
      {
        open: "__*",
        close: "*__",
        wrap: (kids) => (
          <u key={makeKey(keyPrefix + "-ui", nodeIdx++)}>
            <em>{kids}</em>
          </u>
        ),
      },
      {
        open: "__",
        close: "__",
        wrap: (kids) => <u key={makeKey(keyPrefix + "-u", nodeIdx++)}>{kids}</u>,
      },
      {
        open: "***",
        close: "***",
        wrap: (kids) => (
          <strong key={makeKey(keyPrefix + "-bi", nodeIdx++)}>
            <em>{kids}</em>
          </strong>
        ),
      },
      {
        open: "**",
        close: "**",
        wrap: (kids) => <strong key={makeKey(keyPrefix + "-b", nodeIdx++)}>{kids}</strong>,
      },
      {
        open: "*",
        close: "*",
        wrap: (kids) => <em key={makeKey(keyPrefix + "-i", nodeIdx++)}>{kids}</em>,
      },
      {
        open: "~~",
        close: "~~",
        wrap: (kids) => <s key={makeKey(keyPrefix + "-s", nodeIdx++)}>{kids}</s>,
      },
    ];
    for (const w of wrappers) {
      if (text.startsWith(w.open, i)) {
        const searchFrom = i + w.open.length;
        const end = text.indexOf(w.close, searchFrom);
        if (end > searchFrom) {
          const inner = text.slice(searchFrom, end);
          if (inner.length === 0) continue;
          return {
            length: end + w.close.length - i,
            node: w.wrap(parseInline(inner, isOwn, keyPrefix + "-wbody-" + nodeIdx, myUsername)),
          };
        }
      }
    }
    // _italic_ (no underscore-in-word handling — keep simple)
    if (text[i] === "_") {
      const end = text.indexOf("_", i + 1);
      if (end > i + 1) {
        const inner = text.slice(i + 1, end);
        if (!inner.includes("\n")) {
          return {
            length: end - i + 1,
            node: (
              <em key={makeKey(keyPrefix + "-iu", nodeIdx++)}>
                {parseInline(inner, isOwn, keyPrefix + "-iubody-" + nodeIdx, myUsername)}
              </em>
            ),
          };
        }
      }
    }
    return null;
  };

  while (i < text.length) {
    const m = tryMatch();
    if (m) {
      pushNode(m.node);
      i += m.length;
    } else {
      buffer += text[i];
      i += 1;
    }
  }
  flushBuffer();
  return nodes;
}

type Block =
  | { type: "p"; lines: string[] }
  | { type: "h"; level: 1 | 2 | 3; text: string }
  | { type: "subtext"; text: string }
  | { type: "quote"; lines: string[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; lang: string | null; text: string };

function parseBlocks(content: string): Block[] {
  const lines = content.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const lastBlock = () => blocks[blocks.length - 1];

  while (i < lines.length) {
    const line = lines[i];

    // multi-line code block
    const fence = line.match(/^```([\w+-]*)\s*$/);
    if (fence) {
      const lang = fence[1] || null;
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // consume closing fence
      blocks.push({ type: "code", lang, text: codeLines.join("\n") });
      continue;
    }

    // >>> multi-line blockquote — everything until end becomes quote
    if (/^>>> /.test(line) || line === ">>>") {
      const first = line.replace(/^>>> ?/, "");
      const quoteLines: string[] = [];
      if (first.length > 0 || line !== ">>>") quoteLines.push(first);
      i += 1;
      while (i < lines.length) {
        quoteLines.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: "quote", lines: quoteLines });
      continue;
    }

    // single-line blockquote
    if (/^> /.test(line) || line === ">") {
      const text = line.replace(/^> ?/, "");
      const prev = lastBlock();
      if (prev && prev.type === "quote") {
        prev.lines.push(text);
      } else {
        blocks.push({ type: "quote", lines: [text] });
      }
      i += 1;
      continue;
    }

    // headers
    const h = line.match(/^(#{1,3}) (.*)$/);
    if (h) {
      blocks.push({ type: "h", level: h[1].length as 1 | 2 | 3, text: h[2] });
      i += 1;
      continue;
    }

    // subtext
    if (/^-# /.test(line)) {
      blocks.push({ type: "subtext", text: line.slice(3) });
      i += 1;
      continue;
    }

    // unordered list
    const ul = line.match(/^\s*[-*] (.*)$/);
    if (ul) {
      const prev = lastBlock();
      if (prev && prev.type === "ul") {
        prev.items.push(ul[1]);
      } else {
        blocks.push({ type: "ul", items: [ul[1]] });
      }
      i += 1;
      continue;
    }

    // ordered list
    const ol = line.match(/^\s*\d+\. (.*)$/);
    if (ol) {
      const prev = lastBlock();
      if (prev && prev.type === "ol") {
        prev.items.push(ol[1]);
      } else {
        blocks.push({ type: "ol", items: [ol[1]] });
      }
      i += 1;
      continue;
    }

    // blank line — break paragraph
    if (line.trim() === "") {
      const prev = lastBlock();
      if (prev && prev.type === "p") {
        prev.lines.push("");
      } else {
        blocks.push({ type: "p", lines: [""] });
      }
      i += 1;
      continue;
    }

    // paragraph line — append to previous paragraph
    const prev = lastBlock();
    if (prev && prev.type === "p") {
      prev.lines.push(line);
    } else {
      blocks.push({ type: "p", lines: [line] });
    }
    i += 1;
  }

  return blocks;
}

function renderInlineWithBreaks(text: string, isOwn: boolean, keyPrefix: string, myUsername?: string | null): React.ReactNode[] {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  lines.forEach((ln, idx) => {
    if (idx > 0) out.push(<br key={`${keyPrefix}-br-${idx}`} />);
    const parsed = parseInline(ln, isOwn, `${keyPrefix}-ln${idx}`, myUsername);
    parsed.forEach((n, j) => {
      if (typeof n === "string") out.push(<React.Fragment key={`${keyPrefix}-t${idx}-${j}`}>{n}</React.Fragment>);
      else out.push(n);
    });
  });
  return out;
}

export function MessageMarkdown({ content, isOwn = false, className, myUsername }: MessageMarkdownProps) {
  const blocks = React.useMemo(() => parseBlocks(content), [content]);


  return (
    <div className={`message-markdown space-y-1 min-w-0 break-words [overflow-wrap:anywhere] ${className ?? ""}`}>
      {blocks.map((block, idx) => {
        const key = `b-${idx}`;
        switch (block.type) {
          case "h": {
            const sizes = {
              1: "text-xl font-bold mt-1",
              2: "text-lg font-bold mt-1",
              3: "text-base font-semibold mt-1",
            } as const;
            const Tag = (`h${block.level}` as unknown) as keyof JSX.IntrinsicElements;
            return (
              <Tag key={key} className={sizes[block.level]}>
                {parseInline(block.text, isOwn, key, myUsername)}
              </Tag>
            );
          }
          case "subtext":
            return (
              <p key={key} className="text-xs opacity-70">
                {parseInline(block.text, isOwn, key, myUsername)}
              </p>
            );
          case "quote":
            return (
              <blockquote
                key={key}
                className="border-l-2 border-current/40 pl-2 opacity-90 break-words [overflow-wrap:anywhere]"
              >
                {renderInlineWithBreaks(block.lines.join("\n"), isOwn, key, myUsername)}
              </blockquote>
            );
          case "ul":
            return (
              <ul key={key} className="list-disc list-inside space-y-0.5">
                {block.items.map((item, j) => (
                  <li key={`${key}-li-${j}`}>{parseInline(item, isOwn, `${key}-li-${j}`, myUsername)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="list-decimal list-inside space-y-0.5">
                {block.items.map((item, j) => (
                  <li key={`${key}-li-${j}`}>{parseInline(item, isOwn, `${key}-li-${j}`, myUsername)}</li>
                ))}
              </ol>
            );
          case "code":
            return (
              <pre
                key={key}
                className="rounded bg-muted text-foreground p-2 overflow-x-auto text-[0.85em] font-mono"
              >
                {block.lang ? (
                  <code data-lang={block.lang}>{block.text}</code>
                ) : (
                  <code>{block.text}</code>
                )}
              </pre>
            );
          case "p":
          default: {
            const text = block.lines.join("\n");
            if (text.trim() === "") return null;
            return (
              <p key={key} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {renderInlineWithBreaks(text, isOwn, key, myUsername)}
              </p>
            );
          }
        }
      })}
    </div>
  );
}

export default MessageMarkdown;