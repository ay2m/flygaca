/**
 * Supabase Database TypeScript definitions for Fly GACA.
 * Mirrors the PostgreSQL public schema.
 */

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          email_verified: boolean;
          password_hash: string | null;
          display_name: string;
          google_sub: string | null;
          apple_sub: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          email_verified?: boolean;
          password_hash?: string | null;
          display_name?: string;
          google_sub?: string | null;
          apple_sub?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          email_verified?: boolean;
          password_hash?: string | null;
          display_name?: string;
          google_sub?: string | null;
          apple_sub?: string | null;
          updated_at?: string;
        };
      };
      profiles: {
        Row: {
          user_id: string;
          home_base: string;
          licence_type: string;
          medical_expiry: string;
          last_flight_review: string;
          role: string;
          avatar_url?: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          home_base?: string;
          licence_type?: string;
          medical_expiry?: string;
          last_flight_review?: string;
          role?: string;
          avatar_url?: string;
          updated_at?: string;
        };
        Update: {
          home_base?: string;
          licence_type?: string;
          medical_expiry?: string;
          last_flight_review?: string;
          role?: string;
          avatar_url?: string;
          updated_at?: string;
        };
      };
      flights: {
        Row: {
          id: string;
          user_id: string;
          date: string;
          type: string;
          reg: string;
          from_icao: string;
          to_icao: string;
          total_minutes: number;
          pic_minutes: number;
          night_minutes: number;
          ifr_minutes: number;
          landings_day: number;
          landings_night: number;
          approaches: number;
          remarks: string;
          created_at: string;
          updated_at: string;
        };
      };
      pilot_records: {
        Row: {
          id: string;
          user_id: string;
          category: string;
          title: string;
          ref: string;
          issued_date: string | null;
          expires_date: string | null;
          remarks: string;
          created_at: string;
          updated_at: string;
        };
      };
      entitlements: {
        Row: {
          user_id: string;
          plan: 'free' | 'pro' | 'school';
          valid_until: string | null;
          source: string;
          created_at: string;
          updated_at: string;
        };
      };
      chat_credits: {
        Row: {
          user_id: string;
          credits: number;
          updated_at: string;
        };
      };
      account_security: {
        Row: {
          user_id: string;
          locked_until: string | null;
          last_login_at: string | null;
          suspicious: boolean;
          breach_notified_at: string | null;
          updated_at: string;
        };
      };
    };
  };
}
