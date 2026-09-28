export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.5" };
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          username: string;
          password_hash: string;
          role: "teacher" | "member";
          name: string;
          must_change_password: boolean;
          failed_login_count: number;
          locked_until: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          username: string;
          password_hash: string;
          role: "teacher" | "member";
          name: string;
          must_change_password?: boolean;
          failed_login_count?: number;
          locked_until?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          password_hash?: string;
          role?: "teacher" | "member";
          name?: string;
          must_change_password?: boolean;
          failed_login_count?: number;
          locked_until?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      record_login_failure: {
        Args: { p_user_id: string };
        Returns: { failed_login_count: number; locked_until: string | null }[];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (Database["public"]["Tables"] & Database["public"]["Views"])
    | { schema: keyof Omit<Database, "__InternalSupabase"> },
  TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof Omit<Database, "__InternalSupabase"> }
    ? keyof (Omit<Database, "__InternalSupabase">[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Omit<Database, "__InternalSupabase">[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Omit<Database, "__InternalSupabase"> }
  ? (Omit<Database, "__InternalSupabase">[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Omit<Database, "__InternalSupabase">[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer Row;
    }
    ? Row
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (Database["public"]["Tables"] & Database["public"]["Views"])
    ? (Database["public"]["Tables"] & Database["public"]["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer Row;
      }
      ? Row
      : never
    : never;

export type TablesInsert<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Insert"];

export type TablesUpdate<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Update"];
