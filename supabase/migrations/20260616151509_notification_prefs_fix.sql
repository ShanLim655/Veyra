-- Ensure notification_preferences exists and add per-channel custom-content toggles.

create table if not exists public.notification_preferences (
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
  dm_custom_enabled boolean not null default false,
  global_custom_enabled boolean not null default false,
  announcement_custom_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences add column if not exists dm_custom_enabled boolean not null default false;
alter table public.notification_preferences add column if not exists global_custom_enabled boolean not null default false;
alter table public.notification_preferences add column if not exists announcement_custom_enabled boolean not null default false;

grant select, insert, update, delete on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;

alter table public.notification_preferences enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notification_preferences' and policyname='own prefs select') then
    create policy "own prefs select" on public.notification_preferences for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notification_preferences' and policyname='own prefs insert') then
    create policy "own prefs insert" on public.notification_preferences for insert to authenticated with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notification_preferences' and policyname='own prefs update') then
    create policy "own prefs update" on public.notification_preferences for update to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notification_preferences' and policyname='own prefs delete') then
    create policy "own prefs delete" on public.notification_preferences for delete to authenticated using (auth.uid() = user_id);
  end if;
end $$;

create table if not exists public.notification_digest_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_key text not null,
  last_notified_at timestamptz not null default now(),
  primary key (user_id, channel_key)
);

grant select, insert, update, delete on public.notification_digest_state to authenticated;
grant all on public.notification_digest_state to service_role;

alter table public.notification_digest_state enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notification_digest_state' and policyname='own digest select') then
    create policy "own digest select" on public.notification_digest_state for select to authenticated using (auth.uid() = user_id);
  end if;
end $$;

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

do $$ begin
  if to_regclass('public.messages') is not null
     and not exists (select 1 from pg_trigger where tgname = 'ntfy_after_dm') then
    create trigger ntfy_after_dm after insert on public.messages
      for each row execute function public.notify_ntfy('dm');
  end if;
  if to_regclass('public.global_messages') is not null
     and not exists (select 1 from pg_trigger where tgname = 'ntfy_after_global') then
    create trigger ntfy_after_global after insert on public.global_messages
      for each row execute function public.notify_ntfy('global');
  end if;
  if to_regclass('public.announcement_messages') is not null
     and not exists (select 1 from pg_trigger where tgname = 'ntfy_after_announcement') then
    create trigger ntfy_after_announcement after insert on public.announcement_messages
      for each row execute function public.notify_ntfy('announcement');
  end if;
end $$;
