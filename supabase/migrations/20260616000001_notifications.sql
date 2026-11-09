-- Notification preferences for ntfy.sh push notifications
create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ntfy_topic text,
  ntfy_server text not null default 'https://ntfy.sh',
  dm_mode text not null default 'off' check (dm_mode in ('off','every','digest')),
  global_mode text not null default 'off' check (global_mode in ('off','every','digest')),
  announcement_mode text not null default 'off' check (announcement_mode in ('off','every','digest')),
  dm_title_template text not null default 'New message from {user}',
  dm_body_template text not null default '{message}',
  global_title_template text not null default '{user} in Global Chat',
  global_body_template text not null default '{message}',
  announcement_title_template text not null default 'Announcement from {user}',
  announcement_body_template text not null default '{message}',
  digest_cooldown_minutes integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;

alter table public.notification_preferences enable row level security;

create policy "own prefs select" on public.notification_preferences for select to authenticated using (auth.uid() = user_id);
create policy "own prefs insert" on public.notification_preferences for insert to authenticated with check (auth.uid() = user_id);
create policy "own prefs update" on public.notification_preferences for update to authenticated using (auth.uid() = user_id);
create policy "own prefs delete" on public.notification_preferences for delete to authenticated using (auth.uid() = user_id);

create table public.notification_digest_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_key text not null,
  last_notified_at timestamptz not null default now(),
  primary key (user_id, channel_key)
);

grant select on public.notification_digest_state to authenticated;
grant all on public.notification_digest_state to service_role;

alter table public.notification_digest_state enable row level security;
create policy "own digest select" on public.notification_digest_state for select to authenticated using (auth.uid() = user_id);

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_ntfy()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  fn_url text := 'https://ikrdlyuniuphcqtdkqnv.supabase.co/functions/v1/send-ntfy';
  payload jsonb;
begin
  payload := jsonb_build_object(
    'channel', TG_ARGV[0],
    'message_id', NEW.id,
    'sender_id', NEW.sender_id,
    'content', coalesce(NEW.content, ''),
    'conversation_id', case when TG_ARGV[0] = 'dm' then NEW.conversation_id else null end
  );
  perform net.http_post(
    url := fn_url,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := payload
  );
  return NEW;
end;
$$;

create trigger ntfy_after_dm
  after insert on public.messages
  for each row execute function public.notify_ntfy('dm');

create trigger ntfy_after_global
  after insert on public.global_messages
  for each row execute function public.notify_ntfy('global');

create trigger ntfy_after_announcement
  after insert on public.announcement_messages
  for each row execute function public.notify_ntfy('announcement');
