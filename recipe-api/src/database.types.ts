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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      crawl_jobs: {
        Row: {
          created_at: string
          id: string
          is_archived: boolean
          log: string | null
          next_retry_at: string | null
          recipes_found: number
          retry_count: number
          status: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          log?: string | null
          next_retry_at?: string | null
          recipes_found?: number
          retry_count?: number
          status?: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          log?: string | null
          next_retry_at?: string | null
          recipes_found?: number
          retry_count?: number
          status?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      ingredient_cache: {
        Row: {
          created_at: string
          nutrition: Json
          remote_id: string | null
          source: string
          term: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          nutrition: Json
          remote_id?: string | null
          source?: string
          term: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          nutrition?: Json
          remote_id?: string | null
          source?: string
          term?: string
          updated_at?: string
        }
        Relationships: []
      }
      recipes: {
        Row: {
          audit_log: Json | null
          cook_time: string | null
          created_at: string
          description: string | null
          fts: unknown
          id: string
          image: string | null
          ingredients_flat: string[] | null
          last_audited_at: string | null
          name: string
          nutrition: Json | null
          prep_time: string | null
          qa_status: string
          quality_score: number | null
          recipe_category: string | null
          recipe_cuisine: string | null
          recipe_ingredients: Json | null
          recipe_instructions: Json | null
          recipe_yield: string | null
          total_time: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          audit_log?: Json | null
          cook_time?: string | null
          created_at?: string
          description?: string | null
          fts?: unknown
          id?: string
          image?: string | null
          ingredients_flat?: string[] | null
          last_audited_at?: string | null
          name: string
          nutrition?: Json | null
          prep_time?: string | null
          qa_status?: string
          quality_score?: number | null
          recipe_category?: string | null
          recipe_cuisine?: string | null
          recipe_ingredients?: Json | null
          recipe_instructions?: Json | null
          recipe_yield?: string | null
          total_time?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          audit_log?: Json | null
          cook_time?: string | null
          created_at?: string
          description?: string | null
          fts?: unknown
          id?: string
          image?: string | null
          ingredients_flat?: string[] | null
          last_audited_at?: string | null
          name?: string
          nutrition?: Json | null
          prep_time?: string | null
          qa_status?: string
          quality_score?: number | null
          recipe_category?: string | null
          recipe_cuisine?: string | null
          recipe_ingredients?: Json | null
          recipe_instructions?: Json | null
          recipe_yield?: string | null
          total_time?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_recipe_quality: {
        Args: { r: Database["public"]["Tables"]["recipes"]["Row"] }
        Returns: number
      }
      fn_ingredients_to_array: {
        Args: { ingredients: Json }
        Returns: string[]
      }
      search_recipes: {
        Args: { search_query: string }
        Returns: {
          audit_log: Json | null
          cook_time: string | null
          created_at: string
          description: string | null
          fts: unknown
          id: string
          image: string | null
          ingredients_flat: string[] | null
          last_audited_at: string | null
          name: string
          nutrition: Json | null
          prep_time: string | null
          qa_status: string
          quality_score: number | null
          recipe_category: string | null
          recipe_cuisine: string | null
          recipe_ingredients: Json | null
          recipe_instructions: Json | null
          recipe_yield: string | null
          total_time: string | null
          updated_at: string
          url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "recipes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_recipes_hybrid: {
        Args: {
          filter_ingredients?: string[]
          match_all_ingredients?: boolean
          search_term: string
        }
        Returns: {
          cook_time: string
          created_at: string
          description: string
          id: string
          image: string
          name: string
          nutrition: Json
          prep_time: string
          rank_score: number
          recipe_category: string
          recipe_cuisine: string
          recipe_ingredients: Json
          recipe_instructions: Json
          total_time: string
          updated_at: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      update_recipe_nutritions: { Args: { payload: Json }; Returns: undefined }
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
    Enums: {},
  },
} as const
