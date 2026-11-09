// Mention utilities shared by ChatView, MessageMarkdown, and FriendsList.
//
// Mentions are stored inline in the message content as `@username` (lowercased
// username, the value of `profiles.username`) or `@everyone`. We use a strict
// boundary so that `@bob` doesn't match inside `@bobby` or inside an email.

const USERNAME_RE_SOURCE = "(?:[A-Za-z0-9_]{2,32})";

/** Boundary: start of string OR whitespace. Prevents emails (foo@bar.com) and
 * URLs (/channel/@foo) from being parsed as mentions — a real mention is only
 * ever typed after whitespace or at the start of the message. */
const PRE = "(^|\\s)";
const POST = "(?=$|[^A-Za-z0-9_])";

export const MENTION_TOKEN_RE = new RegExp(
  `${PRE}@(everyone|${USERNAME_RE_SOURCE})${POST}`,
  "g",
);

export interface ParsedMentions {
  usernames: string[]; // lowercased
  everyone: boolean;
}

/**
 * Extract all @username / @everyone mentions from a message body.
 * `knownUsernames`, when provided, restricts results to real users — used at
 * send time. If omitted, every token is returned.
 */
export function parseMentions(
  content: string,
  knownUsernames?: Set<string>,
): ParsedMentions {
  const re = new RegExp(MENTION_TOKEN_RE.source, "g");
  const result: ParsedMentions = { usernames: [], everyone: false };
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const raw = m[2];
    const lower = raw.toLowerCase();
    if (lower === "everyone") {
      result.everyone = true;
      continue;
    }
    if (knownUsernames && !knownUsernames.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.usernames.push(lower);
  }
  return result;
}

/** Does the message body mention this specific username? */
export function messageMentionsUser(content: string, username: string): boolean {
  if (!username) return false;
  const re = new RegExp(
    `${PRE}@${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${POST}`,
    "i",
  );
  return re.test(content);
}

export function messageMentionsEveryone(content: string): boolean {
  return new RegExp(`${PRE}@everyone${POST}`, "i").test(content);
}

/**
 * Does the message body mention the current user OR `@everyone`?
 * Used to decide whether to show the red mention indicator.
 */
export function messageMentionsMe(
  content: string,
  myUsername: string | null | undefined,
): boolean {
  if (!content) return false;
  if (messageMentionsEveryone(content)) return true;
  if (myUsername && messageMentionsUser(content, myUsername)) return true;
  return false;
}

/**
 * Build the Postgres ILIKE pattern list used to find messages mentioning me.
 * The query still needs client-side filtering with `messageMentionsMe` to
 * eliminate substring false positives (e.g. `@bob` inside `@bobby`).
 */
export function mentionIlikePatterns(myUsername: string | null | undefined): string[] {
  const patterns = ["%@everyone%"];
  if (myUsername) patterns.push(`%@${myUsername}%`);
  return patterns;
}
