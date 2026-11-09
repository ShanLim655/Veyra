export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_logs: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          details: Json | null
          id: string
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string
        }
        Relationships: []
      }
      announcement_messages: {
        Row: {
          content: string
          created_at: string
          edited_at: string | null
          id: string
          image_url: string | null
          is_pinned: boolean
          pinned_at: string | null
          pinned_by: string | null
          reply_to_id: string | null
          sender_id: string | null
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          edited_at?: string | null
          id?: string
          image_url?: string | null
          is_pinned?: boolean
          pinned_at?: string | null
          pinned_by?: string | null
          reply_to_id?: string | null
          sender_id?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          image_url?: string | null
          is_pinned?: boolean
          pinned_at?: string | null
          pinned_by?: string | null
          reply_to_id?: string | null
          sender_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "announcement_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_users: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      conversation_members: {
        Row: {
          conversation_id: string
          id: string
          joined_at: string
          role: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          id?: string
          joined_at?: string
          role?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          id?: string
          joined_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_group: boolean
          name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_group?: boolean
          name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_group?: boolean
          name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      friend_requests: {
        Row: {
          created_at: string
          id: string
          receiver_id: string
          sender_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          receiver_id: string
          sender_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          receiver_id?: string
          sender_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "friend_requests_receiver_id_fkey"
            columns: ["receiver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friend_requests_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      global_messages: {
        Row: {
          content: string
          created_at: string
          edited_at: string | null
          id: string
          image_url: string | null
          reply_to_id: string | null
          sender_id: string | null
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          edited_at?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          sender_id?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          sender_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "global_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "global_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "global_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          delivered_at: string | null
          edited_at: string | null
          id: string
          image_url: string | null
          is_pinned: boolean
          pinned_at: string | null
          pinned_by: string | null
          read_at: string | null
          reply_to_id: string | null
          sender_id: string | null
          updated_at: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          delivered_at?: string | null
          edited_at?: string | null
          id?: string
          image_url?: string | null
          is_pinned?: boolean
          pinned_at?: string | null
          pinned_by?: string | null
          read_at?: string | null
          reply_to_id?: string | null
          sender_id?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          delivered_at?: string | null
          edited_at?: string | null
          id?: string
          image_url?: string | null
          is_pinned?: boolean
          pinned_at?: string | null
          pinned_by?: string | null
          read_at?: string | null
          reply_to_id?: string | null
          sender_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      native_push_tokens: {
        Row: {
          created_at: string
          device_id: string | null
          enabled: boolean
          id: string
          last_seen_at: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          enabled?: boolean
          id?: string
          last_seen_at?: string
          platform: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          enabled?: boolean
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_digest_state: {
        Row: {
          channel_key: string
          last_notified_at: string
          user_id: string
        }
        Insert: {
          channel_key: string
          last_notified_at?: string
          user_id: string
        }
        Update: {
          channel_key?: string
          last_notified_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          announcement_body_template: string
          announcement_custom_enabled: boolean
          announcement_mode: string
          announcement_title_template: string
          created_at: string
          digest_cooldown_minutes: number
          dm_body_template: string
          dm_custom_enabled: boolean
          dm_mode: string
          dm_title_template: string
          global_body_template: string
          global_custom_enabled: boolean
          global_mode: string
          global_title_template: string
          ntfy_server: string
          ntfy_topic: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          announcement_body_template?: string
          announcement_custom_enabled?: boolean
          announcement_mode?: string
          announcement_title_template?: string
          created_at?: string
          digest_cooldown_minutes?: number
          dm_body_template?: string
          dm_custom_enabled?: boolean
          dm_mode?: string
          dm_title_template?: string
          global_body_template?: string
          global_custom_enabled?: boolean
          global_mode?: string
          global_title_template?: string
          ntfy_server?: string
          ntfy_topic?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          announcement_body_template?: string
          announcement_custom_enabled?: boolean
          announcement_mode?: string
          announcement_title_template?: string
          created_at?: string
          digest_cooldown_minutes?: number
          dm_body_template?: string
          dm_custom_enabled?: boolean
          dm_mode?: string
          dm_title_template?: string
          global_body_template?: string
          global_custom_enabled?: boolean
          global_mode?: string
          global_title_template?: string
          ntfy_server?: string
          ntfy_topic?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_trigger_events: {
        Row: {
          channel: string
          created_at: string
          id: string
          message_id: string
          token: string
        }
        Insert: {
          channel: string
          created_at?: string
          id?: string
          message_id: string
          token?: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          message_id?: string
          token?: string
        }
        Relationships: []
      }
      pinned_conversations: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      poll_options: {
        Row: {
          created_at: string
          id: string
          poll_id: string
          position: number
          text: string
        }
        Insert: {
          created_at?: string
          id?: string
          poll_id: string
          position: number
          text: string
        }
        Update: {
          created_at?: string
          id?: string
          poll_id?: string
          position?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_options_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_votes: {
        Row: {
          created_at: string
          id: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          option_id?: string
          poll_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "poll_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      polls: {
        Row: {
          channel: string
          closed_at: string | null
          conversation_id: string | null
          created_at: string
          created_by: string
          ends_at: string
          id: string
          message_id: string | null
          multiple_choice: boolean
          question: string
          result_message_id: string | null
          updated_at: string
        }
        Insert: {
          channel: string
          closed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by: string
          ends_at: string
          id?: string
          message_id?: string | null
          multiple_choice?: boolean
          question: string
          result_message_id?: string | null
          updated_at?: string
        }
        Update: {
          channel?: string
          closed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string
          ends_at?: string
          id?: string
          message_id?: string | null
          multiple_choice?: boolean
          question?: string
          result_message_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          allow_friend_requests: boolean
          announcements_last_read_at: string
          avatar_url: string | null
          banner_gradient: string | null
          banner_url: string | null
          bio: string | null
          created_at: string
          custom_status_emoji: string | null
          custom_status_expires_at: string | null
          custom_status_set_at: string | null
          custom_status_text: string | null
          display_name: string | null
          global_mentions_last_read_at: string | null
          id: string
          pronouns: string | null
          status: string | null
          updated_at: string
          username: string
          username_set: boolean
        }
        Insert: {
          allow_friend_requests?: boolean
          announcements_last_read_at?: string
          avatar_url?: string | null
          banner_gradient?: string | null
          banner_url?: string | null
          bio?: string | null
          created_at?: string
          custom_status_emoji?: string | null
          custom_status_expires_at?: string | null
          custom_status_set_at?: string | null
          custom_status_text?: string | null
          display_name?: string | null
          global_mentions_last_read_at?: string | null
          id: string
          pronouns?: string | null
          status?: string | null
          updated_at?: string
          username: string
          username_set?: boolean
        }
        Update: {
          allow_friend_requests?: boolean
          announcements_last_read_at?: string
          avatar_url?: string | null
          banner_gradient?: string | null
          banner_url?: string | null
          bio?: string | null
          created_at?: string
          custom_status_emoji?: string | null
          custom_status_expires_at?: string | null
          custom_status_set_at?: string | null
          custom_status_text?: string | null
          display_name?: string | null
          global_mentions_last_read_at?: string | null
          id?: string
          pronouns?: string | null
          status?: string | null
          updated_at?: string
          username?: string
          username_set?: boolean
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accepts_friend_requests: { Args: { _user_id: string }; Returns: boolean }
      add_group_members: {
        Args: { _conv: string; _user_ids: string[] }
        Returns: undefined
      }
      create_group_chat: {
        Args: { _member_ids: string[]; _name: string }
        Returns: string
      }
      finalize_poll: { Args: { _poll_id: string }; Returns: string }
      get_admin_analytics_counts: { Args: never; Returns: Json }
      get_admin_daily_stats: { Args: { days_count?: number }; Returns: Json }
      get_admin_top_users: { Args: { limit_count?: number }; Returns: Json }
      get_or_create_dm: { Args: { _other_user_id: string }; Returns: string }
      get_user_dm_list: {
        Args: never
        Returns: {
          conversation_id: string
          friend_request_id: string
          is_pinned: boolean
          last_message_at: string
          other_avatar_url: string
          other_custom_status_emoji: string
          other_custom_status_expires_at: string
          other_custom_status_text: string
          other_display_name: string
          other_status: string
          other_user_id: string
          other_username: string
          unread_count: number
        }[]
      }
      get_user_group_list: {
        Args: never
        Returns: {
          conversation_id: string
          is_pinned: boolean
          last_message_at: string
          member_count: number
          member_previews: Json
          my_role: string
          name: string
          unread_count: number
        }[]
      }
      get_user_role_for_admin: {
        Args: { _target_user_id: string }
        Returns: string
      }
      get_user_sessions: {
        Args: never
        Returns: {
          aal: string
          created_at: string
          id: string
          ip: string
          updated_at: string
          user_agent: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_or_super: { Args: { _user_id: string }; Returns: boolean }
      is_blocked: { Args: { _a: string; _b: string }; Returns: boolean }
      is_conversation_member: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: boolean
      }
      is_group_admin: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: boolean
      }
      is_group_owner: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      leave_group: { Args: { _conv: string }; Returns: undefined }
      mark_conversation_delivered: {
        Args: { _conversation_id: string }
        Returns: undefined
      }
      mark_global_mentions_read: { Args: never; Returns: undefined }
      mark_message_delivered: {
        Args: { _message_id: string }
        Returns: undefined
      }
      mark_message_read: { Args: { _message_id: string }; Returns: undefined }
      register_native_push_token: {
        Args: { p_device_id?: string; p_platform: string; p_token: string }
        Returns: undefined
      }
      remove_group_member: {
        Args: { _conv: string; _user_id: string }
        Returns: undefined
      }
      rename_group: {
        Args: { _conv: string; _name: string }
        Returns: undefined
      }
      revoke_user_session: { Args: { _session_id: string }; Returns: undefined }
      set_member_role: {
        Args: { _conv: string; _role: string; _user_id: string }
        Returns: undefined
      }
      transfer_group_ownership: {
        Args: { _conv: string; _new_owner: string }
        Returns: undefined
      }
      unregister_native_push_token: {
        Args: { p_token: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "user" | "admin" | "super_admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["user", "admin", "super_admin"],
    },
  },
} as const
