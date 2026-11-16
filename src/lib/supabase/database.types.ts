export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      catalog_imports: {
        Row: {
          created_at: string;
          external_id: string;
          id: number;
          source: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          external_id: string;
          id?: never;
          source: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          external_id?: string;
          id?: never;
          source?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      faq_entries: {
        Row: {
          created_at: string;
          created_by: string | null;
          game_id: string;
          id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          sort: number;
          status: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          game_id: string;
          id?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sort?: number;
          status?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          game_id?: string;
          id?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sort?: number;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "faq_entries_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "faq_entries_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "faq_entries_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      faq_translations: {
        Row: {
          answer: string;
          faq_id: string;
          locale: string;
          question: string;
        };
        Insert: {
          answer: string;
          faq_id: string;
          locale: string;
          question: string;
        };
        Update: {
          answer?: string;
          faq_id?: string;
          locale?: string;
          question?: string;
        };
        Relationships: [
          {
            foreignKeyName: "faq_translations_faq_id_fkey";
            columns: ["faq_id"];
            isOneToOne: false;
            referencedRelation: "faq_entries";
            referencedColumns: ["id"];
          },
        ];
      };
      game_barcodes: {
        Row: {
          created_at: string;
          game_id: string;
          gtin: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          game_id: string;
          gtin: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          game_id?: string;
          gtin?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "game_barcodes_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "game_barcodes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      game_external_ids: {
        Row: {
          external_id: string;
          game_id: string;
          source: string;
        };
        Insert: {
          external_id: string;
          game_id: string;
          source: string;
        };
        Update: {
          external_id?: string;
          game_id?: string;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: "game_external_ids_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
        ];
      };
      game_image_hashes: {
        Row: {
          created_at: string;
          game_id: string;
          hash: number;
          id: string;
          owner_id: string | null;
          source: string;
        };
        Insert: {
          created_at?: string;
          game_id: string;
          hash: number;
          id?: string;
          owner_id?: string | null;
          source: string;
        };
        Update: {
          created_at?: string;
          game_id?: string;
          hash?: number;
          id?: string;
          owner_id?: string | null;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: "game_image_hashes_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "game_image_hashes_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      game_images: {
        Row: {
          attribution: string;
          caption: string | null;
          created_at: string;
          game_id: string;
          id: string;
          license: string | null;
          sort: number;
          url: string;
        };
        Insert: {
          attribution: string;
          caption?: string | null;
          created_at?: string;
          game_id: string;
          id?: string;
          license?: string | null;
          sort?: number;
          url: string;
        };
        Update: {
          attribution?: string;
          caption?: string | null;
          created_at?: string;
          game_id?: string;
          id?: string;
          license?: string | null;
          sort?: number;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "game_images_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
        ];
      };
      game_photos: {
        Row: {
          created_at: string;
          game_id: string;
          id: string;
          storage_path: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          game_id: string;
          id?: string;
          storage_path: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          game_id?: string;
          id?: string;
          storage_path?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "game_photos_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "game_photos_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      game_relations: {
        Row: {
          game_id: string;
          id: string;
          related_external_id: string | null;
          related_game_id: string | null;
          related_name: string | null;
          related_source: string | null;
          type: string;
        };
        Insert: {
          game_id: string;
          id?: string;
          related_external_id?: string | null;
          related_game_id?: string | null;
          related_name?: string | null;
          related_source?: string | null;
          type: string;
        };
        Update: {
          game_id?: string;
          id?: string;
          related_external_id?: string | null;
          related_game_id?: string | null;
          related_name?: string | null;
          related_source?: string | null;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "game_relations_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "game_relations_related_game_id_fkey";
            columns: ["related_game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
        ];
      };
      game_resources: {
        Row: {
          created_at: string;
          created_by: string | null;
          game_id: string;
          id: string;
          is_official: boolean;
          kind: string;
          locale: string | null;
          sort: number;
          title: string;
          url: string | null;
          youtube_id: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          game_id: string;
          id?: string;
          is_official?: boolean;
          kind: string;
          locale?: string | null;
          sort?: number;
          title: string;
          url?: string | null;
          youtube_id?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          game_id?: string;
          id?: string;
          is_official?: boolean;
          kind?: string;
          locale?: string | null;
          sort?: number;
          title?: string;
          url?: string | null;
          youtube_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "game_resources_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "game_resources_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
        ];
      };
      game_terms: {
        Row: {
          game_id: string;
          term_id: string;
        };
        Insert: {
          game_id: string;
          term_id: string;
        };
        Update: {
          game_id?: string;
          term_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "game_terms_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "game_terms_term_id_fkey";
            columns: ["term_id"];
            isOneToOne: false;
            referencedRelation: "terms";
            referencedColumns: ["id"];
          },
        ];
      };
      game_translations: {
        Row: {
          description: string | null;
          game_id: string;
          locale: string;
          name: string | null;
        };
        Insert: {
          description?: string | null;
          game_id: string;
          locale: string;
          name?: string | null;
        };
        Update: {
          description?: string | null;
          game_id?: string;
          locale?: string;
          name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "game_translations_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
        ];
      };
      games: {
        Row: {
          cover_url: string | null;
          created_at: string;
          fetched_at: string | null;
          id: string;
          kind: string;
          max_players: number | null;
          max_playtime: number | null;
          min_age: number | null;
          min_players: number | null;
          min_playtime: number | null;
          name: string;
          original_language: string;
          original_name: string | null;
          owner_id: string | null;
          source: string;
          updated_at: string;
          year_published: number | null;
        };
        Insert: {
          cover_url?: string | null;
          created_at?: string;
          fetched_at?: string | null;
          id?: string;
          kind?: string;
          max_players?: number | null;
          max_playtime?: number | null;
          min_age?: number | null;
          min_players?: number | null;
          min_playtime?: number | null;
          name: string;
          original_language?: string;
          original_name?: string | null;
          owner_id?: string | null;
          source: string;
          updated_at?: string;
          year_published?: number | null;
        };
        Update: {
          cover_url?: string | null;
          created_at?: string;
          fetched_at?: string | null;
          id?: string;
          kind?: string;
          max_players?: number | null;
          max_playtime?: number | null;
          min_age?: number | null;
          min_players?: number | null;
          min_playtime?: number | null;
          name?: string;
          original_language?: string;
          original_name?: string | null;
          owner_id?: string | null;
          source?: string;
          updated_at?: string;
          year_published?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "games_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      library_items: {
        Row: {
          created_at: string;
          game_id: string;
          id: string;
          is_favorite: boolean;
          notes: string | null;
          rating: number | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          game_id: string;
          id?: string;
          is_favorite?: boolean;
          notes?: string | null;
          rating?: number | null;
          status: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          game_id?: string;
          id?: string;
          is_favorite?: boolean;
          notes?: string | null;
          rating?: number | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "library_items_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "library_items_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      play_expansions: {
        Row: {
          game_id: string;
          play_id: string;
        };
        Insert: {
          game_id: string;
          play_id: string;
        };
        Update: {
          game_id?: string;
          play_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "play_expansions_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "play_expansions_play_id_fkey";
            columns: ["play_id"];
            isOneToOne: false;
            referencedRelation: "plays";
            referencedColumns: ["id"];
          },
        ];
      };
      play_participants: {
        Row: {
          id: string;
          is_winner: boolean;
          play_id: string;
          player_id: string;
          rank: number | null;
          seat: number;
          total_score: number | null;
        };
        Insert: {
          id?: string;
          is_winner?: boolean;
          play_id: string;
          player_id: string;
          rank?: number | null;
          seat: number;
          total_score?: number | null;
        };
        Update: {
          id?: string;
          is_winner?: boolean;
          play_id?: string;
          player_id?: string;
          rank?: number | null;
          seat?: number;
          total_score?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "play_participants_play_id_fkey";
            columns: ["play_id"];
            isOneToOne: false;
            referencedRelation: "plays";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "play_participants_player_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      play_scores: {
        Row: {
          category_key: string;
          participant_id: string;
          value: Json;
        };
        Insert: {
          category_key: string;
          participant_id: string;
          value: Json;
        };
        Update: {
          category_key?: string;
          participant_id?: string;
          value?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "play_scores_participant_id_fkey";
            columns: ["participant_id"];
            isOneToOne: false;
            referencedRelation: "play_participants";
            referencedColumns: ["id"];
          },
        ];
      };
      players: {
        Row: {
          created_at: string;
          id: string;
          linked_user_id: string | null;
          name: string;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          linked_user_id?: string | null;
          name: string;
          owner_id?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          linked_user_id?: string | null;
          name?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "players_linked_user_id_fkey";
            columns: ["linked_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "players_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      plays: {
        Row: {
          created_at: string;
          created_by: string;
          duration_minutes: number | null;
          game_id: string;
          id: string;
          notes: string | null;
          played_on: string;
          scoring_version_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string;
          duration_minutes?: number | null;
          game_id: string;
          id?: string;
          notes?: string | null;
          played_on?: string;
          scoring_version_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          duration_minutes?: number | null;
          game_id?: string;
          id?: string;
          notes?: string | null;
          played_on?: string;
          scoring_version_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plays_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plays_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plays_scoring_version_id_fkey";
            columns: ["scoring_version_id"];
            isOneToOne: false;
            referencedRelation: "scoring_sheet_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_path: string | null;
          created_at: string;
          display_name: string;
          id: string;
          is_public: boolean;
          locale: string;
          theme: string;
          updated_at: string;
        };
        Insert: {
          avatar_path?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          is_public?: boolean;
          locale?: string;
          theme?: string;
          updated_at?: string;
        };
        Update: {
          avatar_path?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          is_public?: boolean;
          locale?: string;
          theme?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      rules_content: {
        Row: {
          body: string;
          game_id: string;
          locale: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          body: string;
          game_id: string;
          locale: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          body?: string;
          game_id?: string;
          locale?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "rules_content_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rules_content_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      scoring_sheet_versions: {
        Row: {
          created_at: string;
          definition: Json;
          id: string;
          sheet_id: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          definition: Json;
          id?: string;
          sheet_id: string;
          version: number;
        };
        Update: {
          created_at?: string;
          definition?: Json;
          id?: string;
          sheet_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "scoring_sheet_versions_sheet_id_fkey";
            columns: ["sheet_id"];
            isOneToOne: false;
            referencedRelation: "scoring_sheets";
            referencedColumns: ["id"];
          },
        ];
      };
      scoring_sheets: {
        Row: {
          copied_from: string | null;
          created_at: string;
          disabled_at: string | null;
          disabled_by: string | null;
          game_id: string;
          id: string;
          locale: string;
          owner_id: string | null;
          published_at: string | null;
          title: string;
          updated_at: string;
          verified_at: string | null;
          verified_by: string | null;
          visibility: string;
        };
        Insert: {
          copied_from?: string | null;
          created_at?: string;
          disabled_at?: string | null;
          disabled_by?: string | null;
          game_id: string;
          id?: string;
          locale: string;
          owner_id?: string | null;
          published_at?: string | null;
          title: string;
          updated_at?: string;
          verified_at?: string | null;
          verified_by?: string | null;
          visibility?: string;
        };
        Update: {
          copied_from?: string | null;
          created_at?: string;
          disabled_at?: string | null;
          disabled_by?: string | null;
          game_id?: string;
          id?: string;
          locale?: string;
          owner_id?: string | null;
          published_at?: string | null;
          title?: string;
          updated_at?: string;
          verified_at?: string | null;
          verified_by?: string | null;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scoring_sheets_copied_from_fkey";
            columns: ["copied_from"];
            isOneToOne: false;
            referencedRelation: "scoring_sheets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scoring_sheets_disabled_by_fkey";
            columns: ["disabled_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scoring_sheets_game_id_fkey";
            columns: ["game_id"];
            isOneToOne: false;
            referencedRelation: "games";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scoring_sheets_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scoring_sheets_verified_by_fkey";
            columns: ["verified_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      scoring_votes: {
        Row: {
          created_at: string;
          id: string;
          kind: string;
          play_id: string | null;
          reason: string | null;
          updated_at: string;
          user_id: string;
          version_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind: string;
          play_id?: string | null;
          reason?: string | null;
          updated_at?: string;
          user_id?: string;
          version_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: string;
          play_id?: string | null;
          reason?: string | null;
          updated_at?: string;
          user_id?: string;
          version_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scoring_votes_play_id_fkey";
            columns: ["play_id"];
            isOneToOne: false;
            referencedRelation: "plays";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scoring_votes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scoring_votes_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "scoring_sheet_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      term_translations: {
        Row: {
          locale: string;
          name: string;
          term_id: string;
        };
        Insert: {
          locale: string;
          name: string;
          term_id: string;
        };
        Update: {
          locale?: string;
          name?: string;
          term_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "term_translations_term_id_fkey";
            columns: ["term_id"];
            isOneToOne: false;
            referencedRelation: "terms";
            referencedColumns: ["id"];
          },
        ];
      };
      terms: {
        Row: {
          external_id: string;
          id: string;
          name: string;
          source: string;
          type: string;
        };
        Insert: {
          external_id: string;
          id?: string;
          name: string;
          source: string;
          type: string;
        };
        Update: {
          external_id?: string;
          id?: string;
          name?: string;
          source?: string;
          type?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          role: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          role: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_set_sheet_disabled: {
        Args: { p_disabled: boolean; p_sheet: string };
        Returns: undefined;
      };
      admin_set_sheet_verified: {
        Args: { p_sheet: string; p_verified: boolean };
        Returns: undefined;
      };
      admin_sheet_flags: {
        Args: { p_sheet: string };
        Returns: {
          created_at: string;
          reason: string;
          version: number;
        }[];
      };
      current_user_id: { Args: never; Returns: string };
      f_unaccent: { Args: { "": string }; Returns: string };
      game_score_series: {
        Args: { p_game_id: string; p_limit?: number };
        Returns: {
          name: string;
          play_id: string;
          played_on: string;
          player_id: string;
          seq: number;
          total: number;
        }[];
      };
      game_stats: {
        Args: { p_game_id: string };
        Returns: {
          avg_score: number;
          best_score: number;
          name: string;
          player_id: string;
          plays: number;
          scored_plays: number;
          wins: number;
        }[];
      };
      game_summary: {
        Args: { p_game_id: string };
        Returns: {
          avg_duration_minutes: number;
          first_played_on: string;
          last_played_on: string;
          plays: number;
        }[];
      };
      head_to_head: {
        Args: never;
        Returns: {
          my_wins: number;
          name: string;
          player_id: string;
          plays_together: number;
          their_wins: number;
          ties: number;
        }[];
      };
      hex_to_hash: { Args: { p_hex: string }; Returns: number };
      i_use_sheet: { Args: { p_sheet: string }; Returns: boolean };
      is_admin: { Args: never; Returns: boolean };
      match_game_images: {
        Args: { p_hash: string; p_limit?: number; p_max_distance?: number };
        Returns: {
          distance: number;
          game_id: string;
        }[];
      };
      merge_players: {
        Args: { p_keep: string; p_remove: string };
        Returns: undefined;
      };
      my_overview: {
        Args: never;
        Returns: {
          games_played: number;
          me_player_id: string;
          plays: number;
          scored_plays: number;
          wins: number;
        }[];
      };
      my_top_games: {
        Args: { p_limit?: number };
        Returns: {
          game_id: string;
          name: string;
          plays: number;
          wins: number;
        }[];
      };
      normalize_player_name: { Args: { p: string }; Returns: string };
      save_photo_hash: {
        Args: { p_game_id: string; p_hash: string };
        Returns: undefined;
      };
      save_play: { Args: { p: Json }; Returns: string };
      search_games: {
        Args: {
          p_kind?: string;
          p_limit?: number;
          p_max_minutes?: number;
          p_players?: number;
          q?: string;
        };
        Returns: {
          cover_url: string | null;
          created_at: string;
          fetched_at: string | null;
          id: string;
          kind: string;
          max_players: number | null;
          max_playtime: number | null;
          min_age: number | null;
          min_players: number | null;
          min_playtime: number | null;
          name: string;
          original_language: string;
          original_name: string | null;
          owner_id: string | null;
          source: string;
          updated_at: string;
          year_published: number | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "games";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      search_library: {
        Args: {
          p_favorites?: boolean;
          p_limit?: number;
          p_status?: string;
          q?: string;
        };
        Returns: {
          cover_url: string;
          game_id: string;
          is_favorite: boolean;
          item_id: string;
          kind: string;
          max_players: number;
          max_playtime: number;
          min_players: number;
          min_playtime: number;
          name: string;
          rating: number;
          source: string;
          status: string;
          year_published: number;
        }[];
      };
      sheet_rankings: {
        Args: { p_game_id: string };
        Returns: {
          disabled: boolean;
          flag_votes: number;
          is_mine: boolean;
          locale: string;
          score: number;
          sheet_id: string;
          title: string;
          up_votes: number;
          uses: number;
          verified: boolean;
          version: number;
          version_id: string;
          visibility: string;
        }[];
      };
      upsert_cover_hash: {
        Args: { p_game_id: string; p_hash: string };
        Returns: undefined;
      };
      upsert_external_game: { Args: { p: Json }; Returns: string };
      version_is_usable: { Args: { p_version: string }; Returns: boolean };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
