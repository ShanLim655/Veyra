-- Create a security definer function to get analytics counts
-- This allows admins to see aggregate statistics without access to actual message content
CREATE OR REPLACE FUNCTION public.get_admin_analytics_counts()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  -- Only allow admins to call this function
  IF NOT is_admin_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT json_build_object(
    'totalMessages', (SELECT COUNT(*) FROM public.messages),
    'totalGlobalMessages', (SELECT COUNT(*) FROM public.global_messages),
    'totalAnnouncements', (SELECT COUNT(*) FROM public.announcement_messages),
    'totalConversations', (SELECT COUNT(*) FROM public.conversations WHERE is_group = false),
    'totalFriendships', (SELECT COUNT(*) FROM public.friend_requests WHERE status = 'accepted')
  ) INTO result;

  RETURN result;
END;
$$;

-- Create a function to get daily message stats for the last N days
CREATE OR REPLACE FUNCTION public.get_admin_daily_stats(days_count integer DEFAULT 7)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  start_date timestamp with time zone;
BEGIN
  -- Only allow admins to call this function
  IF NOT is_admin_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  start_date := date_trunc('day', now() - (days_count - 1) * interval '1 day');

  SELECT json_agg(daily_data ORDER BY day)
  INTO result
  FROM (
    SELECT 
      gs.day::date as day,
      COALESCE(m.count, 0) as messages,
      COALESCE(gm.count, 0) as global_messages,
      COALESCE(u.count, 0) as new_users
    FROM generate_series(start_date, now(), '1 day'::interval) gs(day)
    LEFT JOIN (
      SELECT date_trunc('day', created_at) as day, COUNT(*) as count
      FROM public.messages
      WHERE created_at >= start_date
      GROUP BY date_trunc('day', created_at)
    ) m ON m.day = date_trunc('day', gs.day)
    LEFT JOIN (
      SELECT date_trunc('day', created_at) as day, COUNT(*) as count
      FROM public.global_messages
      WHERE created_at >= start_date
      GROUP BY date_trunc('day', created_at)
    ) gm ON gm.day = date_trunc('day', gs.day)
    LEFT JOIN (
      SELECT date_trunc('day', created_at) as day, COUNT(*) as count
      FROM public.profiles
      WHERE created_at >= start_date
      GROUP BY date_trunc('day', created_at)
    ) u ON u.day = date_trunc('day', gs.day)
  ) daily_data;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- Create a function to get top users by message count
CREATE OR REPLACE FUNCTION public.get_admin_top_users(limit_count integer DEFAULT 10)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  -- Only allow admins to call this function
  IF NOT is_admin_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  SELECT json_agg(user_data ORDER BY message_count DESC)
  INTO result
  FROM (
    SELECT 
      p.id,
      p.username,
      p.display_name,
      p.avatar_url,
      COALESCE(m.count, 0) + COALESCE(gm.count, 0) as message_count
    FROM public.profiles p
    LEFT JOIN (
      SELECT sender_id, COUNT(*) as count
      FROM public.messages
      GROUP BY sender_id
    ) m ON m.sender_id = p.id
    LEFT JOIN (
      SELECT sender_id, COUNT(*) as count
      FROM public.global_messages
      GROUP BY sender_id
    ) gm ON gm.sender_id = p.id
    ORDER BY COALESCE(m.count, 0) + COALESCE(gm.count, 0) DESC
    LIMIT limit_count
  ) user_data;

  RETURN COALESCE(result, '[]'::json);
END;
$$;