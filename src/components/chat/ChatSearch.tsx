import { useMemo, useState, useRef, useEffect } from "react";
import { Search, X, Paperclip, User, Check, Filter, CalendarIcon, ArrowUpDown } from "lucide-react";
import { format, parseISO, isValid, startOfDay, endOfDay } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageMarkdown } from "@/components/chat/MessageMarkdown";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";

interface MessageLike {
  id: string;
  content: string;
  sender_id: string | null;
  created_at: string;
  image_url?: string | null;
  sender?: {
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  };
}

interface ChatSearchProps {
  messages: MessageLike[];
  onJump: (messageId: string) => void;
  currentUserId?: string;
  hasMore?: boolean;
  onLoadMore?: () => Promise<void>;
}

const HAS_VALUES = ["file", "image", "video", "music", "link", "attachment"] as const;
type HasValue = (typeof HAS_VALUES)[number];

const URL_REGEX = /\bhttps?:\/\/[^\s<>"')]+/i;
const ATTACHMENT_REGEX = /\[(file|music|video|image):[^\]]+\]/gi;

function detectAttachmentKinds(content: string, image_url?: string | null): Set<HasValue> {
  const set = new Set<HasValue>();
  if (image_url) {
    set.add("image");
    set.add("attachment");
  }
  if (content) {
    let m;
    const re = /\[(file|music|video|image):/gi;
    while ((m = re.exec(content))) {
      const kind = m[1].toLowerCase() as "file" | "music" | "video" | "image";
      set.add(kind);
      set.add("attachment");
      if (kind === "file") set.add("file");
    }
    if (URL_REGEX.test(content)) set.add("link");
  }
  return set;
}

interface ParsedQuery {
  from: string[];
  has: HasValue[];
  keywords: string[];
  before?: Date;
  after?: Date;
  during?: Date;
  sort: "newest" | "oldest";
}

function parseDateToken(val: string): Date | undefined {
  const d = parseISO(val);
  return isValid(d) ? d : undefined;
}

function parseQuery(raw: string): ParsedQuery {
  const from: string[] = [];
  const has: HasValue[] = [];
  const keywords: string[] = [];
  let before: Date | undefined;
  let after: Date | undefined;
  let during: Date | undefined;
  let sort: "newest" | "oldest" = "newest";
  const tokens = raw.match(/"[^"]+"|\S+/g) || [];
  for (const t of tokens) {
    const m = t.match(/^(from|has|before|after|during|on|sort):(.+)$/i);
    if (m) {
      const key = m[1].toLowerCase();
      const val = m[2].replace(/^"|"$/g, "").toLowerCase();
      if (!val) continue;
      if (key === "from") from.push(val);
      else if (key === "has" && (HAS_VALUES as readonly string[]).includes(val))
        has.push(val as HasValue);
      else if (key === "before") before = parseDateToken(val);
      else if (key === "after") after = parseDateToken(val);
      else if (key === "during" || key === "on") during = parseDateToken(val);
      else if (key === "sort" && (val === "newest" || val === "oldest")) sort = val;
    } else {
      keywords.push(t.replace(/^"|"$/g, "").toLowerCase());
    }
  }
  return { from, has, keywords, before, after, during, sort };
}

function userMatchesFrom(
  fromTokens: string[],
  sender: MessageLike["sender"],
  senderId: string | null,
  currentUserId?: string,
): boolean {
  if (fromTokens.length === 0) return true;
  const candidates = [
    sender?.username?.toLowerCase(),
    sender?.display_name?.toLowerCase(),
  ].filter(Boolean) as string[];
  return fromTokens.some((tok) => {
    if (tok === "me" || tok === "you") return senderId === currentUserId;
    return candidates.some((c) => c.includes(tok));
  });
}

export function ChatSearch({ messages, onJump, currentUserId, hasMore = false, onLoadMore }: ChatSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseQuery(query), [query]);

  const users = useMemo(() => {
    const map = new Map<string, { id: string; name: string; username: string; avatar_url: string | null }>();
    messages.forEach((m) => {
      if (!m.sender_id || map.has(m.sender_id)) return;
      const name = m.sender?.display_name || m.sender?.username || "Unknown";
      const username = m.sender?.username || name;
      map.set(m.sender_id, { id: m.sender_id, name, username, avatar_url: m.sender?.avatar_url ?? null });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [messages]);

  const results = useMemo(() => {
    const filtered = messages.filter((m) => {
      if (!userMatchesFrom(parsed.from, m.sender, m.sender_id, currentUserId)) return false;
      if (parsed.has.length) {
        const kinds = detectAttachmentKinds(m.content, m.image_url);
        for (const h of parsed.has) {
          if (!kinds.has(h)) return false;
        }
      }
      if (parsed.before || parsed.after || parsed.during) {
        const d = new Date(m.created_at);
        if (parsed.before && d >= startOfDay(parsed.before)) return false;
        if (parsed.after && d <= endOfDay(parsed.after)) return false;
        if (parsed.during && (d < startOfDay(parsed.during) || d > endOfDay(parsed.during)))
          return false;
      }
      if (parsed.keywords.length) {
        const lc = (m.content || "").toLowerCase();
        for (const k of parsed.keywords) {
          if (!lc.includes(k)) return false;
        }
      }
      return true;
    });
    const sorted = filtered.slice().sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return parsed.sort === "newest" ? tb - ta : ta - tb;
    });
    return sorted.slice(0, 100);
  }, [messages, parsed, currentUserId]);

  const hasActiveQuery = query.trim().length > 0;

  const setSingleToken = (key: string, value: string | null) => {
    setQuery((prev) => {
      const tokens = (prev.match(/"[^"]+"|\S+/g) || []).filter(
        (t) => !new RegExp(`^${key}:`, "i").test(t),
      );
      if (value) tokens.push(`${key}:${value}`);
      return tokens.join(" ") + (tokens.length ? " " : "");
    });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const toggleHasToken = (value: HasValue) => {
    const token = `has:${value}`;
    setQuery((prev) => {
      const tokens = (prev.match(/"[^"]+"|\S+/g) || []).filter(
        (t) => t.toLowerCase() !== token,
      );
      if (!parsed.has.includes(value)) tokens.push(token);
      return tokens.join(" ") + (tokens.length ? " " : "");
    });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const selectFromUser = (username: string | null) => {
    setQuery((prev) => {
      // Remove existing from: tokens then optionally add new one
      const tokens = (prev.match(/"[^"]+"|\S+/g) || []).filter(
        (t) => !/^from:/i.test(t),
      );
      if (username) {
        const needsQuotes = /\s/.test(username);
        tokens.push(`from:${needsQuotes ? `"${username}"` : username}`);
      }
      return tokens.join(" ") + (tokens.length ? " " : "");
    });
    setUserPopoverOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const clear = () => setQuery("");

  const loadOlderMessages = async () => {
    if (!onLoadMore || loadingOlder) return;
    setLoadingOlder(true);
    try {
      await onLoadMore();
    } finally {
      setLoadingOlder(false);
    }
  };

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" title="Search messages" className="h-9 w-9">
          <Search className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,420px)] p-0">
        <div className="p-3 border-b space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              autoFocus
              placeholder='Search... e.g. from:alice has:image "hello"'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 pr-8 h-9 font-mono text-xs"
            />
            {hasActiveQuery && (
              <button
                type="button"
                onClick={clear}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Popover open={userPopoverOpen} onOpenChange={setUserPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 px-2">
                  <User className="h-3 w-3" />
                  from:
                  {parsed.from.length > 0 && (
                    <span className="text-primary truncate max-w-[80px]">
                      {parsed.from.join(",")}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(92vw,240px)] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search users..." className="h-9 text-sm" />
                  <CommandList className="max-h-[220px]">
                    <CommandEmpty className="py-3 text-xs text-muted-foreground text-center">
                      No users found.
                    </CommandEmpty>
                    <CommandGroup>
                      <CommandItem onSelect={() => selectFromUser(null)} className="text-sm cursor-pointer">
                        <span className="flex items-center gap-2 flex-1">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                          Everyone
                        </span>
                        {parsed.from.length === 0 && <Check className="h-3.5 w-3.5" />}
                      </CommandItem>
                      {currentUserId && (
                        <CommandItem onSelect={() => selectFromUser("me")} className="text-sm cursor-pointer">
                          <span className="flex items-center gap-2 flex-1">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            You (from:me)
                          </span>
                          {parsed.from.includes("me") && <Check className="h-3.5 w-3.5" />}
                        </CommandItem>
                      )}
                      {users.map((u) => {
                        const selected = parsed.from.includes(u.username.toLowerCase());
                        return (
                          <CommandItem
                            key={u.id}
                            value={u.username + " " + u.name}
                            onSelect={() => selectFromUser(u.username)}
                            className="text-sm cursor-pointer"
                          >
                            <span className="flex items-center gap-2 flex-1 min-w-0">
                              <Avatar className="h-5 w-5">
                                <AvatarImage src={u.avatar_url || undefined} />
                                <AvatarFallback className="text-[10px]">
                                  {u.name[0]?.toUpperCase() || "?"}
                                </AvatarFallback>
                              </Avatar>
                              <span className="truncate">{u.name}</span>
                              <span className="text-[10px] text-muted-foreground truncate">@{u.username}</span>
                            </span>
                            {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <Popover open={filterPopoverOpen} onOpenChange={setFilterPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 px-2">
                  <Filter className="h-3 w-3" />
                  has:
                  {parsed.has.length > 0 && (
                    <span className="text-primary truncate max-w-[120px]">
                      {parsed.has.join(",")}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[180px] p-1" align="start">
                {HAS_VALUES.map((v) => {
                  const active = parsed.has.includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => toggleHasToken(v)}
                      className="w-full flex items-center justify-between px-2 py-1.5 text-sm rounded hover:bg-muted text-left"
                    >
                      <span>has:{v}</span>
                      {active && <Check className="h-3.5 w-3.5" />}
                    </button>
                  );
                })}
              </PopoverContent>
            </Popover>

            <DateFilterChip parsed={parsed} setSingleToken={setSingleToken} />

            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setSingleToken("sort", parsed.sort === "newest" ? "oldest" : "newest")
              }
              className="h-7 text-xs gap-1.5 px-2"
              title="Toggle sort order"
            >
              <ArrowUpDown className="h-3 w-3" />
              {parsed.sort === "newest" ? "Newest" : "Oldest"}
            </Button>

            {hasActiveQuery && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clear}
                className="h-7 text-xs px-2 text-muted-foreground"
              >
                Reset
              </Button>
            )}
          </div>

          <p className="text-[10px] text-muted-foreground leading-snug">
            Tokens: <code className="font-mono">from: has: before: after: during: sort:</code>.
            Click chips to auto-fill.
          </p>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {hasActiveQuery && (
            <div className="px-3 py-1.5 text-xs text-muted-foreground border-b">
              {results.length} result{results.length !== 1 ? "s" : ""}
            </div>
          )}
          {results.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {hasActiveQuery
                ? hasMore ? "No matches in loaded messages yet. Search older messages to continue." : "No matching messages in this conversation."
                : "Type to search messages."}
            </div>
          ) : (
            <ul className="p-2 space-y-1">
              {results.map((m) => {
                const kinds = detectAttachmentKinds(m.content, m.image_url);
                const att = kinds.has("attachment");
                const name = m.sender?.display_name || m.sender?.username || "Unknown";
                const preview = m.content
                  ? m.content.replace(ATTACHMENT_REGEX, "[attachment]")
                  : m.image_url
                  ? "[image]"
                  : "[attachment]";
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onJump(m.id);
                        setOpen(false);
                      }}
                      className="w-full text-left flex gap-2 items-start px-2 py-2 rounded-md hover:bg-muted transition-colors"
                    >
                      <Avatar className="h-7 w-7 flex-shrink-0 mt-0.5">
                        <AvatarImage src={m.sender?.avatar_url || undefined} />
                        <AvatarFallback className="text-xs">
                          {name[0]?.toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-medium truncate">{name}</span>
                          <span className="text-muted-foreground">
                            {new Date(m.created_at).toLocaleDateString()}
                          </span>
                          {att && <Paperclip className="h-3 w-3 text-muted-foreground" />}
                        </div>
                        {m.content ? (
                          <MessageMarkdown
                            content={preview}
                            isOwn={false}
                            className="text-sm whitespace-pre-wrap break-words text-foreground/90"
                          />
                        ) : (
                          <p className="text-sm text-muted-foreground italic break-words">
                            {preview}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {hasActiveQuery && hasMore && onLoadMore && (
            <div className="border-t p-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={loadingOlder}
                onClick={() => void loadOlderMessages()}
              >
                {loadingOlder ? "Loading older messages…" : "Search older messages"}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface DateFilterChipProps {
  parsed: ParsedQuery;
  setSingleToken: (key: string, value: string | null) => void;
}

function DateFilterChip({ parsed, setSingleToken }: DateFilterChipProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"before" | "after" | "during">(
    parsed.before ? "before" : parsed.after ? "after" : "during",
  );
  const active = parsed.before || parsed.after || parsed.during;
  const activeDate = parsed.before || parsed.after || parsed.during;
  const activeMode = parsed.before ? "before" : parsed.after ? "after" : parsed.during ? "during" : null;

  const apply = (date: Date | undefined) => {
    setSingleToken("before", null);
    setSingleToken("after", null);
    setSingleToken("during", null);
    if (date) {
      setTimeout(() => setSingleToken(mode, format(date, "yyyy-MM-dd")), 0);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 px-2">
          <CalendarIcon className="h-3 w-3" />
          {active && activeDate ? (
            <span className="text-primary truncate max-w-[140px]">
              {activeMode}:{format(activeDate, "yyyy-MM-dd")}
            </span>
          ) : (
            "date"
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="flex gap-1 mb-2">
          {(["before", "after", "during"] as const).map((m) => (
            <Button
              key={m}
              type="button"
              size="sm"
              variant={mode === m ? "default" : "outline"}
              className="h-7 text-xs flex-1"
              onClick={() => setMode(m)}
            >
              {m === "during" ? "on" : m}
            </Button>
          ))}
        </div>
        <Calendar
          mode="single"
          selected={activeDate}
          onSelect={apply}
          initialFocus
          className={cn("p-0 pointer-events-auto")}
        />
        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-xs mt-2"
            onClick={() => apply(undefined)}
          >
            Clear date
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

