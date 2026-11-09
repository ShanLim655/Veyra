import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface GroupAvatarMember {
  id: string;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
}

interface GroupAvatarProps {
  members: GroupAvatarMember[];
  name?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_MAP = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
} as const;

/**
 * Renders up to four member avatars stacked as a collage. If there aren't
 * enough members, falls back to a single avatar or the group's initials.
 */
export function GroupAvatar({ members, name, size = "md", className }: GroupAvatarProps) {
  const tiles = members.slice(0, 4);
  const initials =
    (name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("") || "G";

  if (tiles.length <= 1) {
    const sole = tiles[0];
    return (
      <Avatar className={cn(SIZE_MAP[size], "flex-shrink-0", className)}>
        <AvatarImage src={sole?.avatar_url || undefined} />
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
    );
  }

  return (
    <div
      className={cn(
        SIZE_MAP[size],
        "relative flex-shrink-0 grid grid-cols-2 grid-rows-2 gap-[1px] overflow-hidden rounded-full bg-muted",
        className,
      )}
      aria-label={name ? `${name} group avatar` : "Group avatar"}
    >
      {tiles.map((m, i) => (
        <div key={m.id ?? i} className="overflow-hidden">
          {m.avatar_url ? (
            <img
              src={m.avatar_url}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted text-[10px] font-semibold text-muted-foreground">
              {(m.display_name || m.username || "?")[0]?.toUpperCase()}
            </div>
          )}
        </div>
      ))}
      {tiles.length === 3 && <div className="bg-muted" />}
    </div>
  );
}
