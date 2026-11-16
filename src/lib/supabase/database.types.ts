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
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      catalog_imports: {
        Row: {
          created_at: string
          external_id: string
          id: number
          source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          external_id: string
          id?: never
          source: string
          user_id: string
        }
        Update: {
          created_at?: string
          external_id?: string
          id?: never
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      faq_entries: {
        Row: {
          created_at: string
          created_by: string | null
          game_id: string
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          sort: number
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          game_id: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sort?: number
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          game_id?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sort?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "faq_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faq_entries_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faq_entries_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      faq_translations: {
        Row: {
          answer: string
          faq_id: string
          locale: string
          question: string
        }
        Insert: {
          answer: string
          faq_id: string
          locale: string
          question: string
        }
        Update: {
          answer?: string
          faq_id?: string
          locale?: string
          question?: string
        }
        Relationships: [
          {
            foreignKeyName: "faq_translations_faq_id_fkey"
            columns: ["faq_id"]
            isOneToOne: false
            referencedRelation: "faq_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      game_external_ids: {
        Row: {
          external_id: string
          game_id: string
          source: string
        }
        Insert: {
          external_id: string
          game_id: string
          source: string
        }
        Update: {
          external_id?: string
          game_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_external_ids_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      game_images: {
        Row: {
          attribution: string
          caption: string | null
          created_at: string
          game_id: string
          id: string
          license: string | null
          sort: number
          url: string
        }
        Insert: {
          attribution: string
          caption?: string | null
          created_at?: string
          game_id: string
          id?: string
          license?: string | null
          sort?: number
          url: string
        }
        Update: {
          attribution?: string
          caption?: string | null
          created_at?: string
          game_id?: string
          id?: string
          license?: string | null
          sort?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_images_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      game_photos: {
        Row: {
          created_at: string
          game_id: string
          id: string
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          storage_path: string
          user_id?: string
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_photos_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_photos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      game_relations: {
        Row: {
          game_id: string
          id: string
          related_external_id: string | null
          related_game_id: string | null
          related_name: string | null
          related_source: string | null
          type: string
        }
        Insert: {
          game_id: string
          id?: string
          related_external_id?: string | null
          related_game_id?: string | null
          related_name?: string | null
          related_source?: string | null
          type: string
        }
        Update: {
          game_id?: string
          id?: string
          related_external_id?: string | null
          related_game_id?: string | null
          related_name?: string | null
          related_source?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_relations_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_relations_related_game_id_fkey"
            columns: ["related_game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      game_resources: {
        Row: {
          created_at: string
          created_by: string | null
          game_id: string
          id: string
          is_official: boolean
          kind: string
          locale: string | null
          sort: number
          title: string
          url: string | null
          youtube_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          game_id: string
          id?: string
          is_official?: boolean
          kind: string
          locale?: string | null
          sort?: number
          title: string
          url?: string | null
          youtube_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          game_id?: string
          id?: string
          is_official?: boolean
          kind?: string
          locale?: string | null
          sort?: number
          title?: string
          url?: string | null
          youtube_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_resources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_resources_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      game_terms: {
        Row: {
          game_id: string
          term_id: string
        }
        Insert: {
          game_id: string
          term_id: string
        }
        Update: {
          game_id?: string
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_terms_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_terms_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      game_translations: {
        Row: {
          description: string | null
          game_id: string
          locale: string
          name: string | null
        }
        Insert: {
          description?: string | null
          game_id: string
          locale: string
          name?: string | null
        }
        Update: {
          description?: string | null
          game_id?: string
          locale?: string
          name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_translations_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          cover_url: string | null
          created_at: string
          fetched_at: string | null
          id: string
          kind: string
          max_players: number | null
          max_playtime: number | null
          min_age: number | null
          min_players: number | null
          min_playtime: number | null
          name: string
          original_language: string
          original_name: string | null
          owner_id: string | null
          source: string
          updated_at: string
          year_published: number | null
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          fetched_at?: string | null
          id?: string
          kind?: string
          max_players?: number | null
          max_playtime?: number | null
          min_age?: number | null
          min_players?: number | null
          min_playtime?: number | null
          name: string
          original_language?: string
          original_name?: string | null
          owner_id?: string | null
          source: string
          updated_at?: string
          year_published?: number | null
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          fetched_at?: string | null
          id?: string
          kind?: string
          max_players?: number | null
          max_playtime?: number | null
          min_age?: number | null
          min_players?: number | null
          min_playtime?: number | null
          name?: string
          original_language?: string
          original_name?: string | null
          owner_id?: string | null
          source?: string
          updated_at?: string
          year_published?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "games_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      library_items: {
        Row: {
          created_at: string
          game_id: string
          id: string
          is_favorite: boolean
          notes: string | null
          rating: number | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          is_favorite?: boolean
          notes?: string | null
          rating?: number | null
          status: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          is_favorite?: boolean
          notes?: string | null
          rating?: number | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_items_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          display_name: string
          id: string
          is_public: boolean
          locale: string
          theme: string
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_public?: boolean
          locale?: string
          theme?: string
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_public?: boolean
          locale?: string
          theme?: string
          updated_at?: string
        }
        Relationships: []
      }
      rules_content: {
        Row: {
          body: string
          game_id: string
          locale: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body: string
          game_id: string
          locale: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          game_id?: string
          locale?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rules_content_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rules_content_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_sheet_versions: {
        Row: {
          created_at: string
          definition: Json
          id: string
          sheet_id: string
          version: number
        }
        Insert: {
          created_at?: string
          definition: Json
          id?: string
          sheet_id: string
          version: number
        }
        Update: {
          created_at?: string
          definition?: Json
          id?: string
          sheet_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "scoring_sheet_versions_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "scoring_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_sheets: {
        Row: {
          copied_from: string | null
          created_at: string
          game_id: string
          id: string
          locale: string
          owner_id: string
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          copied_from?: string | null
          created_at?: string
          game_id: string
          id?: string
          locale: string
          owner_id?: string
          title: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          copied_from?: string | null
          created_at?: string
          game_id?: string
          id?: string
          locale?: string
          owner_id?: string
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "scoring_sheets_copied_from_fkey"
            columns: ["copied_from"]
            isOneToOne: false
            referencedRelation: "scoring_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_sheets_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_sheets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      term_translations: {
        Row: {
          locale: string
          name: string
          term_id: string
        }
        Insert: {
          locale: string
          name: string
          term_id: string
        }
        Update: {
          locale?: string
          name?: string
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "term_translations_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      terms: {
        Row: {
          external_id: string
          id: string
          name: string
          source: string
          type: string
        }
        Insert: {
          external_id: string
          id?: string
          name: string
          source: string
          type: string
        }
        Update: {
          external_id?: string
          id?: string
          name?: string
          source?: string
          type?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_id: { Args: never; Returns: string }
      f_unaccent: { Args: { "": string }; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      search_games: {
        Args: {
          p_kind?: string
          p_limit?: number
          p_max_minutes?: number
          p_players?: number
          q?: string
        }
        Returns: {
          cover_url: string | null
          created_at: string
          fetched_at: string | null
          id: string
          kind: string
          max_players: number | null
          max_playtime: number | null
          min_age: number | null
          min_players: number | null
          min_playtime: number | null
          name: string
          original_language: string
          original_name: string | null
          owner_id: string | null
          source: string
          updated_at: string
          year_published: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "games"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_library: {
        Args: {
          p_favorites?: boolean
          p_limit?: number
          p_status?: string
          q?: string
        }
        Returns: {
          cover_url: string
          game_id: string
          is_favorite: boolean
          item_id: string
          kind: string
          max_players: number
          max_playtime: number
          min_players: number
          min_playtime: number
          name: string
          rating: number
          source: string
          status: string
          year_published: number
        }[]
      }
      upsert_external_game: { Args: { p: Json }; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
