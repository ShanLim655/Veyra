import { authClient } from './client-core';

const PUBLIC_TOPIC = 'veyra-public-mariadb';
const PUBLIC_TABLES = new Set(['global_messages', 'announcement_messages']);

export type MariaDbChange = {
  schema: string;
  table: string;
  eventType: string;
  operation?: string;
  actor_id?: string;
  keys: Record<string, string | number>;
  columns: string[];
  refresh: true;
};
export type ChangeFilter = {
  event?: string;
  schema?: string;
  table?: string;
  filter?: string;
};
type Subscriber = {
  filter: ChangeFilter;
  callback: (payload: MariaDbChange & { new: Record<string, unknown>; old: Record<string, unknown> }) => void;
};
export type MariaDbChangeCallback = Subscriber['callback'];
type RealtimeChannel = ReturnType<typeof authClient.channel>;

const subscribers = new Set<Subscriber>();
let userId: string | null = null;
let userTopic: string | null = null;
let userTopicRequest: Promise<void> | null = null;
let userChannel: RealtimeChannel | null = null;
let publicChannel: RealtimeChannel | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
let identityRevision = 0;

function filterMatches(filter: string | undefined, keys: Record<string, string | number>) {
  if (!filter) return true;
  const match = filter.match(/^([a-z_][a-z0-9_]*)=(eq|is|in)\.(.*)$/i);
  if (!match) return true;
  const [, column, operator, rawValue] = match;
  const actual = keys[column];
  if (actual === undefined) return column === 'conversation_id' && keys.id !== undefined;
  if (operator.toLowerCase() === 'in') {
    const expected = rawValue.replace(/^\(|\)$/g, '').split(',').map((value) => value.replace(/^"|"$/g, ''));
    return expected.includes(String(actual));
  }
  return String(actual) === rawValue.replace(/^"|"$/g, '');
}

function matches(subscriber: Subscriber, change: MariaDbChange) {
  const { event = '*', schema = 'public', table } = subscriber.filter;
  return (schema === '*' || schema === change.schema)
    && (!table || table === '*' || table === change.table)
    && (event === '*' || event === change.eventType)
    && filterMatches(subscriber.filter.filter, change.keys);
}

function dispatch(message: unknown, publicOnly: boolean) {
  const envelope = message as { payload?: unknown };
  const maybeChange = (envelope?.payload ?? message) as { payload?: unknown };
  const change = (maybeChange?.payload ?? maybeChange) as MariaDbChange;
  if (!change || typeof change.table !== 'string' || !change.keys) return;

  const isPublic = PUBLIC_TABLES.has(change.table)
    || change.table === 'polls' && !change.keys.conversation_id;
  if (publicOnly !== isPublic) return;
  for (const subscriber of subscribers) {
    if (!matches(subscriber, change)) continue;
    subscriber.callback({ ...change, new: change.keys, old: change.keys });
  }
}

function openChannel(topic: string, publicOnly: boolean) {
  const channel = authClient.channel(topic);
  channel
    .on('broadcast', { event: 'db-change' }, (message: unknown) => dispatch(message, publicOnly))
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('MariaDB live-update channel status:', status);
      }
    });
  return channel;
}

function ensurePublicChannel() {
  if (!publicChannel && [...subscribers].some(({ filter }) => {
    const table = filter.table;
    return !table || table === '*' || table === 'polls' || PUBLIC_TABLES.has(table);
  })) publicChannel = openChannel(PUBLIC_TOPIC, true);
}

async function ensureUserTopic() {
  if (!userId || userChannel || userTopicRequest) return userTopicRequest;
  const requestedUser = userId;
  const revision = identityRevision;
  userTopicRequest = (async () => {
    try {
      const response = await fetch('/api/realtime/topic', { credentials: 'same-origin' });
      const result = await response.json() as { topic?: string };
      if (!response.ok || !result.topic || userId !== requestedUser || identityRevision !== revision) return;
      userTopic = result.topic;
      if (subscribers.size) userChannel = openChannel(userTopic, false);
    } catch (error) {
      console.warn('Could not initialize MariaDB live updates:', error instanceof Error ? error.message : 'network error');
    } finally {
      userTopicRequest = null;
      if (userId && subscribers.size && (userId !== requestedUser || identityRevision !== revision)) {
        void ensureUserTopic();
      }
    }
  })();
  return userTopicRequest;
}

export function setMariaDbRealtimeUserId(nextUserId: string | null) {
  if (userId === nextUserId) return;
  userId = nextUserId;
  userTopic = null;
  identityRevision++;
  if (userChannel) {
    const previous = userChannel;
    userChannel = null;
    void authClient.removeChannel(previous);
  }
  if (userId && subscribers.size) void ensureUserTopic();
}

export function subscribeMariaDbChanges(filter: ChangeFilter, callback: Subscriber['callback']) {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = undefined;
  const subscriber = { filter, callback };
  subscribers.add(subscriber);
  ensurePublicChannel();
  if (userId) {
    if (userTopic && !userChannel) userChannel = openChannel(userTopic, false);
    else void ensureUserTopic();
  }

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size || releaseTimer) return;
    releaseTimer = setTimeout(() => {
      releaseTimer = undefined;
      if (subscribers.size) return;
      const channels = [userChannel, publicChannel].filter(Boolean) as RealtimeChannel[];
      userChannel = null;
      publicChannel = null;
      userTopic = null;
      channels.forEach((channel) => void authClient.removeChannel(channel));
    }, 20_000);
  };
}
