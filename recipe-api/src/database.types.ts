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
      api_keys: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          key_hash: string
          last_used_at: string | null
          owner_email: string | null
          owner_name: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash: string
          last_used_at?: string | null
          owner_email?: string | null
          owner_name: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string
          last_used_at?: string | null
          owner_email?: string | null
          owner_name?: string
        }
        Relationships: []
      }
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
      off_products: {
        Row: {
          additives_tags: string[] | null
          allergens_tags: string[] | null
          brands: string | null
          calcium_100g: number | null
          calories_100g: number | null
          carbs_100g: number | null
          categories_tags: string[] | null
          code: string
          ecoscore_grade: string | null
          fat_100g: number | null
          fiber_100g: number | null
          fts: unknown
          image_url: string | null
          ingredients_text: string | null
          iron_100g: number | null
          labels_tags: string[] | null
          last_modified_t: number | null
          nova_group: number | null
          nutriscore_grade: string | null
          product_name: string | null
          protein_100g: number | null
          quantity: string | null
          sodium_100g: number | null
          sugar_100g: number | null
          synced_at: string | null
          traces_tags: string[] | null
          vitamin_c_100g: number | null
        }
        Insert: {
          additives_tags?: string[] | null
          allergens_tags?: string[] | null
          brands?: string | null
          calcium_100g?: number | null
          calories_100g?: number | null
          carbs_100g?: number | null
          categories_tags?: string[] | null
          code: string
          ecoscore_grade?: string | null
          fat_100g?: number | null
          fiber_100g?: number | null
          fts?: unknown
          image_url?: string | null
          ingredients_text?: string | null
          iron_100g?: number | null
          labels_tags?: string[] | null
          last_modified_t?: number | null
          nova_group?: number | null
          nutriscore_grade?: string | null
          product_name?: string | null
          protein_100g?: number | null
          quantity?: string | null
          sodium_100g?: number | null
          sugar_100g?: number | null
          synced_at?: string | null
          traces_tags?: string[] | null
          vitamin_c_100g?: number | null
        }
        Update: {
          additives_tags?: string[] | null
          allergens_tags?: string[] | null
          brands?: string | null
          calcium_100g?: number | null
          calories_100g?: number | null
          carbs_100g?: number | null
          categories_tags?: string[] | null
          code?: string
          ecoscore_grade?: string | null
          fat_100g?: number | null
          fiber_100g?: number | null
          fts?: unknown
          image_url?: string | null
          ingredients_text?: string | null
          iron_100g?: number | null
          labels_tags?: string[] | null
          last_modified_t?: number | null
          nova_group?: number | null
          nutriscore_grade?: string | null
          product_name?: string | null
          protein_100g?: number | null
          quantity?: string | null
          sodium_100g?: number | null
          sugar_100g?: number | null
          synced_at?: string | null
          traces_tags?: string[] | null
          vitamin_c_100g?: number | null
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
      recipe_stats: {
        Row: {
          avg_quality_score: number | null
          computed_at: string | null
          flagged: number | null
          pending: number | null
          quarantined: number | null
          rejected: number | null
          total: number | null
          verified: number | null
        }
        Relationships: []
      }
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
      next_crawl_job: {
        Args: never
        Returns: {
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
        }[]
        SetofOptions: {
          from: "*"
          to: "crawl_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      refresh_materialized_view_stats: { Args: never; Returns: undefined }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
