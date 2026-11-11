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
    PostgrestVersion: "14.5"
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
      academy_attempts: {
        Row: {
          account_id: string
          answers: Json
          by_user: string | null
          correct: number
          created_at: string
          id: string
          kind: string
          learner_id: string
          level_id: string
          passed: boolean
          score: number
          total: number
        }
        Insert: {
          account_id: string
          answers?: Json
          by_user?: string | null
          correct: number
          created_at?: string
          id?: string
          kind: string
          learner_id: string
          level_id: string
          passed: boolean
          score: number
          total: number
        }
        Update: {
          account_id?: string
          answers?: Json
          by_user?: string | null
          correct?: number
          created_at?: string
          id?: string
          kind?: string
          learner_id?: string
          level_id?: string
          passed?: boolean
          score?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "academy_attempts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_attempts_by_user_fkey"
            columns: ["by_user"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_attempts_learner_id_fkey"
            columns: ["learner_id"]
            isOneToOne: false
            referencedRelation: "academy_learners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_attempts_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "academy_levels"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_courses: {
        Row: {
          account_id: string
          active: boolean
          blurb: string | null
          created_at: string
          draft: boolean
          id: string
          level_id: string
          note: string | null
          sort: number
          title: string
          updated_at: string
        }
        Insert: {
          account_id: string
          active?: boolean
          blurb?: string | null
          created_at?: string
          draft?: boolean
          id?: string
          level_id: string
          note?: string | null
          sort?: number
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          active?: boolean
          blurb?: string | null
          created_at?: string
          draft?: boolean
          id?: string
          level_id?: string
          note?: string | null
          sort?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_courses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_courses_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "academy_levels"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_learners: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          employee_id: string | null
          id: string
          last_active_at: string | null
          level_key: string | null
          location_id: string | null
          name: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          employee_id?: string | null
          id?: string
          last_active_at?: string | null
          level_key?: string | null
          location_id?: string | null
          name: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string | null
          id?: string
          last_active_at?: string | null
          level_key?: string | null
          location_id?: string | null
          name?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "academy_learners_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_learners_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_learners_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_learners_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_learners_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_lesson_progress: {
        Row: {
          account_id: string
          by_user: string | null
          data: Json
          done_at: string | null
          learner_id: string
          lesson_id: string
          score: number | null
          updated_at: string
        }
        Insert: {
          account_id: string
          by_user?: string | null
          data?: Json
          done_at?: string | null
          learner_id: string
          lesson_id: string
          score?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          by_user?: string | null
          data?: Json
          done_at?: string | null
          learner_id?: string
          lesson_id?: string
          score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_lesson_progress_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_lesson_progress_by_user_fkey"
            columns: ["by_user"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_lesson_progress_learner_id_fkey"
            columns: ["learner_id"]
            isOneToOne: false
            referencedRelation: "academy_learners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_lesson_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "academy_lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_lessons: {
        Row: {
          account_id: string
          active: boolean
          body: string
          checks: string[]
          course_id: string
          created_at: string
          id: string
          key: string
          kind: string
          level_id: string
          minutes: number
          sort: number
          title: string
          updated_at: string
          updated_by: string | null
          why: string | null
        }
        Insert: {
          account_id: string
          active?: boolean
          body?: string
          checks?: string[]
          course_id: string
          created_at?: string
          id?: string
          key: string
          kind?: string
          level_id: string
          minutes?: number
          sort?: number
          title: string
          updated_at?: string
          updated_by?: string | null
          why?: string | null
        }
        Update: {
          account_id?: string
          active?: boolean
          body?: string
          checks?: string[]
          course_id?: string
          created_at?: string
          id?: string
          key?: string
          kind?: string
          level_id?: string
          minutes?: number
          sort?: number
          title?: string
          updated_at?: string
          updated_by?: string | null
          why?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "academy_lessons_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_lessons_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "academy_courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_lessons_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "academy_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_lessons_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_levels: {
        Row: {
          account_id: string
          ack_formal: boolean
          ack_statement: string
          ack_title: string | null
          active: boolean
          blurb: string | null
          created_at: string
          draft: boolean
          id: string
          key: string
          num: number
          pass_pct: number
          role_text: string | null
          short_title: string
          skills: string[]
          title: string
          track_id: string
          updated_at: string
          updated_by: string | null
          why: string | null
        }
        Insert: {
          account_id: string
          ack_formal?: boolean
          ack_statement?: string
          ack_title?: string | null
          active?: boolean
          blurb?: string | null
          created_at?: string
          draft?: boolean
          id?: string
          key: string
          num?: number
          pass_pct?: number
          role_text?: string | null
          short_title: string
          skills?: string[]
          title: string
          track_id: string
          updated_at?: string
          updated_by?: string | null
          why?: string | null
        }
        Update: {
          account_id?: string
          ack_formal?: boolean
          ack_statement?: string
          ack_title?: string | null
          active?: boolean
          blurb?: string | null
          created_at?: string
          draft?: boolean
          id?: string
          key?: string
          num?: number
          pass_pct?: number
          role_text?: string | null
          short_title?: string
          skills?: string[]
          title?: string
          track_id?: string
          updated_at?: string
          updated_by?: string | null
          why?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "academy_levels_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_levels_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "academy_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_levels_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_prereqs: {
        Row: {
          account_id: string
          level_id: string
          requires_id: string
        }
        Insert: {
          account_id: string
          level_id: string
          requires_id: string
        }
        Update: {
          account_id?: string
          level_id?: string
          requires_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_prereqs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_prereqs_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "academy_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_prereqs_requires_id_fkey"
            columns: ["requires_id"]
            isOneToOne: false
            referencedRelation: "academy_levels"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_programs: {
        Row: {
          account_id: string
          draft_note: string | null
          eyebrow: string | null
          headline: string | null
          intro: string | null
          title: string
          updated_at: string
          updated_by: string | null
          why_assessment: string | null
          why_program: string | null
          why_scenarios: string | null
          why_signoff: string | null
        }
        Insert: {
          account_id: string
          draft_note?: string | null
          eyebrow?: string | null
          headline?: string | null
          intro?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          why_assessment?: string | null
          why_program?: string | null
          why_scenarios?: string | null
          why_signoff?: string | null
        }
        Update: {
          account_id?: string
          draft_note?: string | null
          eyebrow?: string | null
          headline?: string | null
          intro?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          why_assessment?: string | null
          why_program?: string | null
          why_scenarios?: string | null
          why_signoff?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "academy_programs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_programs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_questions: {
        Row: {
          account_id: string
          answer: number
          created_at: string
          id: string
          kind: string
          lesson_id: string | null
          level_id: string
          options: string[]
          prompt: string
          sort: number
          title: string | null
          updated_at: string
          why: string | null
        }
        Insert: {
          account_id: string
          answer: number
          created_at?: string
          id?: string
          kind: string
          lesson_id?: string | null
          level_id: string
          options: string[]
          prompt: string
          sort?: number
          title?: string | null
          updated_at?: string
          why?: string | null
        }
        Update: {
          account_id?: string
          answer?: number
          created_at?: string
          id?: string
          kind?: string
          lesson_id?: string | null
          level_id?: string
          options?: string[]
          prompt?: string
          sort?: number
          title?: string | null
          updated_at?: string
          why?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "academy_questions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_questions_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "academy_lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_questions_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "academy_levels"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_signoffs: {
        Row: {
          account_id: string
          id: string
          leader_name: string | null
          learner_id: string
          level_id: string
          location_id: string | null
          signed_at: string
          signed_by: string | null
          signed_on: string
          signer_name: string
          site_label: string | null
          statement: string
          verified_at: string | null
          verified_by: string | null
          verified_name: string | null
        }
        Insert: {
          account_id: string
          id?: string
          leader_name?: string | null
          learner_id: string
          level_id: string
          location_id?: string | null
          signed_at?: string
          signed_by?: string | null
          signed_on: string
          signer_name: string
          site_label?: string | null
          statement: string
          verified_at?: string | null
          verified_by?: string | null
          verified_name?: string | null
        }
        Update: {
          account_id?: string
          id?: string
          leader_name?: string | null
          learner_id?: string
          level_id?: string
          location_id?: string | null
          signed_at?: string
          signed_by?: string | null
          signed_on?: string
          signer_name?: string
          site_label?: string | null
          statement?: string
          verified_at?: string | null
          verified_by?: string | null
          verified_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "academy_signoffs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_signoffs_learner_id_fkey"
            columns: ["learner_id"]
            isOneToOne: false
            referencedRelation: "academy_learners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_signoffs_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "academy_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_signoffs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_signoffs_signed_by_fkey"
            columns: ["signed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_signoffs_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_skill_checks: {
        Row: {
          account_id: string
          checked_at: string
          checked_by: string | null
          checked_name: string | null
          learner_id: string
          level_id: string
          skill: string
        }
        Insert: {
          account_id: string
          checked_at?: string
          checked_by?: string | null
          checked_name?: string | null
          learner_id: string
          level_id: string
          skill: string
        }
        Update: {
          account_id?: string
          checked_at?: string
          checked_by?: string | null
          checked_name?: string | null
          learner_id?: string
          level_id?: string
          skill?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_skill_checks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_skill_checks_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_skill_checks_learner_id_fkey"
            columns: ["learner_id"]
            isOneToOne: false
            referencedRelation: "academy_learners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_skill_checks_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "academy_levels"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_tracks: {
        Row: {
          account_id: string
          active: boolean
          code_prefix: string
          created_at: string
          eyebrow: string | null
          headline: string | null
          id: string
          intro: string | null
          key: string
          sort: number
          title: string
          unit_label: string
          updated_at: string
          updated_by: string | null
          why: string | null
        }
        Insert: {
          account_id: string
          active?: boolean
          code_prefix?: string
          created_at?: string
          eyebrow?: string | null
          headline?: string | null
          id?: string
          intro?: string | null
          key: string
          sort?: number
          title: string
          unit_label?: string
          updated_at?: string
          updated_by?: string | null
          why?: string | null
        }
        Update: {
          account_id?: string
          active?: boolean
          code_prefix?: string
          created_at?: string
          eyebrow?: string | null
          headline?: string | null
          id?: string
          intro?: string | null
          key?: string
          sort?: number
          title?: string
          unit_label?: string
          updated_at?: string
          updated_by?: string | null
          why?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "academy_tracks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_tracks_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          account_type: string
          billing_status: string
          brand_logo_url: string | null
          company_settings: Json
          created_at: string
          gm_bonus_enabled: boolean
          id: string
          invoice_inbox_token: string
          is_demo: boolean
          name: string
          plan: string | null
          site_performance_enabled: boolean
          site_plan: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_quantity: number
          trial_ends_at: string
        }
        Insert: {
          account_type?: string
          billing_status?: string
          brand_logo_url?: string | null
          company_settings?: Json
          created_at?: string
          gm_bonus_enabled?: boolean
          id?: string
          invoice_inbox_token: string
          is_demo?: boolean
          name: string
          plan?: string | null
          site_performance_enabled?: boolean
          site_plan?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_quantity?: number
          trial_ends_at?: string
        }
        Update: {
          account_type?: string
          billing_status?: string
          brand_logo_url?: string | null
          company_settings?: Json
          created_at?: string
          gm_bonus_enabled?: boolean
          id?: string
          invoice_inbox_token?: string
          is_demo?: boolean
          name?: string
          plan?: string | null
          site_performance_enabled?: boolean
          site_plan?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_quantity?: number
          trial_ends_at?: string
        }
        Relationships: []
      }
      ai_insights: {
        Row: {
          account_id: string
          acknowledged: boolean
          acknowledged_at: string | null
          acknowledged_by: string | null
          archived: boolean
          category: string
          generated_at: string
          id: string
          insight_text: string
          location_id: string | null
          severity: string
        }
        Insert: {
          account_id: string
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          archived?: boolean
          category: string
          generated_at?: string
          id?: string
          insight_text: string
          location_id?: string | null
          severity?: string
        }
        Update: {
          account_id?: string
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          archived?: boolean
          category?: string
          generated_at?: string
          id?: string
          insight_text?: string
          location_id?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_insights_refresh_log: {
        Row: {
          account_id: string
          created_at: string
          id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_refresh_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_photos: {
        Row: {
          asset_id: string
          caption: string | null
          created_at: string
          id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          asset_id: string
          caption?: string | null
          created_at?: string
          id?: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          asset_id?: string
          caption?: string | null
          created_at?: string
          id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_photos_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          diff: Json | null
          id: string
          row_id: string
          table_name: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          diff?: Json | null
          id?: string
          row_id: string
          table_name: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          diff?: Json | null
          id?: string
          row_id?: string
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      badges: {
        Row: {
          account_id: string
          active: boolean
          created_at: string
          created_by: string | null
          description: string | null
          emoji: string | null
          id: string
          name: string
          tone: string
        }
        Insert: {
          account_id: string
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          emoji?: string | null
          id?: string
          name: string
          tone?: string
        }
        Update: {
          account_id?: string
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          emoji?: string | null
          id?: string
          name?: string
          tone?: string
        }
        Relationships: [
          {
            foreignKeyName: "badges_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      biometric_consents: {
        Row: {
          account_id: string
          consented_at: string
          created_at: string
          employee_id: string
          full_name: string | null
          id: string
          location_id: string | null
          method: string
          policy_version: string | null
          revoked_at: string | null
          revoked_by: string | null
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          account_id: string
          consented_at?: string
          created_at?: string
          employee_id: string
          full_name?: string | null
          id?: string
          location_id?: string | null
          method?: string
          policy_version?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          account_id?: string
          consented_at?: string
          created_at?: string
          employee_id?: string
          full_name?: string | null
          id?: string
          location_id?: string | null
          method?: string
          policy_version?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "biometric_consents_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "biometric_consents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "biometric_consents_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "biometric_consents_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      breaks: {
        Row: {
          created_at: string
          created_by: string | null
          employee_id: string
          ended_at: string | null
          id: string
          location_id: string
          notes: string | null
          scheduled_end: string
          scheduled_start: string
          started_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_id: string
          ended_at?: string | null
          id?: string
          location_id: string
          notes?: string | null
          scheduled_end: string
          scheduled_start: string
          started_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_id?: string
          ended_at?: string | null
          id?: string
          location_id?: string
          notes?: string | null
          scheduled_end?: string
          scheduled_start?: string
          started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "breaks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breaks_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breaks_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          all_day: boolean
          created_at: string
          created_by: string | null
          description: string | null
          end_at: string | null
          id: string
          location_id: string
          start_at: string
          title: string
        }
        Insert: {
          all_day?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_at?: string | null
          id?: string
          location_id: string
          start_at: string
          title: string
        }
        Update: {
          all_day?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_at?: string | null
          id?: string
          location_id?: string
          start_at?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      capital_requests: {
        Row: {
          account_id: string
          category: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_by_name: string | null
          decision_reason: string | null
          description: string | null
          estimated_cost: number | null
          id: string
          location_id: string | null
          priority: string
          requested_by: string | null
          requested_by_name: string | null
          status: string
          title: string
        }
        Insert: {
          account_id: string
          category?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          decision_reason?: string | null
          description?: string | null
          estimated_cost?: number | null
          id?: string
          location_id?: string | null
          priority?: string
          requested_by?: string | null
          requested_by_name?: string | null
          status?: string
          title: string
        }
        Update: {
          account_id?: string
          category?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          decision_reason?: string | null
          description?: string | null
          estimated_cost?: number | null
          id?: string
          location_id?: string | null
          priority?: string
          requested_by?: string | null
          requested_by_name?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "capital_requests_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capital_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capital_requests_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capital_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      certifications: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          document_url: string | null
          employee_id: string
          expires_on: string | null
          id: string
          issued_on: string | null
          issuer: string | null
          location_id: string | null
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          document_url?: string | null
          employee_id: string
          expires_on?: string | null
          id?: string
          issued_on?: string | null
          issuer?: string | null
          location_id?: string | null
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          document_url?: string | null
          employee_id?: string
          expires_on?: string | null
          id?: string
          issued_on?: string | null
          issuer?: string | null
          location_id?: string | null
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "certifications_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certifications_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certifications_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_completions: {
        Row: {
          checklist_id: string
          completed_at: string
          completed_by: string | null
          id: string
          location_id: string
          notes: string | null
        }
        Insert: {
          checklist_id: string
          completed_at?: string
          completed_by?: string | null
          id?: string
          location_id: string
          notes?: string | null
        }
        Update: {
          checklist_id?: string
          completed_at?: string
          completed_by?: string | null
          id?: string
          location_id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_completions_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_completions_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_completions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_instances: {
        Row: {
          checklist_id: string
          closes_at: string | null
          created_at: string
          id: string
          instance_date: string
          location_id: string
          opens_at: string
          status: string
        }
        Insert: {
          checklist_id: string
          closes_at?: string | null
          created_at?: string
          id?: string
          instance_date: string
          location_id: string
          opens_at: string
          status?: string
        }
        Update: {
          checklist_id?: string
          closes_at?: string | null
          created_at?: string
          id?: string
          instance_date?: string
          location_id?: string
          opens_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_instances_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_instances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_item_baselines: {
        Row: {
          created_at: string
          created_by: string | null
          data_uri: string
          id: string
          item_id: string
          location_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data_uri: string
          id?: string
          item_id: string
          location_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data_uri?: string
          id?: string
          item_id?: string
          location_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_item_baselines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_item_baselines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_item_baselines_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_item_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          id: string
          instance_id: string
          item_id: string
          note: string | null
          occurred_at: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          id?: string
          instance_id: string
          item_id: string
          note?: string | null
          occurred_at?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          id?: string
          instance_id?: string
          item_id?: string
          note?: string | null
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_item_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_item_events_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "checklist_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_item_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          asset_id: string | null
          checklist_id: string
          id: string
          label: string
          order_index: number
          requires_photo: boolean
        }
        Insert: {
          asset_id?: string | null
          checklist_id: string
          id?: string
          label: string
          order_index?: number
          requires_photo?: boolean
        }
        Update: {
          asset_id?: string | null
          checklist_id?: string
          id?: string
          label?: string
          order_index?: number
          requires_photo?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_items_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_locations: {
        Row: {
          checklist_id: string
          created_at: string
          location_id: string
        }
        Insert: {
          checklist_id: string
          created_at?: string
          location_id: string
        }
        Update: {
          checklist_id?: string
          created_at?: string
          location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_locations_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_submissions: {
        Row: {
          ai_model: string | null
          ai_notes: string | null
          ai_status: string
          created_at: string
          data_uri: string
          id: string
          instance_id: string
          item_id: string
          location_id: string
          submitted_by: string | null
          submitted_by_name: string | null
        }
        Insert: {
          ai_model?: string | null
          ai_notes?: string | null
          ai_status?: string
          created_at?: string
          data_uri: string
          id?: string
          instance_id: string
          item_id: string
          location_id: string
          submitted_by?: string | null
          submitted_by_name?: string | null
        }
        Update: {
          ai_model?: string | null
          ai_notes?: string | null
          ai_status?: string
          created_at?: string
          data_uri?: string
          id?: string
          instance_id?: string
          item_id?: string
          location_id?: string
          submitted_by?: string | null
          submitted_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_submissions_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "checklist_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_submissions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_submissions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      checklists: {
        Row: {
          account_id: string | null
          archived: boolean
          closes_at_local: string | null
          created_at: string
          days_of_week: number[]
          description: string | null
          due_by: string | null
          frequency: string
          id: string
          location_id: string | null
          name: string
          opens_at_local: string
          reset_policy: string
          roles: string[]
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          archived?: boolean
          closes_at_local?: string | null
          created_at?: string
          days_of_week?: number[]
          description?: string | null
          due_by?: string | null
          frequency: string
          id?: string
          location_id?: string | null
          name: string
          opens_at_local?: string
          reset_policy?: string
          roles?: string[]
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          archived?: boolean
          closes_at_local?: string | null
          created_at?: string
          days_of_week?: number[]
          description?: string | null
          due_by?: string | null
          frequency?: string
          id?: string
          location_id?: string | null
          name?: string
          opens_at_local?: string
          reset_policy?: string
          roles?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklists_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      closeouts: {
        Row: {
          card_amount: number
          cash_amount: number
          created_at: string
          date: string
          deposit_amount: number
          drawer_count: number
          gsr_extracted_at: string | null
          id: string
          location_id: string
          locked: boolean
          notes: string | null
          sales_data: Json | null
          submitted_by: string | null
          total_sales: number
        }
        Insert: {
          card_amount?: number
          cash_amount?: number
          created_at?: string
          date: string
          deposit_amount?: number
          drawer_count?: number
          gsr_extracted_at?: string | null
          id?: string
          location_id: string
          locked?: boolean
          notes?: string | null
          sales_data?: Json | null
          submitted_by?: string | null
          total_sales?: number
        }
        Update: {
          card_amount?: number
          cash_amount?: number
          created_at?: string
          date?: string
          deposit_amount?: number
          drawer_count?: number
          gsr_extracted_at?: string | null
          id?: string
          location_id?: string
          locked?: boolean
          notes?: string | null
          sales_data?: Json | null
          submitted_by?: string | null
          total_sales?: number
        }
        Relationships: [
          {
            foreignKeyName: "closeouts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "closeouts_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_snapshots: {
        Row: {
          competitor_id: string
          data: Json | null
          error_message: string | null
          fetched_at: string
          id: string
          source: string
          status: string
        }
        Insert: {
          competitor_id: string
          data?: Json | null
          error_message?: string | null
          fetched_at?: string
          id?: string
          source: string
          status: string
        }
        Update: {
          competitor_id?: string
          data?: Json | null
          error_message?: string | null
          fetched_at?: string
          id?: string
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_snapshots_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_suggestions: {
        Row: {
          account_id: string
          acknowledged_at: string | null
          acknowledged_by: string | null
          competitor_id: string | null
          generated_at: string
          id: string
          model: string | null
          severity: string
          suggestion_text: string
        }
        Insert: {
          account_id: string
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          competitor_id?: string | null
          generated_at?: string
          id?: string
          model?: string | null
          severity?: string
          suggestion_text: string
        }
        Update: {
          account_id?: string
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          competitor_id?: string | null
          generated_at?: string
          id?: string
          model?: string | null
          severity?: string
          suggestion_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_suggestions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_suggestions_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_suggestions_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          facebook_url: string | null
          id: string
          instagram_url: string | null
          last_scanned_at: string | null
          location_id: string | null
          name: string
          notes: string | null
          website_url: string | null
          x_url: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          facebook_url?: string | null
          id?: string
          instagram_url?: string | null
          last_scanned_at?: string | null
          location_id?: string | null
          name: string
          notes?: string | null
          website_url?: string | null
          x_url?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          facebook_url?: string | null
          id?: string
          instagram_url?: string | null
          last_scanned_at?: string | null
          location_id?: string | null
          name?: string
          notes?: string | null
          website_url?: string | null
          x_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitors_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitors_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitors_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          category: string
          company: string | null
          created_at: string
          email: string | null
          id: string
          location_id: string
          name: string
          notes: string | null
          phone: string | null
        }
        Insert: {
          category?: string
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          location_id: string
          name: string
          notes?: string | null
          phone?: string | null
        }
        Update: {
          category?: string
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          location_id?: string
          name?: string
          notes?: string | null
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_members: {
        Row: {
          conversation_id: string
          joined_at: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          joined_at?: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          joined_at?: string
          last_read_at?: string
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
          {
            foreignKeyName: "conversation_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          last_message_at: string | null
          last_message_preview: string | null
          last_message_sender_id: string | null
          location_id: string | null
          name: string | null
          topic: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          last_message_at?: string | null
          last_message_preview?: string | null
          last_message_sender_id?: string | null
          location_id?: string | null
          name?: string | null
          topic?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          last_message_sender_id?: string | null
          location_id?: string | null
          name?: string | null
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_last_message_sender_id_fkey"
            columns: ["last_message_sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      counseling_records: {
        Row: {
          acknowledged_at: string | null
          action_plan: string | null
          category: string | null
          created_at: string
          date: string
          description: string | null
          employee_acknowledged: boolean
          employee_id: string
          follow_up_date: string | null
          id: string
          recorded_by: string | null
          recorded_by_name: string | null
          type: string
          witnesses: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          action_plan?: string | null
          category?: string | null
          created_at?: string
          date: string
          description?: string | null
          employee_acknowledged?: boolean
          employee_id: string
          follow_up_date?: string | null
          id?: string
          recorded_by?: string | null
          recorded_by_name?: string | null
          type: string
          witnesses?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          action_plan?: string | null
          category?: string | null
          created_at?: string
          date?: string
          description?: string | null
          employee_acknowledged?: boolean
          employee_id?: string
          follow_up_date?: string | null
          id?: string
          recorded_by?: string | null
          recorded_by_name?: string | null
          type?: string
          witnesses?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "counseling_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counseling_records_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_forms: {
        Row: {
          account_id: string
          form_key: string
          id: string
          schema: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          form_key: string
          id?: string
          schema: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          form_key?: string
          id?: string
          schema?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_forms_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_forms_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_requests: {
        Row: {
          company: string | null
          created_at: string
          details: string | null
          email: string
          id: string
          name: string
          phone: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          details?: string | null
          email: string
          id?: string
          name: string
          phone: string
        }
        Update: {
          company?: string | null
          created_at?: string
          details?: string | null
          email?: string
          id?: string
          name?: string
          phone?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          archived: boolean
          category: string
          created_at: string
          file_url: string
          id: string
          location_id: string
          name: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          archived?: boolean
          category?: string
          created_at?: string
          file_url: string
          id?: string
          location_id: string
          name: string
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          archived?: boolean
          category?: string
          created_at?: string
          file_url?: string
          id?: string
          location_id?: string
          name?: string
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "documents_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      downtime_events: {
        Row: {
          ended_at: string | null
          equipment_id: string | null
          id: string
          location_id: string
          reason: string | null
          reason_category: string | null
          reported_by: string | null
          started_at: string
        }
        Insert: {
          ended_at?: string | null
          equipment_id?: string | null
          id?: string
          location_id: string
          reason?: string | null
          reason_category?: string | null
          reported_by?: string | null
          started_at?: string
        }
        Update: {
          ended_at?: string | null
          equipment_id?: string | null
          id?: string
          location_id?: string
          reason?: string | null
          reason_category?: string | null
          reported_by?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "downtime_events_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downtime_events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downtime_events_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      drb_household_members: {
        Row: {
          account_id: string
          address: string | null
          city: string | null
          customer_objid: string | null
          email: string | null
          first_name: string | null
          full_name: string | null
          household_id: string
          id: string
          last_name: string | null
          phone: string | null
          state: string | null
          zip: string | null
        }
        Insert: {
          account_id: string
          address?: string | null
          city?: string | null
          customer_objid?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          household_id: string
          id?: string
          last_name?: string | null
          phone?: string | null
          state?: string | null
          zip?: string | null
        }
        Update: {
          account_id?: string
          address?: string | null
          city?: string | null
          customer_objid?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          household_id?: string
          id?: string
          last_name?: string | null
          phone?: string | null
          state?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drb_household_members_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drb_household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "drb_households"
            referencedColumns: ["id"]
          },
        ]
      }
      drb_households: {
        Row: {
          account_id: string
          address: string | null
          card_last4: string | null
          city: string | null
          cluster_key: string
          id: string
          match_type: string
          match_value: string | null
          member_count: number
          region: string | null
          state: string | null
          synced_at: string
          zip: string | null
        }
        Insert: {
          account_id: string
          address?: string | null
          card_last4?: string | null
          city?: string | null
          cluster_key: string
          id?: string
          match_type?: string
          match_value?: string | null
          member_count?: number
          region?: string | null
          state?: string | null
          synced_at?: string
          zip?: string | null
        }
        Update: {
          account_id?: string
          address?: string | null
          card_last4?: string | null
          city?: string | null
          cluster_key?: string
          id?: string
          match_type?: string
          match_value?: string | null
          member_count?: number
          region?: string | null
          state?: string | null
          synced_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drb_households_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_badges: {
        Row: {
          account_id: string
          awarded_by: string | null
          awarded_by_name: string | null
          badge_id: string
          earned_at: string
          employee_id: string
          id: string
          note: string | null
        }
        Insert: {
          account_id: string
          awarded_by?: string | null
          awarded_by_name?: string | null
          badge_id: string
          earned_at?: string
          employee_id: string
          id?: string
          note?: string | null
        }
        Update: {
          account_id?: string
          awarded_by?: string | null
          awarded_by_name?: string | null
          badge_id?: string
          earned_at?: string
          employee_id?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_badges_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_badges_awarded_by_fkey"
            columns: ["awarded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_badges_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_onboarding: {
        Row: {
          account_id: string
          completed_at: string | null
          employee_id: string
          id: string
          location_id: string | null
          started_at: string
          step_state: Json
          template_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          completed_at?: string | null
          employee_id: string
          id?: string
          location_id?: string | null
          started_at?: string
          step_state?: Json
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          completed_at?: string | null
          employee_id?: string
          id?: string
          location_id?: string | null
          started_at?: string
          step_state?: Json
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_onboarding_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_onboarding_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_onboarding_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_onboarding_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "onboarding_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          avatar_url: string | null
          certifications: string[] | null
          created_at: string
          email: string | null
          first_name: string
          hourly_rate: number | null
          id: string
          isolved_number: string | null
          last_name: string
          location_id: string
          phone: string | null
          pin_hash: string | null
          role_title: string | null
          start_date: string | null
          status: string
          uniform_size: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          certifications?: string[] | null
          created_at?: string
          email?: string | null
          first_name: string
          hourly_rate?: number | null
          id?: string
          isolved_number?: string | null
          last_name: string
          location_id: string
          phone?: string | null
          pin_hash?: string | null
          role_title?: string | null
          start_date?: string | null
          status?: string
          uniform_size?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          certifications?: string[] | null
          created_at?: string
          email?: string | null
          first_name?: string
          hourly_rate?: number | null
          id?: string
          isolved_number?: string | null
          last_name?: string
          location_id?: string
          phone?: string | null
          pin_hash?: string | null
          role_title?: string | null
          start_date?: string | null
          status?: string
          uniform_size?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment: {
        Row: {
          account_id: string
          area_id: string | null
          asset_number: number
          created_at: string
          crit_class: string | null
          criticality: string
          description: string | null
          id: string
          install_date: string | null
          last_audited_at: string | null
          last_serviced_at: string | null
          location_id: string
          maintainx_id: number | null
          manufacturer: string | null
          model: string | null
          name: string
          parent_asset_id: string | null
          purchase_date: string | null
          qr_code: string | null
          retired_at: string | null
          serial_number: string | null
          service_interval_days: number | null
          status: string
          type: string | null
          updated_at: string
          usage_basis: string
          usage_packages: string[] | null
          vendor_id: string | null
          warranty_expiry: string | null
        }
        Insert: {
          account_id: string
          area_id?: string | null
          asset_number: number
          created_at?: string
          crit_class?: string | null
          criticality?: string
          description?: string | null
          id?: string
          install_date?: string | null
          last_audited_at?: string | null
          last_serviced_at?: string | null
          location_id: string
          maintainx_id?: number | null
          manufacturer?: string | null
          model?: string | null
          name: string
          parent_asset_id?: string | null
          purchase_date?: string | null
          qr_code?: string | null
          retired_at?: string | null
          serial_number?: string | null
          service_interval_days?: number | null
          status?: string
          type?: string | null
          updated_at?: string
          usage_basis?: string
          usage_packages?: string[] | null
          vendor_id?: string | null
          warranty_expiry?: string | null
        }
        Update: {
          account_id?: string
          area_id?: string | null
          asset_number?: number
          created_at?: string
          crit_class?: string | null
          criticality?: string
          description?: string | null
          id?: string
          install_date?: string | null
          last_audited_at?: string | null
          last_serviced_at?: string | null
          location_id?: string
          maintainx_id?: number | null
          manufacturer?: string | null
          model?: string | null
          name?: string
          parent_asset_id?: string | null
          purchase_date?: string | null
          qr_code?: string | null
          retired_at?: string | null
          serial_number?: string | null
          service_interval_days?: number | null
          status?: string
          type?: string | null
          updated_at?: string
          usage_basis?: string
          usage_packages?: string[] | null
          vendor_id?: string | null
          warranty_expiry?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_area_fk"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "mi_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_parent_asset_id_fkey"
            columns: ["parent_asset_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      event_pay_requests: {
        Row: {
          account_id: string
          approval_requested_at: string | null
          approval_status: string | null
          attendees: Json
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_by_name: string | null
          decision_note: string | null
          emailed_at: string | null
          event_date: string
          event_name: string
          id: string
          location_id: string | null
          needs_approval: boolean
          notes: string | null
          requester_name: string
          submitted_by: string | null
          submitter_name: string | null
        }
        Insert: {
          account_id: string
          approval_requested_at?: string | null
          approval_status?: string | null
          attendees?: Json
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          decision_note?: string | null
          emailed_at?: string | null
          event_date: string
          event_name: string
          id?: string
          location_id?: string | null
          needs_approval?: boolean
          notes?: string | null
          requester_name: string
          submitted_by?: string | null
          submitter_name?: string | null
        }
        Update: {
          account_id?: string
          approval_requested_at?: string | null
          approval_status?: string | null
          attendees?: Json
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          decision_note?: string | null
          emailed_at?: string | null
          event_date?: string
          event_name?: string
          id?: string
          location_id?: string | null
          needs_approval?: boolean
          notes?: string | null
          requester_name?: string
          submitted_by?: string | null
          submitter_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_pay_requests_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_pay_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_pay_requests_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_pay_requests_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      exec_goal_checkins: {
        Row: {
          account_id: string
          checkin_date: string
          created_at: string
          goal_id: string
          id: string
          note: string | null
          value: number | null
        }
        Insert: {
          account_id: string
          checkin_date?: string
          created_at?: string
          goal_id: string
          id?: string
          note?: string | null
          value?: number | null
        }
        Update: {
          account_id?: string
          checkin_date?: string
          created_at?: string
          goal_id?: string
          id?: string
          note?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exec_goal_checkins_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exec_goal_checkins_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "exec_goals"
            referencedColumns: ["id"]
          },
        ]
      }
      exec_goal_milestones: {
        Row: {
          account_id: string
          created_at: string
          done_at: string | null
          due_date: string | null
          goal_id: string
          id: string
          sort: number
          title: string
        }
        Insert: {
          account_id: string
          created_at?: string
          done_at?: string | null
          due_date?: string | null
          goal_id: string
          id?: string
          sort?: number
          title: string
        }
        Update: {
          account_id?: string
          created_at?: string
          done_at?: string | null
          due_date?: string | null
          goal_id?: string
          id?: string
          sort?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "exec_goal_milestones_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exec_goal_milestones_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "exec_goals"
            referencedColumns: ["id"]
          },
        ]
      }
      exec_goals: {
        Row: {
          account_id: string
          category: string | null
          created_at: string
          current_value: number | null
          description: string | null
          due_date: string
          id: string
          kind: string
          owner_name: string
          quarter: string
          start_date: string
          start_value: number | null
          status_override: string | null
          target_value: number | null
          title: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          category?: string | null
          created_at?: string
          current_value?: number | null
          description?: string | null
          due_date: string
          id?: string
          kind?: string
          owner_name: string
          quarter: string
          start_date: string
          start_value?: number | null
          status_override?: string | null
          target_value?: number | null
          title: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          category?: string | null
          created_at?: string
          current_value?: number | null
          description?: string | null
          due_date?: string
          id?: string
          kind?: string
          owner_name?: string
          quarter?: string
          start_date?: string
          start_value?: number | null
          status_override?: string | null
          target_value?: number | null
          title?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exec_goals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_request_updates: {
        Row: {
          account_id: string
          author_id: string | null
          author_name: string | null
          created_at: string
          id: string
          note: string
          request_id: string
          status: string | null
        }
        Insert: {
          account_id: string
          author_id?: string | null
          author_name?: string | null
          created_at?: string
          id?: string
          note: string
          request_id: string
          status?: string | null
        }
        Update: {
          account_id?: string
          author_id?: string | null
          author_name?: string | null
          created_at?: string
          id?: string
          note?: string
          request_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facility_request_updates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_request_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_request_updates_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "facility_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_requests: {
        Row: {
          account_id: string
          assigned_to: string | null
          assigned_to_name: string | null
          category: string
          completed_at: string | null
          created_at: string
          description: string | null
          id: string
          location_id: string | null
          priority: string
          requested_by: string | null
          requested_by_name: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          account_id: string
          assigned_to?: string | null
          assigned_to_name?: string | null
          category?: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          location_id?: string | null
          priority?: string
          requested_by?: string | null
          requested_by_name?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          assigned_to?: string | null
          assigned_to_name?: string | null
          category?: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          location_id?: string | null
          priority?: string
          requested_by?: string | null
          requested_by_name?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_requests_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_requests_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_requests_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_changes: {
        Row: {
          account_id: string
          action: string
          created_at: string
          details: Json
          driver_name: string | null
          driver_number: string | null
          id: string
          user_id: string | null
          user_name: string | null
          vehicle_name: string | null
          vehicle_number: string | null
        }
        Insert: {
          account_id: string
          action: string
          created_at?: string
          details?: Json
          driver_name?: string | null
          driver_number?: string | null
          id?: string
          user_id?: string | null
          user_name?: string | null
          vehicle_name?: string | null
          vehicle_number?: string | null
        }
        Update: {
          account_id?: string
          action?: string
          created_at?: string
          details?: Json
          driver_name?: string | null
          driver_number?: string | null
          id?: string
          user_id?: string | null
          user_name?: string | null
          vehicle_name?: string | null
          vehicle_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fleet_changes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_changes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_driver_links: {
        Row: {
          account_id: string
          created_at: string
          driver_number: string
          source: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          driver_number: string
          source: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          driver_number?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_driver_links_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_driver_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_people: {
        Row: {
          account_id: string
          category: string | null
          email: string | null
          merged_into: string | null
          name: string
          person_key: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_id: string
          category?: string | null
          email?: string | null
          merged_into?: string | null
          name: string
          person_key: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_id?: string
          category?: string | null
          email?: string | null
          merged_into?: string | null
          name?: string
          person_key?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fleet_people_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_people_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_vehicle_codes: {
        Row: {
          account_id: string
          code: string
          created_at: string
          vehicle_number: string
        }
        Insert: {
          account_id: string
          code: string
          created_at?: string
          vehicle_number: string
        }
        Update: {
          account_id?: string
          code?: string
          created_at?: string
          vehicle_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_vehicle_codes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      flexwash_sites: {
        Row: {
          account_id: string
          active: boolean
          car_wash_id: string
          created_at: string
          dashboard_source: boolean
          id: string
          name: string | null
          site_number: number
          start_date: string | null
        }
        Insert: {
          account_id: string
          active?: boolean
          car_wash_id: string
          created_at?: string
          dashboard_source?: boolean
          id?: string
          name?: string | null
          site_number: number
          start_date?: string | null
        }
        Update: {
          account_id?: string
          active?: boolean
          car_wash_id?: string
          created_at?: string
          dashboard_source?: boolean
          id?: string
          name?: string | null
          site_number?: number
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flexwash_sites_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      gatherup_reviews: {
        Row: {
          account_id: string
          author: string | null
          content: string | null
          location_id: string
          rating: number | null
          review_id: number
          review_time: string | null
          synced_at: string
        }
        Insert: {
          account_id: string
          author?: string | null
          content?: string | null
          location_id: string
          rating?: number | null
          review_id: number
          review_time?: string | null
          synced_at?: string
        }
        Update: {
          account_id?: string
          author?: string | null
          content?: string | null
          location_id?: string
          rating?: number | null
          review_id?: number
          review_time?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gatherup_reviews_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gatherup_reviews_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      gm_bonus_base: {
        Row: {
          account_id: string
          avg_mos: number
          created_at: string
          effective_from: string
          fourth_count: number
          id: string
          kind: string
          location_id: string
          mighty_count: number
          super_count: number
          updated_at: string
          wonder_count: number
        }
        Insert: {
          account_id: string
          avg_mos?: number
          created_at?: string
          effective_from: string
          fourth_count?: number
          id?: string
          kind: string
          location_id: string
          mighty_count?: number
          super_count?: number
          updated_at?: string
          wonder_count?: number
        }
        Update: {
          account_id?: string
          avg_mos?: number
          created_at?: string
          effective_from?: string
          fourth_count?: number
          id?: string
          kind?: string
          location_id?: string
          mighty_count?: number
          super_count?: number
          updated_at?: string
          wonder_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "gm_bonus_base_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gm_bonus_base_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      gm_bonus_months: {
        Row: {
          account_id: string
          agm_override: number | null
          avg_mos: number
          churn_pct: number
          conversion_pct: number
          created_at: string
          fourth_count: number
          gm_override: number | null
          id: string
          location_id: string
          mighty_count: number
          period: string
          source: string
          submitted_by: string | null
          super_count: number
          under_construction: boolean
          updated_at: string
          wonder_count: number
        }
        Insert: {
          account_id: string
          agm_override?: number | null
          avg_mos?: number
          churn_pct?: number
          conversion_pct?: number
          created_at?: string
          fourth_count?: number
          gm_override?: number | null
          id?: string
          location_id: string
          mighty_count?: number
          period: string
          source?: string
          submitted_by?: string | null
          super_count?: number
          under_construction?: boolean
          updated_at?: string
          wonder_count?: number
        }
        Update: {
          account_id?: string
          agm_override?: number | null
          avg_mos?: number
          churn_pct?: number
          conversion_pct?: number
          created_at?: string
          fourth_count?: number
          gm_override?: number | null
          id?: string
          location_id?: string
          mighty_count?: number
          period?: string
          source?: string
          submitted_by?: string | null
          super_count?: number
          under_construction?: boolean
          updated_at?: string
          wonder_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "gm_bonus_months_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gm_bonus_months_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gm_bonus_months_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_connections: {
        Row: {
          access_token: string | null
          account_id: string
          calendar_id: string
          created_at: string
          email: string | null
          id: string
          refresh_token: string
          token_expiry: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          account_id: string
          calendar_id?: string
          created_at?: string
          email?: string | null
          id?: string
          refresh_token: string
          token_expiry?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          account_id?: string
          calendar_id?: string
          created_at?: string
          email?: string | null
          id?: string
          refresh_token?: string
          token_expiry?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_connections_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_calendar_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      injury_reports: {
        Row: {
          area_description: string | null
          body_part_affected: string | null
          case_number: string | null
          cause: string | null
          classification: string | null
          created_at: string
          days_lost: number | null
          days_restricted: number | null
          description: string | null
          doctor_visit: boolean
          employee_id: string
          id: string
          illness_type: string | null
          incident_date: string
          incident_time: string | null
          job_title_snapshot: string | null
          location_id: string
          medical_treatment_required: boolean
          osha_recordable: boolean
          reported_by: string | null
          reported_by_name: string | null
          severity: string | null
          treatment_given: string | null
          witness_names: string | null
        }
        Insert: {
          area_description?: string | null
          body_part_affected?: string | null
          case_number?: string | null
          cause?: string | null
          classification?: string | null
          created_at?: string
          days_lost?: number | null
          days_restricted?: number | null
          description?: string | null
          doctor_visit?: boolean
          employee_id: string
          id?: string
          illness_type?: string | null
          incident_date: string
          incident_time?: string | null
          job_title_snapshot?: string | null
          location_id: string
          medical_treatment_required?: boolean
          osha_recordable?: boolean
          reported_by?: string | null
          reported_by_name?: string | null
          severity?: string | null
          treatment_given?: string | null
          witness_names?: string | null
        }
        Update: {
          area_description?: string | null
          body_part_affected?: string | null
          case_number?: string | null
          cause?: string | null
          classification?: string | null
          created_at?: string
          days_lost?: number | null
          days_restricted?: number | null
          description?: string | null
          doctor_visit?: boolean
          employee_id?: string
          id?: string
          illness_type?: string | null
          incident_date?: string
          incident_time?: string | null
          job_title_snapshot?: string | null
          location_id?: string
          medical_treatment_required?: boolean
          osha_recordable?: boolean
          reported_by?: string | null
          reported_by_name?: string | null
          severity?: string | null
          treatment_given?: string | null
          witness_names?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "injury_reports_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "injury_reports_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "injury_reports_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_lines: {
        Row: {
          id: string
          item_id: string
          online_quantity: number | null
          quantity: number | null
          session_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          item_id: string
          online_quantity?: number | null
          quantity?: number | null
          session_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          item_id?: string
          online_quantity?: number | null
          quantity?: number | null
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_lines_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inventory_count_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_sessions: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          created_by_name: string | null
          division: string | null
          id: string
          location_id: string
          note: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          division?: string | null
          id?: string
          location_id: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          division?: string | null
          id?: string
          location_id?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_sessions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_sessions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_counts: {
        Row: {
          account_id: string
          brand: string | null
          category: string | null
          created_at: string
          division: string | null
          id: string
          item: string | null
          location_id: string | null
          quantity: number
          submitted_by: string | null
          submitted_by_name: string | null
        }
        Insert: {
          account_id: string
          brand?: string | null
          category?: string | null
          created_at?: string
          division?: string | null
          id?: string
          item?: string | null
          location_id?: string | null
          quantity?: number
          submitted_by?: string | null
          submitted_by_name?: string | null
        }
        Update: {
          account_id?: string
          brand?: string | null
          category?: string | null
          created_at?: string
          division?: string | null
          id?: string
          item?: string | null
          location_id?: string | null
          quantity?: number
          submitted_by?: string | null
          submitted_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_counts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_counts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_counts_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          account_id: string
          brand: string | null
          category: string | null
          created_at: string
          division: string
          id: string
          item: string | null
          value: number | null
        }
        Insert: {
          account_id: string
          brand?: string | null
          category?: string | null
          created_at?: string
          division?: string
          id?: string
          item?: string | null
          value?: number | null
        }
        Update: {
          account_id?: string
          brand?: string | null
          category?: string | null
          created_at?: string
          division?: string
          id?: string
          item?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          account_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          location_ids: string[]
          name: string | null
          role: string
          role_category: string | null
          status: string
          token: string
        }
        Insert: {
          account_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          location_ids?: string[]
          name?: string | null
          role: string
          role_category?: string | null
          status?: string
          token?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          location_ids?: string[]
          name?: string | null
          role?: string
          role_category?: string | null
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_classes: {
        Row: {
          account_id: string
          active: boolean
          class: string
          created_at: string
          id: string
          sort_order: number
        }
        Insert: {
          account_id: string
          active?: boolean
          class: string
          created_at?: string
          id?: string
          sort_order?: number
        }
        Update: {
          account_id?: string
          active?: boolean
          class?: string
          created_at?: string
          id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_classes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_gl_codes: {
        Row: {
          account_id: string
          active: boolean
          code: string
          created_at: string
          id: string
          sort_order: number
        }
        Insert: {
          account_id: string
          active?: boolean
          code: string
          created_at?: string
          id?: string
          sort_order?: number
        }
        Update: {
          account_id?: string
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_gl_codes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_vendor_aliases: {
        Row: {
          account_id: string
          alias_name: string
          canonical_name: string
          created_at: string
          id: string
        }
        Insert: {
          account_id: string
          alias_name: string
          canonical_name: string
          created_at?: string
          id?: string
        }
        Update: {
          account_id?: string
          alias_name?: string
          canonical_name?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_vendor_aliases_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_vendors: {
        Row: {
          account_id: string
          active: boolean
          created_at: string
          id: string
          name: string
        }
        Insert: {
          account_id: string
          active?: boolean
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          account_id?: string
          active?: boolean
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_vendors_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      it_accessories: {
        Row: {
          account_id: string
          category_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          location_id: string
          min_qty: number
          model_number: string | null
          name: string
          notes: string | null
          qty_total: number
          supplier_id: string | null
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          account_id: string
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          location_id: string
          min_qty?: number
          model_number?: string | null
          name: string
          notes?: string | null
          qty_total?: number
          supplier_id?: string | null
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          location_id?: string
          min_qty?: number
          model_number?: string | null
          name?: string
          notes?: string | null
          qty_total?: number
          supplier_id?: string | null
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_accessories_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_accessories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "it_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_accessories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_accessories_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_accessories_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "it_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      it_accessory_assignments: {
        Row: {
          accessory_id: string
          accessory_name: string | null
          account_id: string
          asset_id: string | null
          assigned_id: string
          assigned_label: string | null
          assigned_type: string
          checked_in_at: string | null
          checked_in_by: string | null
          checked_out_at: string
          checked_out_by: string | null
          checkin_note: string | null
          created_at: string
          created_by: string | null
          expected_return_at: string | null
          id: string
          location_id: string
          note: string | null
          qty: number
          updated_at: string
        }
        Insert: {
          accessory_id: string
          accessory_name?: string | null
          account_id: string
          asset_id?: string | null
          assigned_id: string
          assigned_label?: string | null
          assigned_type: string
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_out_at?: string
          checked_out_by?: string | null
          checkin_note?: string | null
          created_at?: string
          created_by?: string | null
          expected_return_at?: string | null
          id?: string
          location_id: string
          note?: string | null
          qty: number
          updated_at?: string
        }
        Update: {
          accessory_id?: string
          accessory_name?: string | null
          account_id?: string
          asset_id?: string | null
          assigned_id?: string
          assigned_label?: string | null
          assigned_type?: string
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_out_at?: string
          checked_out_by?: string | null
          checkin_note?: string | null
          created_at?: string
          created_by?: string | null
          expected_return_at?: string | null
          id?: string
          location_id?: string
          note?: string | null
          qty?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_accessory_assignments_accessory_id_fkey"
            columns: ["accessory_id"]
            isOneToOne: false
            referencedRelation: "it_accessories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_accessory_assignments_accessory_id_fkey"
            columns: ["accessory_id"]
            isOneToOne: false
            referencedRelation: "it_accessory_stock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_accessory_assignments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_accessory_assignments_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "it_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_accessory_assignments_checked_in_by_fkey"
            columns: ["checked_in_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_accessory_assignments_checked_out_by_fkey"
            columns: ["checked_out_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_accessory_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_accessory_assignments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      it_activity_log: {
        Row: {
          account_id: string
          action: string
          actor_name: string | null
          actor_system: string | null
          actor_user_id: string | null
          after: Json | null
          asset_id: string | null
          before: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          location_id: string | null
        }
        Insert: {
          account_id: string
          action: string
          actor_name?: string | null
          actor_system?: string | null
          actor_user_id?: string | null
          after?: Json | null
          asset_id?: string | null
          before?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          location_id?: string | null
        }
        Update: {
          account_id?: string
          action?: string
          actor_name?: string | null
          actor_system?: string | null
          actor_user_id?: string | null
          after?: Json | null
          asset_id?: string | null
          before?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          location_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "it_activity_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      it_asset_models: {
        Row: {
          account_id: string
          category_id: string
          created_at: string
          created_by: string | null
          default_warranty_months: number | null
          deleted_at: string | null
          depreciation_id: string | null
          eol_months: number | null
          fieldset_id: string | null
          id: string
          image_path: string | null
          manufacturer_id: string | null
          model_number: string | null
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          category_id: string
          created_at?: string
          created_by?: string | null
          default_warranty_months?: number | null
          deleted_at?: string | null
          depreciation_id?: string | null
          eol_months?: number | null
          fieldset_id?: string | null
          id?: string
          image_path?: string | null
          manufacturer_id?: string | null
          model_number?: string | null
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          category_id?: string
          created_at?: string
          created_by?: string | null
          default_warranty_months?: number | null
          deleted_at?: string | null
          depreciation_id?: string | null
          eol_months?: number | null
          fieldset_id?: string | null
          id?: string
          image_path?: string | null
          manufacturer_id?: string | null
          model_number?: string | null
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_asset_models_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_asset_models_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "it_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_asset_models_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_asset_models_fieldset_id_fkey"
            columns: ["fieldset_id"]
            isOneToOne: false
            referencedRelation: "it_fieldsets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_asset_models_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "it_manufacturers"
            referencedColumns: ["id"]
          },
        ]
      }
      it_asset_secrets: {
        Row: {
          account_id: string
          asset_id: string
          created_at: string
          created_by: string | null
          field_id: string
          id: string
          secret_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          asset_id: string
          created_at?: string
          created_by?: string | null
          field_id: string
          id?: string
          secret_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          asset_id?: string
          created_at?: string
          created_by?: string | null
          field_id?: string
          id?: string
          secret_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_asset_secrets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_asset_secrets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "it_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_asset_secrets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_asset_secrets_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "it_custom_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      it_asset_tags: {
        Row: {
          account_id: string
          asset_id: string | null
          batch_id: string | null
          created_at: string
          created_by: string | null
          id: string
          last_printed_at: string | null
          location_id: string | null
          printed_count: number
          source: string
          status: string
          tag: string
          updated_at: string
        }
        Insert: {
          account_id: string
          asset_id?: string | null
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_printed_at?: string | null
          location_id?: string | null
          printed_count?: number
          source?: string
          status?: string
          tag: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          asset_id?: string | null
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_printed_at?: string | null
          location_id?: string | null
          printed_count?: number
          source?: string
          status?: string
          tag?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_asset_tags_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_asset_tags_asset_fk"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "it_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_asset_tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_asset_tags_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      it_assets: {
        Row: {
          account_id: string
          area_id: string | null
          asset_tag: string
          assigned_id: string | null
          assigned_label: string | null
          assigned_type: string | null
          category_id: string
          created_at: string
          created_by: string | null
          custom_values: Json
          deleted_at: string | null
          eol_date: string | null
          health_changed_at: string | null
          health_state: string
          hostname: string | null
          id: string
          image_path: string | null
          ip_address: unknown
          last_audit_at: string | null
          last_seen_at: string | null
          location_id: string
          mac_address: unknown
          model_id: string | null
          monitor_interval_seconds: number
          monitor_method: string
          monitor_target: string | null
          monitoring_enabled: boolean
          name: string
          next_audit_date: string | null
          notes: string | null
          order_number: string | null
          parent_asset_id: string | null
          purchase_cost: number | null
          purchase_date: string | null
          serial: string | null
          status_label_id: string
          sticker_condition: string
          sticker_last_verified_at: string | null
          supplier_id: string | null
          updated_at: string
          warranty_end_date: string | null
          warranty_end_manual: boolean
        }
        Insert: {
          account_id: string
          area_id?: string | null
          asset_tag: string
          assigned_id?: string | null
          assigned_label?: string | null
          assigned_type?: string | null
          category_id: string
          created_at?: string
          created_by?: string | null
          custom_values?: Json
          deleted_at?: string | null
          eol_date?: string | null
          health_changed_at?: string | null
          health_state?: string
          hostname?: string | null
          id?: string
          image_path?: string | null
          ip_address?: unknown
          last_audit_at?: string | null
          last_seen_at?: string | null
          location_id: string
          mac_address?: unknown
          model_id?: string | null
          monitor_interval_seconds?: number
          monitor_method?: string
          monitor_target?: string | null
          monitoring_enabled?: boolean
          name: string
          next_audit_date?: string | null
          notes?: string | null
          order_number?: string | null
          parent_asset_id?: string | null
          purchase_cost?: number | null
          purchase_date?: string | null
          serial?: string | null
          status_label_id: string
          sticker_condition?: string
          sticker_last_verified_at?: string | null
          supplier_id?: string | null
          updated_at?: string
          warranty_end_date?: string | null
          warranty_end_manual?: boolean
        }
        Update: {
          account_id?: string
          area_id?: string | null
          asset_tag?: string
          assigned_id?: string | null
          assigned_label?: string | null
          assigned_type?: string | null
          category_id?: string
          created_at?: string
          created_by?: string | null
          custom_values?: Json
          deleted_at?: string | null
          eol_date?: string | null
          health_changed_at?: string | null
          health_state?: string
          hostname?: string | null
          id?: string
          image_path?: string | null
          ip_address?: unknown
          last_audit_at?: string | null
          last_seen_at?: string | null
          location_id?: string
          mac_address?: unknown
          model_id?: string | null
          monitor_interval_seconds?: number
          monitor_method?: string
          monitor_target?: string | null
          monitoring_enabled?: boolean
          name?: string
          next_audit_date?: string | null
          notes?: string | null
          order_number?: string | null
          parent_asset_id?: string | null
          purchase_cost?: number | null
          purchase_date?: string | null
          serial?: string | null
          status_label_id?: string
          sticker_condition?: string
          sticker_last_verified_at?: string | null
          supplier_id?: string | null
          updated_at?: string
          warranty_end_date?: string | null
          warranty_end_manual?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "it_assets_account_id_asset_tag_fkey"
            columns: ["account_id", "asset_tag"]
            isOneToOne: false
            referencedRelation: "it_asset_tags"
            referencedColumns: ["account_id", "tag"]
          },
          {
            foreignKeyName: "it_assets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_assets_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "it_site_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_assets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "it_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_assets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_assets_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_assets_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "it_asset_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_assets_parent_asset_id_fkey"
            columns: ["parent_asset_id"]
            isOneToOne: false
            referencedRelation: "it_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_assets_status_label_id_fkey"
            columns: ["status_label_id"]
            isOneToOne: false
            referencedRelation: "it_status_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_assets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "it_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      it_assignments: {
        Row: {
          account_id: string
          asset_id: string
          assigned_id: string
          assigned_label: string | null
          assigned_type: string
          checked_in_at: string | null
          checked_in_by: string | null
          checked_out_at: string
          checked_out_by: string | null
          checkin_note: string | null
          created_at: string
          created_by: string | null
          expected_return_at: string | null
          id: string
          location_id: string
          note: string | null
          photo_path: string | null
          signature_path: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          asset_id: string
          assigned_id: string
          assigned_label?: string | null
          assigned_type: string
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_out_at?: string
          checked_out_by?: string | null
          checkin_note?: string | null
          created_at?: string
          created_by?: string | null
          expected_return_at?: string | null
          id?: string
          location_id: string
          note?: string | null
          photo_path?: string | null
          signature_path?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          asset_id?: string
          assigned_id?: string
          assigned_label?: string | null
          assigned_type?: string
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_out_at?: string
          checked_out_by?: string | null
          checkin_note?: string | null
          created_at?: string
          created_by?: string | null
          expected_return_at?: string | null
          id?: string
          location_id?: string
          note?: string | null
          photo_path?: string | null
          signature_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_assignments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_assignments_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "it_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_assignments_checked_in_by_fkey"
            columns: ["checked_in_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_assignments_checked_out_by_fkey"
            columns: ["checked_out_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_assignments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      it_attachments: {
        Row: {
          account_id: string
          caption: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          entity_id: string
          entity_type: string
          id: string
          kind: string
          location_id: string | null
          mime_type: string | null
          storage_path: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          account_id: string
          caption?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          kind?: string
          location_id?: string | null
          mime_type?: string | null
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          account_id?: string
          caption?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          kind?: string
          location_id?: string | null
          mime_type?: string | null
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "it_attachments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_attachments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_attachments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      it_audit_items: {
        Row: {
          account_id: string
          ai_verification_result: Json | null
          asset_id: string | null
          audit_run_id: string
          checked_at: string | null
          checked_by: string | null
          created_at: string
          created_by: string | null
          custom_values: Json
          expected: boolean
          found_area_id: string | null
          id: string
          listed_area_id: string | null
          location_id: string
          note: string | null
          other_site_id: string | null
          photo_path: string | null
          result: string
          sticker_condition: string | null
          tag: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          ai_verification_result?: Json | null
          asset_id?: string | null
          audit_run_id: string
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          created_by?: string | null
          custom_values?: Json
          expected?: boolean
          found_area_id?: string | null
          id?: string
          listed_area_id?: string | null
          location_id: string
          note?: string | null
          other_site_id?: string | null
          photo_path?: string | null
          result?: string
          sticker_condition?: string | null
          tag?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          ai_verification_result?: Json | null
          asset_id?: string | null
          audit_run_id?: string
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          created_by?: string | null
          custom_values?: Json
          expected?: boolean
          found_area_id?: string | null
          id?: string
          listed_area_id?: string | null
          location_id?: string
          note?: string | null
          other_site_id?: string | null
          photo_path?: string | null
          result?: string
          sticker_condition?: string | null
          tag?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_audit_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_audit_items_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "it_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_audit_items_audit_run_id_fkey"
            columns: ["audit_run_id"]
            isOneToOne: false
            referencedRelation: "it_audit_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_audit_items_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_audit_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_audit_items_found_area_id_fkey"
            columns: ["found_area_id"]
            isOneToOne: false
            referencedRelation: "it_site_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_audit_items_listed_area_id_fkey"
            columns: ["listed_area_id"]
            isOneToOne: false
            referencedRelation: "it_site_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_audit_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_audit_items_other_site_id_fkey"
            columns: ["other_site_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      it_audit_runs: {
        Row: {
          account_id: string
          checklist_run_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          id: string
          location_id: string
          note: string | null
          started_at: string
          started_by: string | null
          status: string
          summary: Json
          updated_at: string
        }
        Insert: {
          account_id: string
          checklist_run_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location_id: string
          note?: string | null
          started_at?: string
          started_by?: string | null
          status?: string
          summary?: Json
          updated_at?: string
        }
        Update: {
          account_id?: string
          checklist_run_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string
          note?: string | null
          started_at?: string
          started_by?: string | null
          status?: string
          summary?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_audit_runs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_audit_runs_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_audit_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_audit_runs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_audit_runs_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      it_categories: {
        Row: {
          account_id: string
          alert_delay_minutes: number | null
          audit_interval_months: number | null
          created_at: string
          created_by: string | null
          default_fieldset_id: string | null
          default_monitoring: boolean
          deleted_at: string | null
          icon: string
          id: string
          kind: string
          label_template_id: string | null
          name: string
          requires_ip: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          account_id: string
          alert_delay_minutes?: number | null
          audit_interval_months?: number | null
          created_at?: string
          created_by?: string | null
          default_fieldset_id?: string | null
          default_monitoring?: boolean
          deleted_at?: string | null
          icon?: string
          id?: string
          kind?: string
          label_template_id?: string | null
          name: string
          requires_ip?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          alert_delay_minutes?: number | null
          audit_interval_months?: number | null
          created_at?: string
          created_by?: string | null
          default_fieldset_id?: string | null
          default_monitoring?: boolean
          deleted_at?: string | null
          icon?: string
          id?: string
          kind?: string
          label_template_id?: string | null
          name?: string
          requires_ip?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_categories_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_categories_default_fieldset_id_fkey"
            columns: ["default_fieldset_id"]
            isOneToOne: false
            referencedRelation: "it_fieldsets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_categories_label_template_id_fkey"
            columns: ["label_template_id"]
            isOneToOne: false
            referencedRelation: "it_label_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      it_consumable_events: {
        Row: {
          account_id: string
          consumable_id: string
          created_at: string
          created_by: string | null
          delta: number
          id: string
          location_id: string
          note: string | null
          reason: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_id: string
          consumable_id: string
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          location_id: string
          note?: string | null
          reason: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_id?: string
          consumable_id?: string
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          location_id?: string
          note?: string | null
          reason?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "it_consumable_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_consumable_events_consumable_id_fkey"
            columns: ["consumable_id"]
            isOneToOne: false
            referencedRelation: "it_consumables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_consumable_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_consumable_events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_consumable_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      it_consumables: {
        Row: {
          account_id: string
          category_id: string | null
          counted_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          is_sticker_stock: boolean
          location_id: string
          low_since: string | null
          min_qty: number
          model_number: string | null
          name: string
          qty_on_hand: number
          reorder_url: string | null
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          category_id?: string | null
          counted_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_sticker_stock?: boolean
          location_id: string
          low_since?: string | null
          min_qty?: number
          model_number?: string | null
          name: string
          qty_on_hand?: number
          reorder_url?: string | null
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          category_id?: string | null
          counted_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_sticker_stock?: boolean
          location_id?: string
          low_since?: string | null
          min_qty?: number
          model_number?: string | null
          name?: string
          qty_on_hand?: number
          reorder_url?: string | null
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_consumables_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_consumables_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "it_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_consumables_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_consumables_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_consumables_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "it_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      it_custom_fields: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          editable_during_audit: boolean
          field_type: string
          help_text: string | null
          id: string
          is_required: boolean
          key: string
          name: string
          options: Json
          show_in_list: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          editable_during_audit?: boolean
          field_type: string
          help_text?: string | null
          id?: string
          is_required?: boolean
          key: string
          name: string
          options?: Json
          show_in_list?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          editable_during_audit?: boolean
          field_type?: string
          help_text?: string | null
          id?: string
          is_required?: boolean
          key?: string
          name?: string
          options?: Json
          show_in_list?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_custom_fields_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_custom_fields_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      it_field_checklists: {
        Row: {
          account_id: string
          created_at: string
          emailed_at: string | null
          id: string
          items: Json
          location_id: string | null
          notes: string | null
          status: string
          submitted_at: string | null
          tech_id: string | null
          tech_name: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          emailed_at?: string | null
          id?: string
          items?: Json
          location_id?: string | null
          notes?: string | null
          status?: string
          submitted_at?: string | null
          tech_id?: string | null
          tech_name?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          emailed_at?: string | null
          id?: string
          items?: Json
          location_id?: string | null
          notes?: string | null
          status?: string
          submitted_at?: string | null
          tech_id?: string | null
          tech_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_field_checklists_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_field_checklists_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_field_checklists_tech_id_fkey"
            columns: ["tech_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      it_fieldset_fields: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          field_id: string
          fieldset_id: string
          id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          field_id: string
          fieldset_id: string
          id?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          field_id?: string
          fieldset_id?: string
          id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_fieldset_fields_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_fieldset_fields_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_fieldset_fields_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "it_custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_fieldset_fields_fieldset_id_fkey"
            columns: ["fieldset_id"]
            isOneToOne: false
            referencedRelation: "it_fieldsets"
            referencedColumns: ["id"]
          },
        ]
      }
      it_fieldsets: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_fieldsets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_fieldsets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      it_health_events: {
        Row: {
          account_id: string
          asset_id: string
          created_at: string
          created_by: string | null
          id: string
          latency_ms: number | null
          location_id: string
          note: string | null
          observed_at: string
          source: string
          state: string
          updated_at: string
        }
        Insert: {
          account_id: string
          asset_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          latency_ms?: number | null
          location_id: string
          note?: string | null
          observed_at?: string
          source: string
          state: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          asset_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          latency_ms?: number | null
          location_id?: string
          note?: string | null
          observed_at?: string
          source?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_health_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_health_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "it_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_health_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_health_events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      it_label_print_jobs: {
        Row: {
          account_id: string
          asset_ids: string[]
          copies: number
          created_at: string
          created_by: string | null
          id: string
          location_id: string | null
          pdf_path: string | null
          printed_at: string
          printed_by: string | null
          quantity: number
          tag_ids: string[]
          template_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          asset_ids?: string[]
          copies?: number
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          pdf_path?: string | null
          printed_at?: string
          printed_by?: string | null
          quantity: number
          tag_ids?: string[]
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          asset_ids?: string[]
          copies?: number
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          pdf_path?: string | null
          printed_at?: string
          printed_by?: string | null
          quantity?: number
          tag_ids?: string[]
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_label_print_jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_label_print_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_label_print_jobs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_label_print_jobs_printed_by_fkey"
            columns: ["printed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_label_print_jobs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "it_label_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      it_label_templates: {
        Row: {
          account_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          is_default: boolean
          is_outdoor: boolean
          kind: string
          layout: Json
          name: string
          offset_x_mm: number
          offset_y_mm: number
          page_spec: Json
          scale: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_default?: boolean
          is_outdoor?: boolean
          kind: string
          layout: Json
          name: string
          offset_x_mm?: number
          offset_y_mm?: number
          page_spec: Json
          scale?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_default?: boolean
          is_outdoor?: boolean
          kind?: string
          layout?: Json
          name?: string
          offset_x_mm?: number
          offset_y_mm?: number
          page_spec?: Json
          scale?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_label_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_label_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      it_maintenance_types: {
        Row: {
          account_id: string
          color: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          account_id: string
          color?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          color?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_maintenance_types_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_maintenance_types_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      it_maintenances: {
        Row: {
          account_id: string
          asset_id: string
          completion_date: string | null
          cost: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          downtime_minutes: number | null
          id: string
          is_warranty: boolean
          location_id: string
          maintenance_type_id: string | null
          notes: string | null
          out_of_service_at: string | null
          prior_status_id: string | null
          start_date: string
          supplier_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          account_id: string
          asset_id: string
          completion_date?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          downtime_minutes?: number | null
          id?: string
          is_warranty?: boolean
          location_id: string
          maintenance_type_id?: string | null
          notes?: string | null
          out_of_service_at?: string | null
          prior_status_id?: string | null
          start_date?: string
          supplier_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          asset_id?: string
          completion_date?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          downtime_minutes?: number | null
          id?: string
          is_warranty?: boolean
          location_id?: string
          maintenance_type_id?: string | null
          notes?: string | null
          out_of_service_at?: string | null
          prior_status_id?: string | null
          start_date?: string
          supplier_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_maintenances_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_maintenances_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "it_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_maintenances_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_maintenances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_maintenances_maintenance_type_id_fkey"
            columns: ["maintenance_type_id"]
            isOneToOne: false
            referencedRelation: "it_maintenance_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_maintenances_prior_status_id_fkey"
            columns: ["prior_status_id"]
            isOneToOne: false
            referencedRelation: "it_status_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_maintenances_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "it_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      it_manufacturers: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          name: string
          support_phone: string | null
          support_url: string | null
          updated_at: string
          warranty_lookup_url: string | null
          website: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          support_phone?: string | null
          support_url?: string | null
          updated_at?: string
          warranty_lookup_url?: string | null
          website?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          support_phone?: string | null
          support_url?: string | null
          updated_at?: string
          warranty_lookup_url?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "it_manufacturers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_manufacturers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      it_reminder_rules: {
        Row: {
          account_id: string
          channels: string[]
          created_at: string
          created_by: string | null
          days_before: number[]
          digest: boolean
          enabled: boolean
          id: string
          kind: string
          recipients: Json
          updated_at: string
        }
        Insert: {
          account_id: string
          channels?: string[]
          created_at?: string
          created_by?: string | null
          days_before?: number[]
          digest?: boolean
          enabled?: boolean
          id?: string
          kind: string
          recipients?: Json
          updated_at?: string
        }
        Update: {
          account_id?: string
          channels?: string[]
          created_at?: string
          created_by?: string | null
          days_before?: number[]
          digest?: boolean
          enabled?: boolean
          id?: string
          kind?: string
          recipients?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_reminder_rules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_reminder_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      it_reminder_sends: {
        Row: {
          account_id: string
          channel: string
          created_at: string
          created_by: string | null
          due_date: string
          entity_id: string
          entity_type: string
          id: string
          kind: string
          recipient_id: string
          rule_id: string
          sent_at: string
          threshold_days: number
          updated_at: string
        }
        Insert: {
          account_id: string
          channel: string
          created_at?: string
          created_by?: string | null
          due_date: string
          entity_id: string
          entity_type: string
          id?: string
          kind: string
          recipient_id: string
          rule_id: string
          sent_at?: string
          threshold_days: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          due_date?: string
          entity_id?: string
          entity_type?: string
          id?: string
          kind?: string
          recipient_id?: string
          rule_id?: string
          sent_at?: string
          threshold_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_reminder_sends_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_reminder_sends_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_reminder_sends_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "it_reminder_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      it_saved_views: {
        Row: {
          account_id: string
          columns: Json
          created_at: string
          created_by: string | null
          entity: string
          filters: Json
          id: string
          is_shared: boolean
          name: string
          sort: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          columns?: Json
          created_at?: string
          created_by?: string | null
          entity: string
          filters?: Json
          id?: string
          is_shared?: boolean
          name: string
          sort?: Json
          updated_at?: string
          user_id?: string
        }
        Update: {
          account_id?: string
          columns?: Json
          created_at?: string
          created_by?: string | null
          entity?: string
          filters?: Json
          id?: string
          is_shared?: boolean
          name?: string
          sort?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_saved_views_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_saved_views_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_saved_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      it_settings: {
        Row: {
          account_id: string
          audit_interval_months: number
          audit_warning_days: number
          created_at: string
          created_by: string | null
          id: string
          label_logo_path: string | null
          label_show_logo: boolean
          reminders_enabled: boolean
          short_code: string
          site_prefixes: Json
          support_phone: string | null
          tag_padding: number
          tag_prefix: string
          updated_at: string
          use_site_prefix: boolean
        }
        Insert: {
          account_id: string
          audit_interval_months?: number
          audit_warning_days?: number
          created_at?: string
          created_by?: string | null
          id?: string
          label_logo_path?: string | null
          label_show_logo?: boolean
          reminders_enabled?: boolean
          short_code: string
          site_prefixes?: Json
          support_phone?: string | null
          tag_padding?: number
          tag_prefix?: string
          updated_at?: string
          use_site_prefix?: boolean
        }
        Update: {
          account_id?: string
          audit_interval_months?: number
          audit_warning_days?: number
          created_at?: string
          created_by?: string | null
          id?: string
          label_logo_path?: string | null
          label_show_logo?: boolean
          reminders_enabled?: boolean
          short_code?: string
          site_prefixes?: Json
          support_phone?: string | null
          tag_padding?: number
          tag_prefix?: string
          updated_at?: string
          use_site_prefix?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "it_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      it_site_areas: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          location_id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          location_id: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          location_id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_site_areas_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_site_areas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_site_areas_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      it_status_labels: {
        Row: {
          account_id: string
          color: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          is_default: boolean
          name: string
          sort_order: number
          type: string
          updated_at: string
        }
        Insert: {
          account_id: string
          color?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_default?: boolean
          name: string
          sort_order?: number
          type: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          color?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_default?: boolean
          name?: string
          sort_order?: number
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_status_labels_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_status_labels_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      it_subscription_assets: {
        Row: {
          account_id: string
          asset_id: string
          created_at: string
          created_by: string | null
          id: string
          subscription_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          asset_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          subscription_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          asset_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          subscription_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_subscription_assets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_subscription_assets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "it_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_subscription_assets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_subscription_assets_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "it_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      it_subscriptions: {
        Row: {
          account_id: string
          account_number: string | null
          auto_renew: boolean
          billing_cycle: string
          cancel_notice_days: number | null
          category_id: string | null
          cost: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          location_id: string | null
          name: string
          notes: string | null
          owner_user_id: string | null
          renewal_date: string | null
          seats: number | null
          start_date: string | null
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          account_number?: string | null
          auto_renew?: boolean
          billing_cycle?: string
          cancel_notice_days?: number | null
          category_id?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          location_id?: string | null
          name: string
          notes?: string | null
          owner_user_id?: string | null
          renewal_date?: string | null
          seats?: number | null
          start_date?: string | null
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          account_number?: string | null
          auto_renew?: boolean
          billing_cycle?: string
          cancel_notice_days?: number | null
          category_id?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          location_id?: string | null
          name?: string
          notes?: string | null
          owner_user_id?: string | null
          renewal_date?: string | null
          seats?: number | null
          start_date?: string | null
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_subscriptions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_subscriptions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "it_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_subscriptions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_subscriptions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_subscriptions_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_subscriptions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "it_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      it_suppliers: {
        Row: {
          account_id: string
          account_number: string | null
          contact_name: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          account_id: string
          account_number?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          account_id?: string
          account_number?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "it_suppliers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_suppliers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      it_tag_counters: {
        Row: {
          account_id: string
          last_value: number
          prefix: string
        }
        Insert: {
          account_id: string
          last_value?: number
          prefix: string
        }
        Update: {
          account_id?: string
          last_value?: number
          prefix?: string
        }
        Relationships: [
          {
            foreignKeyName: "it_tag_counters_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      labor_benchmark_tiers: {
        Row: {
          account_id: string
          created_at: string
          id: string
          location_id: string | null
          max_cars: number | null
          max_hours: number
          min_cars: number
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          location_id?: string | null
          max_cars?: number | null
          max_hours: number
          min_cars: number
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          location_id?: string | null
          max_cars?: number | null
          max_hours?: number
          min_cars?: number
        }
        Relationships: [
          {
            foreignKeyName: "labor_benchmark_tiers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labor_benchmark_tiers_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          account_id: string
          address: string | null
          archived: boolean
          closeout_time: string
          created_at: string
          downtime_alert_hours: number
          gatherup_business_id: number | null
          geofence_radius_m: number
          google_place_id: string | null
          google_rating: number | null
          google_rating_count: number | null
          google_rating_synced_at: string | null
          id: string
          it_scope: string | null
          latitude: number | null
          longitude: number | null
          maintainx_id: number | null
          name: string
          overtime_threshold_hours: number
          pay_period_type: string
          require_geofence: boolean
          require_punch_photo: boolean
          stripe_connect_account_id: string | null
          timezone: string
          tips_enabled: boolean
        }
        Insert: {
          account_id: string
          address?: string | null
          archived?: boolean
          closeout_time?: string
          created_at?: string
          downtime_alert_hours?: number
          gatherup_business_id?: number | null
          geofence_radius_m?: number
          google_place_id?: string | null
          google_rating?: number | null
          google_rating_count?: number | null
          google_rating_synced_at?: string | null
          id?: string
          it_scope?: string | null
          latitude?: number | null
          longitude?: number | null
          maintainx_id?: number | null
          name: string
          overtime_threshold_hours?: number
          pay_period_type?: string
          require_geofence?: boolean
          require_punch_photo?: boolean
          stripe_connect_account_id?: string | null
          timezone?: string
          tips_enabled?: boolean
        }
        Update: {
          account_id?: string
          address?: string | null
          archived?: boolean
          closeout_time?: string
          created_at?: string
          downtime_alert_hours?: number
          gatherup_business_id?: number | null
          geofence_radius_m?: number
          google_place_id?: string | null
          google_rating?: number | null
          google_rating_count?: number | null
          google_rating_synced_at?: string | null
          id?: string
          it_scope?: string | null
          latitude?: number | null
          longitude?: number | null
          maintainx_id?: number | null
          name?: string
          overtime_threshold_hours?: number
          pay_period_type?: string
          require_geofence?: boolean
          require_punch_photo?: boolean
          stripe_connect_account_id?: string | null
          timezone?: string
          tips_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "locations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      lube_stats_days: {
        Row: {
          account_id: string
          date: string
          net_sales: number
          site_number: number
          synced_at: string
          tax: number
          tickets: number
        }
        Insert: {
          account_id: string
          date: string
          net_sales?: number
          site_number?: number
          synced_at?: string
          tax?: number
          tickets?: number
        }
        Update: {
          account_id?: string
          date?: string
          net_sales?: number
          site_number?: number
          synced_at?: string
          tax?: number
          tickets?: number
        }
        Relationships: [
          {
            foreignKeyName: "lube_stats_days_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      maintainx_wo_outbox: {
        Row: {
          attempts: number
          created_at: string
          id: number
          last_error: string | null
          maintainx_id: number
          op: string
          payload: Json
          processed_at: string | null
          status: string
          work_order_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: never
          last_error?: string | null
          maintainx_id: number
          op: string
          payload?: Json
          processed_at?: string | null
          status?: string
          work_order_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: never
          last_error?: string | null
          maintainx_id?: number
          op?: string
          payload?: Json
          processed_at?: string | null
          status?: string
          work_order_id?: string | null
        }
        Relationships: []
      }
      maintenance_orders: {
        Row: {
          account_id: string
          created_at: string
          id: string
          item: string
          location_id: string | null
          notes: string | null
          photo_paths: string[] | null
          quantity: number
          requested_by: string | null
          requester_name: string | null
          status: string
          status_updated_at: string | null
          tracking_number: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          item: string
          location_id?: string | null
          notes?: string | null
          photo_paths?: string[] | null
          quantity?: number
          requested_by?: string | null
          requester_name?: string | null
          status?: string
          status_updated_at?: string | null
          tracking_number?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          item?: string
          location_id?: string | null
          notes?: string | null
          photo_paths?: string[] | null
          quantity?: number
          requested_by?: string | null
          requester_name?: string | null
          status?: string
          status_updated_at?: string | null
          tracking_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_orders_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      market_research: {
        Row: {
          account_id: string
          competitor_name: string | null
          content: string | null
          created_at: string
          id: string
          location_id: string | null
          research_type: string | null
          source_url: string | null
          submitted_by: string | null
          submitted_by_name: string | null
          title: string
        }
        Insert: {
          account_id: string
          competitor_name?: string | null
          content?: string | null
          created_at?: string
          id?: string
          location_id?: string | null
          research_type?: string | null
          source_url?: string | null
          submitted_by?: string | null
          submitted_by_name?: string | null
          title: string
        }
        Update: {
          account_id?: string
          competitor_name?: string | null
          content?: string | null
          created_at?: string
          id?: string
          location_id?: string | null
          research_type?: string | null
          source_url?: string | null
          submitted_by?: string | null
          submitted_by_name?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_research_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_research_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_research_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      market_research_deals: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          details: string | null
          expires_at: string | null
          id: string
          market_research_id: string
          offer_type: string | null
          price: number | null
          source_url: string | null
          title: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          details?: string | null
          expires_at?: string | null
          id?: string
          market_research_id: string
          offer_type?: string | null
          price?: number | null
          source_url?: string | null
          title: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          details?: string | null
          expires_at?: string | null
          id?: string
          market_research_id?: string
          offer_type?: string | null
          price?: number | null
          source_url?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_research_deals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_research_deals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_research_deals_market_research_id_fkey"
            columns: ["market_research_id"]
            isOneToOne: false
            referencedRelation: "market_research"
            referencedColumns: ["id"]
          },
        ]
      }
      market_research_suggestions: {
        Row: {
          account_id: string
          acknowledged_at: string | null
          acknowledged_by: string | null
          generated_at: string
          id: string
          market_research_id: string
          model: string | null
          severity: string
          suggestion_text: string
        }
        Insert: {
          account_id: string
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          generated_at?: string
          id?: string
          market_research_id: string
          model?: string | null
          severity?: string
          suggestion_text: string
        }
        Update: {
          account_id?: string
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          generated_at?: string
          id?: string
          market_research_id?: string
          model?: string | null
          severity?: string
          suggestion_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_research_suggestions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_research_suggestions_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_research_suggestions_market_research_id_fkey"
            columns: ["market_research_id"]
            isOneToOne: false
            referencedRelation: "market_research"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_connections: {
        Row: {
          account_id: string
          connected_at: string
          last_error: string | null
          provider: string
          secret_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          connected_at?: string
          last_error?: string | null
          provider: string
          secret_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          connected_at?: string
          last_error?: string | null
          provider?: string
          secret_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_connections_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      message_pins: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          message_id: string
          pinned_by: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          message_id: string
          pinned_by: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          message_id?: string
          pinned_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_pins_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_pins_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_pins_pinned_by_fkey"
            columns: ["pinned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          conversation_id: string
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_name: string | null
          attachment_path: string | null
          attachment_type: string | null
          body: string | null
          conversation_id: string
          created_at: string
          edited_at: string | null
          id: string
          parent_id: string | null
          sender_id: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_type?: string | null
          body?: string | null
          conversation_id: string
          created_at?: string
          edited_at?: string | null
          id?: string
          parent_id?: string | null
          sender_id: string
        }
        Update: {
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_type?: string | null
          body?: string | null
          conversation_id?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          parent_id?: string | null
          sender_id?: string
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
            foreignKeyName: "messages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_alerts: {
        Row: {
          account_id: string
          bypass_quiet: boolean
          count_id: string | null
          created_at: string
          dedupe_key: string
          detail: Json | null
          id: string
          kind: string
          location_id: string | null
          message: string
          part_id: string | null
          sent_at: string | null
          status: string
          target_user_id: string | null
          tool_id: string | null
        }
        Insert: {
          account_id: string
          bypass_quiet?: boolean
          count_id?: string | null
          created_at?: string
          dedupe_key: string
          detail?: Json | null
          id?: string
          kind: string
          location_id?: string | null
          message: string
          part_id?: string | null
          sent_at?: string | null
          status?: string
          target_user_id?: string | null
          tool_id?: string | null
        }
        Update: {
          account_id?: string
          bypass_quiet?: boolean
          count_id?: string | null
          created_at?: string
          dedupe_key?: string
          detail?: Json | null
          id?: string
          kind?: string
          location_id?: string | null
          message?: string
          part_id?: string | null
          sent_at?: string | null
          status?: string
          target_user_id?: string | null
          tool_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mi_alerts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_alerts_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "mi_cycle_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_alerts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "mi_stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_alerts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_alerts_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "mi_tools"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_areas: {
        Row: {
          account_id: string
          id: string
          name: string
          site_id: string
          sort_order: number
        }
        Insert: {
          account_id: string
          id?: string
          name: string
          site_id: string
          sort_order?: number
        }
        Update: {
          account_id?: string
          id?: string
          name?: string
          site_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "mi_areas_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_areas_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_attachments: {
        Row: {
          account_id: string
          created_at: string
          entity_id: string
          entity_type: string
          file_name: string | null
          id: string
          kind: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          entity_id: string
          entity_type: string
          file_name?: string | null
          id?: string
          kind?: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          file_name?: string | null
          id?: string
          kind?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mi_attachments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_audit_items: {
        Row: {
          account_id: string
          checked_at: string | null
          checked_by: string | null
          checked_by_name: string | null
          equipment_id: string | null
          expected: boolean
          found_area_id: string | null
          id: string
          listed_area_id: string | null
          note: string | null
          other_site_id: string | null
          result: string
          run_id: string
          sticker_condition: string | null
          tag: string | null
        }
        Insert: {
          account_id: string
          checked_at?: string | null
          checked_by?: string | null
          checked_by_name?: string | null
          equipment_id?: string | null
          expected: boolean
          found_area_id?: string | null
          id?: string
          listed_area_id?: string | null
          note?: string | null
          other_site_id?: string | null
          result?: string
          run_id: string
          sticker_condition?: string | null
          tag?: string | null
        }
        Update: {
          account_id?: string
          checked_at?: string | null
          checked_by?: string | null
          checked_by_name?: string | null
          equipment_id?: string | null
          expected?: boolean
          found_area_id?: string | null
          id?: string
          listed_area_id?: string | null
          note?: string | null
          other_site_id?: string | null
          result?: string
          run_id?: string
          sticker_condition?: string | null
          tag?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mi_audit_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_audit_items_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_audit_items_found_area_id_fkey"
            columns: ["found_area_id"]
            isOneToOne: false
            referencedRelation: "mi_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_audit_items_listed_area_id_fkey"
            columns: ["listed_area_id"]
            isOneToOne: false
            referencedRelation: "mi_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_audit_items_other_site_id_fkey"
            columns: ["other_site_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_audit_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "mi_audit_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_audit_runs: {
        Row: {
          account_id: string
          completed_at: string | null
          completed_by: string | null
          completed_by_name: string | null
          id: string
          location_id: string
          note: string | null
          scope: string
          started_at: string
          started_by: string | null
          started_by_name: string | null
          status: string
          summary: Json | null
        }
        Insert: {
          account_id: string
          completed_at?: string | null
          completed_by?: string | null
          completed_by_name?: string | null
          id?: string
          location_id: string
          note?: string | null
          scope?: string
          started_at?: string
          started_by?: string | null
          started_by_name?: string | null
          status?: string
          summary?: Json | null
        }
        Update: {
          account_id?: string
          completed_at?: string | null
          completed_by?: string | null
          completed_by_name?: string | null
          id?: string
          location_id?: string
          note?: string | null
          scope?: string
          started_at?: string
          started_by?: string | null
          started_by_name?: string | null
          status?: string
          summary?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "mi_audit_runs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_audit_runs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_bins: {
        Row: {
          account_id: string
          created_at: string
          id: string
          location_id: string
          name: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          location_id: string
          name: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          location_id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_bins_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_bins_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "mi_stock_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_cycle_count_lines: {
        Row: {
          approved_by: string | null
          bin_id: string | null
          count_id: string
          counted_at: string | null
          counted_by: string | null
          counted_qty: number | null
          expected_qty: number
          id: string
          part_id: string
          posted: boolean
          reason_code: string | null
          unit_cost: number
          variance_qty: number | null
        }
        Insert: {
          approved_by?: string | null
          bin_id?: string | null
          count_id: string
          counted_at?: string | null
          counted_by?: string | null
          counted_qty?: number | null
          expected_qty: number
          id?: string
          part_id: string
          posted?: boolean
          reason_code?: string | null
          unit_cost?: number
          variance_qty?: number | null
        }
        Update: {
          approved_by?: string | null
          bin_id?: string | null
          count_id?: string
          counted_at?: string | null
          counted_by?: string | null
          counted_qty?: number | null
          expected_qty?: number
          id?: string
          part_id?: string
          posted?: boolean
          reason_code?: string | null
          unit_cost?: number
          variance_qty?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mi_cycle_count_lines_bin_id_fkey"
            columns: ["bin_id"]
            isOneToOne: false
            referencedRelation: "mi_bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_cycle_count_lines_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "mi_cycle_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_cycle_count_lines_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_cycle_counts: {
        Row: {
          account_id: string
          blind: boolean
          created_at: string
          created_by: string | null
          due_date: string | null
          forced: boolean
          id: string
          is_sample: boolean
          location_id: string
          notes: string | null
          number: number
          posted_at: string | null
          posted_by: string | null
          scheduled: boolean
          scope_type: string
          scope_value: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
        }
        Insert: {
          account_id: string
          blind?: boolean
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          forced?: boolean
          id?: string
          is_sample?: boolean
          location_id: string
          notes?: string | null
          number: number
          posted_at?: string | null
          posted_by?: string | null
          scheduled?: boolean
          scope_type?: string
          scope_value?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Update: {
          account_id?: string
          blind?: boolean
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          forced?: boolean
          id?: string
          is_sample?: boolean
          location_id?: string
          notes?: string | null
          number?: number
          posted_at?: string | null
          posted_by?: string | null
          scheduled?: boolean
          scope_type?: string
          scope_value?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mi_cycle_counts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_cycle_counts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "mi_stock_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_equipment_events: {
        Row: {
          account_id: string
          action: string
          actor_name: string | null
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          equipment_id: string
          id: string
          location_id: string | null
          note: string | null
        }
        Insert: {
          account_id: string
          action: string
          actor_name?: string | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          equipment_id: string
          id?: string
          location_id?: string | null
          note?: string | null
        }
        Update: {
          account_id?: string
          action?: string
          actor_name?: string | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          equipment_id?: string
          id?: string
          location_id?: string | null
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mi_equipment_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_idempotency: {
        Row: {
          account_id: string
          client_txn_id: string
          created_at: string
          created_by: string | null
          result: Json | null
        }
        Insert: {
          account_id: string
          client_txn_id: string
          created_at?: string
          created_by?: string | null
          result?: Json | null
        }
        Update: {
          account_id?: string
          client_txn_id?: string
          created_at?: string
          created_by?: string | null
          result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "mi_idempotency_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_inventory_transactions: {
        Row: {
          account_id: string
          asset_id: string | null
          client_txn_id: string | null
          count_id: string | null
          created_at: string
          id: string
          is_sample: boolean
          location_id: string
          notes: string | null
          part_id: string
          performed_by: string | null
          po_line_id: string | null
          qty: number
          qty_after: number
          qty_before: number
          reason_code: string | null
          source: string
          transfer_id: string | null
          type: string
          unit_cost: number
          work_order_id: string | null
        }
        Insert: {
          account_id: string
          asset_id?: string | null
          client_txn_id?: string | null
          count_id?: string | null
          created_at?: string
          id?: string
          is_sample?: boolean
          location_id: string
          notes?: string | null
          part_id: string
          performed_by?: string | null
          po_line_id?: string | null
          qty: number
          qty_after: number
          qty_before: number
          reason_code?: string | null
          source?: string
          transfer_id?: string | null
          type: string
          unit_cost?: number
          work_order_id?: string | null
        }
        Update: {
          account_id?: string
          asset_id?: string | null
          client_txn_id?: string | null
          count_id?: string | null
          created_at?: string
          id?: string
          is_sample?: boolean
          location_id?: string
          notes?: string | null
          part_id?: string
          performed_by?: string | null
          po_line_id?: string | null
          qty?: number
          qty_after?: number
          qty_before?: number
          reason_code?: string | null
          source?: string
          transfer_id?: string | null
          type?: string
          unit_cost?: number
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mi_inventory_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_inventory_transactions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_inventory_transactions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "mi_stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_inventory_transactions_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_inventory_transactions_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_ledger_count"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "mi_cycle_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_ledger_po_line"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "mi_po_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_ledger_transfer"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "mi_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_kit_items: {
        Row: {
          kit_id: string
          part_id: string
          qty: number
        }
        Insert: {
          kit_id: string
          part_id: string
          qty?: number
        }
        Update: {
          kit_id?: string
          part_id?: string
          qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "mi_kit_items_kit_id_fkey"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "mi_kits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_kit_items_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_kits: {
        Row: {
          account_id: string
          description: string | null
          id: string
          is_sample: boolean
          kind: string
          name: string
        }
        Insert: {
          account_id: string
          description?: string | null
          id?: string
          is_sample?: boolean
          kind?: string
          name: string
        }
        Update: {
          account_id?: string
          description?: string | null
          id?: string
          is_sample?: boolean
          kind?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_kits_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_log_entries: {
        Row: {
          account_id: string
          asset_id: string | null
          cars_since_last: number | null
          client_txn_id: string | null
          created_at: string
          created_by: string | null
          downtime_minutes: number | null
          due_date: string | null
          entry_type: string
          follow_up_work_order_id: string | null
          id: string
          is_sample: boolean
          labor_minutes: number | null
          notes: string | null
          on_time: boolean | null
          outside_cost: number | null
          performed_at: string
          performed_by: string | null
          performed_by_name: string | null
          prev_last_done_at: string | null
          prev_next_due_date: string | null
          resets_usage: boolean
          result: string
          schedule_id: string | null
          site_id: string
          source: string
          title: string
          updated_at: string
          vendor_id: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          work_order_id: string | null
        }
        Insert: {
          account_id: string
          asset_id?: string | null
          cars_since_last?: number | null
          client_txn_id?: string | null
          created_at?: string
          created_by?: string | null
          downtime_minutes?: number | null
          due_date?: string | null
          entry_type: string
          follow_up_work_order_id?: string | null
          id?: string
          is_sample?: boolean
          labor_minutes?: number | null
          notes?: string | null
          on_time?: boolean | null
          outside_cost?: number | null
          performed_at?: string
          performed_by?: string | null
          performed_by_name?: string | null
          prev_last_done_at?: string | null
          prev_next_due_date?: string | null
          resets_usage?: boolean
          result?: string
          schedule_id?: string | null
          site_id: string
          source?: string
          title: string
          updated_at?: string
          vendor_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          work_order_id?: string | null
        }
        Update: {
          account_id?: string
          asset_id?: string | null
          cars_since_last?: number | null
          client_txn_id?: string | null
          created_at?: string
          created_by?: string | null
          downtime_minutes?: number | null
          due_date?: string | null
          entry_type?: string
          follow_up_work_order_id?: string | null
          id?: string
          is_sample?: boolean
          labor_minutes?: number | null
          notes?: string | null
          on_time?: boolean | null
          outside_cost?: number | null
          performed_at?: string
          performed_by?: string | null
          performed_by_name?: string | null
          prev_last_done_at?: string | null
          prev_next_due_date?: string | null
          resets_usage?: boolean
          result?: string
          schedule_id?: string | null
          site_id?: string
          source?: string
          title?: string
          updated_at?: string
          vendor_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mi_log_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_log_entries_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_log_entries_follow_up_work_order_id_fkey"
            columns: ["follow_up_work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_log_entries_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_log_entries_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "mi_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_log_entries_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_log_entries_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_log_entries_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_log_entry_parts: {
        Row: {
          created_at: string
          entry_id: string
          id: string
          ledger_id: string | null
          location_id: string | null
          part_id: string
          qty: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          entry_id: string
          id?: string
          ledger_id?: string | null
          location_id?: string | null
          part_id: string
          qty: number
          unit_cost?: number
        }
        Update: {
          created_at?: string
          entry_id?: string
          id?: string
          ledger_id?: string | null
          location_id?: string | null
          part_id?: string
          qty?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "mi_log_entry_parts_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "mi_log_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_log_entry_parts_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "mi_inventory_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_log_entry_parts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "mi_stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_log_entry_parts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_members: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          region_names: string[]
          role: string
          site_ids: string[]
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          region_names?: string[]
          role: string
          site_ids?: string[]
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          region_names?: string[]
          role?: string
          site_ids?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_members_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_part_categories: {
        Row: {
          account_id: string
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "mi_part_categories_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_part_requests: {
        Row: {
          account_id: string
          barcode: string | null
          created_part_id: string | null
          decided_at: string | null
          decided_by: string | null
          id: string
          manufacturer: string | null
          mfr_part_number: string | null
          name: string
          notes: string | null
          requested_at: string
          requested_by: string | null
          status: string
        }
        Insert: {
          account_id: string
          barcode?: string | null
          created_part_id?: string | null
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          manufacturer?: string | null
          mfr_part_number?: string | null
          name: string
          notes?: string | null
          requested_at?: string
          requested_by?: string | null
          status?: string
        }
        Update: {
          account_id?: string
          barcode?: string | null
          created_part_id?: string | null
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          manufacturer?: string | null
          mfr_part_number?: string | null
          name?: string
          notes?: string | null
          requested_at?: string
          requested_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_part_requests_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_part_requests_created_part_id_fkey"
            columns: ["created_part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_part_vendors: {
        Row: {
          account_id: string
          id: string
          lead_time_days: number | null
          pack_qty: number
          part_id: string
          preferred: boolean
          price: number | null
          vendor_id: string
          vendor_part_number: string | null
        }
        Insert: {
          account_id: string
          id?: string
          lead_time_days?: number | null
          pack_qty?: number
          part_id: string
          preferred?: boolean
          price?: number | null
          vendor_id: string
          vendor_part_number?: string | null
        }
        Update: {
          account_id?: string
          id?: string
          lead_time_days?: number | null
          pack_qty?: number
          part_id?: string
          preferred?: boolean
          price?: number | null
          vendor_id?: string
          vendor_part_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mi_part_vendors_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_part_vendors_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_part_vendors_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_po_lines: {
        Row: {
          id: string
          normal_unit_cost: number | null
          notes: string | null
          part_id: string
          po_id: string
          qty_ordered: number
          qty_received: number
          unit_cost: number
          vendor_part_number: string | null
        }
        Insert: {
          id?: string
          normal_unit_cost?: number | null
          notes?: string | null
          part_id: string
          po_id: string
          qty_ordered: number
          qty_received?: number
          unit_cost?: number
          vendor_part_number?: string | null
        }
        Update: {
          id?: string
          normal_unit_cost?: number | null
          notes?: string | null
          part_id?: string
          po_id?: string
          qty_ordered?: number
          qty_received?: number
          unit_cost?: number
          vendor_part_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mi_po_lines_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_po_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "mi_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_purchase_orders: {
        Row: {
          account_id: string
          approved_at: string | null
          approved_by: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          is_sample: boolean
          notes: string | null
          number: number
          sent_at: string | null
          sent_by: string | null
          sent_to: string | null
          ship_to_location_id: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          urgent: boolean
          vendor_id: string
        }
        Insert: {
          account_id: string
          approved_at?: string | null
          approved_by?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_sample?: boolean
          notes?: string | null
          number: number
          sent_at?: string | null
          sent_by?: string | null
          sent_to?: string | null
          ship_to_location_id: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          urgent?: boolean
          vendor_id: string
        }
        Update: {
          account_id?: string
          approved_at?: string | null
          approved_by?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_sample?: boolean
          notes?: string | null
          number?: number
          sent_at?: string | null
          sent_by?: string | null
          sent_to?: string | null
          ship_to_location_id?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          urgent?: boolean
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_purchase_orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_purchase_orders_ship_to_location_id_fkey"
            columns: ["ship_to_location_id"]
            isOneToOne: false
            referencedRelation: "mi_stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_receipt_lines: {
        Row: {
          bin_id: string | null
          id: string
          part_id: string
          po_line_id: string | null
          qty: number
          receipt_id: string
          unit_cost: number
        }
        Insert: {
          bin_id?: string | null
          id?: string
          part_id: string
          po_line_id?: string | null
          qty: number
          receipt_id: string
          unit_cost?: number
        }
        Update: {
          bin_id?: string | null
          id?: string
          part_id?: string
          po_line_id?: string | null
          qty?: number
          receipt_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "mi_receipt_lines_bin_id_fkey"
            columns: ["bin_id"]
            isOneToOne: false
            referencedRelation: "mi_bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_receipt_lines_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_receipt_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "mi_po_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_receipt_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "mi_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_receipts: {
        Row: {
          account_id: string
          id: string
          location_id: string
          notes: string | null
          packing_slip_path: string | null
          po_id: string | null
          received_at: string
          received_by: string | null
        }
        Insert: {
          account_id: string
          id?: string
          location_id: string
          notes?: string | null
          packing_slip_path?: string | null
          po_id?: string | null
          received_at?: string
          received_by?: string | null
        }
        Update: {
          account_id?: string
          id?: string
          location_id?: string
          notes?: string | null
          packing_slip_path?: string | null
          po_id?: string | null
          received_at?: string
          received_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mi_receipts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_receipts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "mi_stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_receipts_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "mi_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_saved_views: {
        Row: {
          account_id: string
          created_at: string
          entity: string
          id: string
          is_shared: boolean
          name: string
          params: Json
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          entity?: string
          id?: string
          is_shared?: boolean
          name: string
          params?: Json
          user_id?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          entity?: string
          id?: string
          is_shared?: boolean
          name?: string
          params?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_saved_views_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_saved_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_schedule_parts: {
        Row: {
          part_id: string
          qty: number
          schedule_id: string
        }
        Insert: {
          part_id: string
          qty: number
          schedule_id: string
        }
        Update: {
          part_id?: string
          qty?: number
          schedule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_schedule_parts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_schedule_parts_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "mi_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_schedules: {
        Row: {
          account_id: string
          active: boolean
          archived_at: string | null
          asset_id: string | null
          assigned_user_id: string | null
          auto_work_order: boolean
          created_at: string
          created_by: string | null
          every_cars: number | null
          every_n: number | null
          every_unit: string | null
          id: string
          instructions: string | null
          is_sample: boolean
          last_done_at: string | null
          next_due_date: string | null
          priority: string
          site_id: string
          soon_days: number
          start_date: string
          task_type: string
          title: string
          updated_at: string
        }
        Insert: {
          account_id: string
          active?: boolean
          archived_at?: string | null
          asset_id?: string | null
          assigned_user_id?: string | null
          auto_work_order?: boolean
          created_at?: string
          created_by?: string | null
          every_cars?: number | null
          every_n?: number | null
          every_unit?: string | null
          id?: string
          instructions?: string | null
          is_sample?: boolean
          last_done_at?: string | null
          next_due_date?: string | null
          priority?: string
          site_id: string
          soon_days?: number
          start_date?: string
          task_type?: string
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          active?: boolean
          archived_at?: string | null
          asset_id?: string | null
          assigned_user_id?: string | null
          auto_work_order?: boolean
          created_at?: string
          created_by?: string | null
          every_cars?: number | null
          every_n?: number | null
          every_unit?: string | null
          id?: string
          instructions?: string | null
          is_sample?: boolean
          last_done_at?: string | null
          next_due_date?: string | null
          priority?: string
          site_id?: string
          soon_days?: number
          start_date?: string
          task_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_schedules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_schedules_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_schedules_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_schedules_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_settings: {
        Row: {
          account_id: string
          auto_counts_enabled: boolean
          carrying_rate: number
          count_schedule: Json
          count_tolerance_pct: number
          count_variance_threshold: number
          high_value_photo_cost: number | null
          po_limits: Json
          quiet_end_hour: number
          quiet_start_hour: number
          sms_enabled: boolean
          stale_days: number
          timezone: string
          updated_at: string
        }
        Insert: {
          account_id: string
          auto_counts_enabled?: boolean
          carrying_rate?: number
          count_schedule?: Json
          count_tolerance_pct?: number
          count_variance_threshold?: number
          high_value_photo_cost?: number | null
          po_limits?: Json
          quiet_end_hour?: number
          quiet_start_hour?: number
          sms_enabled?: boolean
          stale_days?: number
          timezone?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          auto_counts_enabled?: boolean
          carrying_rate?: number
          count_schedule?: Json
          count_tolerance_pct?: number
          count_variance_threshold?: number
          high_value_photo_cost?: number | null
          po_limits?: Json
          quiet_end_hour?: number
          quiet_start_hour?: number
          sms_enabled?: boolean
          stale_days?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_site_kits: {
        Row: {
          account_id: string
          kit_id: string
          site_id: string
          tunnels: number
        }
        Insert: {
          account_id: string
          kit_id: string
          site_id: string
          tunnels?: number
        }
        Update: {
          account_id?: string
          kit_id?: string
          site_id?: string
          tunnels?: number
        }
        Relationships: [
          {
            foreignKeyName: "mi_site_kits_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_site_kits_kit_id_fkey"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "mi_kits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_site_kits_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_site_settings: {
        Row: {
          account_id: string
          allow_negative: boolean
          site_id: string
        }
        Insert: {
          account_id: string
          allow_negative?: boolean
          site_id: string
        }
        Update: {
          account_id?: string
          allow_negative?: boolean
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_site_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_site_settings_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_stock_levels: {
        Row: {
          account_id: string
          available: number | null
          avg_cost: number
          bin_id: string | null
          id: string
          is_sample: boolean
          last_counted_at: string | null
          last_moved_at: string | null
          location_id: string
          max_qty: number | null
          min_qty: number | null
          on_hand: number
          part_id: string
          reorder_point: number | null
          reserved: number
        }
        Insert: {
          account_id: string
          available?: number | null
          avg_cost?: number
          bin_id?: string | null
          id?: string
          is_sample?: boolean
          last_counted_at?: string | null
          last_moved_at?: string | null
          location_id: string
          max_qty?: number | null
          min_qty?: number | null
          on_hand?: number
          part_id: string
          reorder_point?: number | null
          reserved?: number
        }
        Update: {
          account_id?: string
          available?: number | null
          avg_cost?: number
          bin_id?: string | null
          id?: string
          is_sample?: boolean
          last_counted_at?: string | null
          last_moved_at?: string | null
          location_id?: string
          max_qty?: number | null
          min_qty?: number | null
          on_hand?: number
          part_id?: string
          reorder_point?: number | null
          reserved?: number
        }
        Relationships: [
          {
            foreignKeyName: "mi_stock_levels_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_stock_levels_bin_id_fkey"
            columns: ["bin_id"]
            isOneToOne: false
            referencedRelation: "mi_bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_stock_levels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "mi_stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_stock_levels_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_stock_locations: {
        Row: {
          account_id: string
          active: boolean
          assigned_user_id: string | null
          created_at: string
          id: string
          is_sample: boolean
          name: string
          region_name: string | null
          site_id: string | null
          type: string
        }
        Insert: {
          account_id: string
          active?: boolean
          assigned_user_id?: string | null
          created_at?: string
          id?: string
          is_sample?: boolean
          name: string
          region_name?: string | null
          site_id?: string | null
          type: string
        }
        Update: {
          account_id?: string
          active?: boolean
          assigned_user_id?: string | null
          created_at?: string
          id?: string
          is_sample?: boolean
          name?: string
          region_name?: string | null
          site_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_stock_locations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_stock_locations_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_stock_locations_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_tags: {
        Row: {
          account_id: string
          applied_at: string | null
          batch_id: string | null
          code: string
          condition: string | null
          condition_at: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          former_entity_id: string | null
          id: string
          last_printed_at: string | null
          printed_count: number
          retired_at: string | null
          site_id: string | null
          source: string
          status: string
        }
        Insert: {
          account_id: string
          applied_at?: string | null
          batch_id?: string | null
          code: string
          condition?: string | null
          condition_at?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          former_entity_id?: string | null
          id?: string
          last_printed_at?: string | null
          printed_count?: number
          retired_at?: string | null
          site_id?: string | null
          source?: string
          status?: string
        }
        Update: {
          account_id?: string
          applied_at?: string | null
          batch_id?: string | null
          code?: string
          condition?: string | null
          condition_at?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          former_entity_id?: string | null
          id?: string
          last_printed_at?: string | null
          printed_count?: number
          retired_at?: string | null
          site_id?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_tags_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_tags_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_tool_audit_lines: {
        Row: {
          audit_id: string
          condition: string | null
          found: boolean | null
          scanned_at: string | null
          tool_id: string
        }
        Insert: {
          audit_id: string
          condition?: string | null
          found?: boolean | null
          scanned_at?: string | null
          tool_id: string
        }
        Update: {
          audit_id?: string
          condition?: string | null
          found?: boolean | null
          scanned_at?: string | null
          tool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_tool_audit_lines_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "mi_tool_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_tool_audit_lines_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "mi_tools"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_tool_audits: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          finished_at: string | null
          id: string
          location_id: string
          status: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          location_id: string
          status?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          location_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_tool_audits_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_tool_audits_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "mi_stock_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_tool_checkouts: {
        Row: {
          account_id: string
          action: string
          client_txn_id: string | null
          condition: string | null
          created_at: string
          due_at: string | null
          from_location_id: string | null
          from_user_id: string | null
          id: string
          notes: string | null
          performed_by: string | null
          source: string
          status: string | null
          to_location_id: string | null
          to_user_id: string | null
          tool_id: string
        }
        Insert: {
          account_id: string
          action: string
          client_txn_id?: string | null
          condition?: string | null
          created_at?: string
          due_at?: string | null
          from_location_id?: string | null
          from_user_id?: string | null
          id?: string
          notes?: string | null
          performed_by?: string | null
          source?: string
          status?: string | null
          to_location_id?: string | null
          to_user_id?: string | null
          tool_id: string
        }
        Update: {
          account_id?: string
          action?: string
          client_txn_id?: string | null
          condition?: string | null
          created_at?: string
          due_at?: string | null
          from_location_id?: string | null
          from_user_id?: string | null
          id?: string
          notes?: string | null
          performed_by?: string | null
          source?: string
          status?: string | null
          to_location_id?: string | null
          to_user_id?: string | null
          tool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_tool_checkouts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_tool_checkouts_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "mi_tools"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_tools: {
        Row: {
          account_id: string
          category: string | null
          checked_out_at: string | null
          condition: string
          cost: number | null
          created_at: string
          created_by: string | null
          custodian_location_id: string | null
          custodian_user_id: string | null
          due_at: string | null
          home_location_id: string
          id: string
          is_sample: boolean
          make: string | null
          model: string | null
          name: string
          notes: string | null
          pending_at: string | null
          pending_from_user_id: string | null
          pending_to_location_id: string | null
          pending_to_user_id: string | null
          photo_path: string | null
          serial_number: string | null
          status: string
        }
        Insert: {
          account_id: string
          category?: string | null
          checked_out_at?: string | null
          condition?: string
          cost?: number | null
          created_at?: string
          created_by?: string | null
          custodian_location_id?: string | null
          custodian_user_id?: string | null
          due_at?: string | null
          home_location_id: string
          id?: string
          is_sample?: boolean
          make?: string | null
          model?: string | null
          name: string
          notes?: string | null
          pending_at?: string | null
          pending_from_user_id?: string | null
          pending_to_location_id?: string | null
          pending_to_user_id?: string | null
          photo_path?: string | null
          serial_number?: string | null
          status?: string
        }
        Update: {
          account_id?: string
          category?: string | null
          checked_out_at?: string | null
          condition?: string
          cost?: number | null
          created_at?: string
          created_by?: string | null
          custodian_location_id?: string | null
          custodian_user_id?: string | null
          due_at?: string | null
          home_location_id?: string
          id?: string
          is_sample?: boolean
          make?: string | null
          model?: string | null
          name?: string
          notes?: string | null
          pending_at?: string | null
          pending_from_user_id?: string | null
          pending_to_location_id?: string | null
          pending_to_user_id?: string | null
          photo_path?: string | null
          serial_number?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_tools_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_tools_custodian_location_id_fkey"
            columns: ["custodian_location_id"]
            isOneToOne: false
            referencedRelation: "mi_stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_tools_custodian_user_id_fkey"
            columns: ["custodian_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_tools_home_location_id_fkey"
            columns: ["home_location_id"]
            isOneToOne: false
            referencedRelation: "mi_stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_tools_pending_to_location_id_fkey"
            columns: ["pending_to_location_id"]
            isOneToOne: false
            referencedRelation: "mi_stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_tools_pending_to_user_id_fkey"
            columns: ["pending_to_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_transfer_lines: {
        Row: {
          id: string
          part_id: string
          qty_received: number
          qty_requested: number
          qty_shipped: number
          transfer_id: string
          unit_cost: number
          variance_notes: string | null
          variance_qty: number | null
        }
        Insert: {
          id?: string
          part_id: string
          qty_received?: number
          qty_requested: number
          qty_shipped?: number
          transfer_id: string
          unit_cost?: number
          variance_notes?: string | null
          variance_qty?: number | null
        }
        Update: {
          id?: string
          part_id?: string
          qty_received?: number
          qty_requested?: number
          qty_shipped?: number
          transfer_id?: string
          unit_cost?: number
          variance_notes?: string | null
          variance_qty?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mi_transfer_lines_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_transfer_lines_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "mi_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_transfers: {
        Row: {
          account_id: string
          approved_at: string | null
          approved_by: string | null
          from_location_id: string
          id: string
          is_sample: boolean
          notes: string | null
          number: number
          received_at: string | null
          received_by: string | null
          requested_at: string
          requested_by: string | null
          shipped_at: string | null
          shipped_by: string | null
          status: string
          to_location_id: string
        }
        Insert: {
          account_id: string
          approved_at?: string | null
          approved_by?: string | null
          from_location_id: string
          id?: string
          is_sample?: boolean
          notes?: string | null
          number: number
          received_at?: string | null
          received_by?: string | null
          requested_at?: string
          requested_by?: string | null
          shipped_at?: string | null
          shipped_by?: string | null
          status?: string
          to_location_id: string
        }
        Update: {
          account_id?: string
          approved_at?: string | null
          approved_by?: string | null
          from_location_id?: string
          id?: string
          is_sample?: boolean
          notes?: string | null
          number?: number
          received_at?: string | null
          received_by?: string | null
          requested_at?: string
          requested_by?: string | null
          shipped_at?: string | null
          shipped_by?: string | null
          status?: string
          to_location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mi_transfers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_transfers_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "mi_stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_transfers_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "mi_stock_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_tunnel_items: {
        Row: {
          account_id: string
          asset_id: string | null
          created_at: string
          h_ft: number
          id: string
          kind: string
          label: string
          layout_id: string
          match_type: string | null
          props: Json
          rotation: number
          side: string
          sort_order: number
          w_ft: number
          x_ft: number
          y_ft: number
          zone: string | null
        }
        Insert: {
          account_id: string
          asset_id?: string | null
          created_at?: string
          h_ft?: number
          id?: string
          kind: string
          label?: string
          layout_id: string
          match_type?: string | null
          props?: Json
          rotation?: number
          side?: string
          sort_order?: number
          w_ft?: number
          x_ft?: number
          y_ft?: number
          zone?: string | null
        }
        Update: {
          account_id?: string
          asset_id?: string | null
          created_at?: string
          h_ft?: number
          id?: string
          kind?: string
          label?: string
          layout_id?: string
          match_type?: string | null
          props?: Json
          rotation?: number
          side?: string
          sort_order?: number
          w_ft?: number
          x_ft?: number
          y_ft?: number
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mi_tunnel_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_tunnel_items_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_tunnel_items_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "mi_tunnel_layouts"
            referencedColumns: ["id"]
          },
        ]
      }
      mi_tunnel_layouts: {
        Row: {
          account_id: string
          based_on: string | null
          created_at: string
          created_by: string | null
          id: string
          is_template: boolean
          length_ft: number
          location_id: string | null
          name: string
          tunnel_no: number
          updated_at: string
          updated_by: string | null
          version: number
          width_ft: number
          zones: Json
        }
        Insert: {
          account_id: string
          based_on?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_template?: boolean
          length_ft?: number
          location_id?: string | null
          name: string
          tunnel_no?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
          width_ft?: number
          zones?: Json
        }
        Update: {
          account_id?: string
          based_on?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_template?: boolean
          length_ft?: number
          location_id?: string | null
          name?: string
          tunnel_no?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
          width_ft?: number
          zones?: Json
        }
        Relationships: [
          {
            foreignKeyName: "mi_tunnel_layouts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_tunnel_layouts_based_on_fkey"
            columns: ["based_on"]
            isOneToOne: false
            referencedRelation: "mi_tunnel_layouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mi_tunnel_layouts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      mileage_requests: {
        Row: {
          account_id: string
          amount: number
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          business_unit: string | null
          category: string | null
          created_at: string
          currency: string
          department: string | null
          description: string | null
          end_date: string | null
          expense_date: string
          id: string
          miles: number
          policy: string | null
          rate: number
          requested_by: string | null
          requested_by_name: string | null
          round_trip: boolean
          status: string
          stops: Json
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          business_unit?: string | null
          category?: string | null
          created_at?: string
          currency?: string
          department?: string | null
          description?: string | null
          end_date?: string | null
          expense_date?: string
          id?: string
          miles?: number
          policy?: string | null
          rate?: number
          requested_by?: string | null
          requested_by_name?: string | null
          round_trip?: boolean
          status?: string
          stops?: Json
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          business_unit?: string | null
          category?: string | null
          created_at?: string
          currency?: string
          department?: string | null
          description?: string | null
          end_date?: string | null
          expense_date?: string
          id?: string
          miles?: number
          policy?: string | null
          rate?: number
          requested_by?: string | null
          requested_by_name?: string | null
          round_trip?: boolean
          status?: string
          stops?: Json
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mileage_requests_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          kind: string
          payload: Json
          read_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          read_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_clients: {
        Row: {
          client_id: string
          provider: string
          redirect_uris: string[]
          registered_at: string
          secret_id: string | null
        }
        Insert: {
          client_id: string
          provider: string
          redirect_uris: string[]
          registered_at?: string
          secret_id?: string | null
        }
        Update: {
          client_id?: string
          provider?: string
          redirect_uris?: string[]
          registered_at?: string
          secret_id?: string | null
        }
        Relationships: []
      }
      oauth_states: {
        Row: {
          code_verifier: string
          created_at: string
          provider: string
          redirect_uri: string
          state: string
          user_id: string
        }
        Insert: {
          code_verifier: string
          created_at?: string
          provider: string
          redirect_uri: string
          state: string
          user_id: string
        }
        Update: {
          code_verifier?: string
          created_at?: string
          provider?: string
          redirect_uri?: string
          state?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_states_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_templates: {
        Row: {
          account_id: string
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          steps: Json
          updated_at: string
        }
        Insert: {
          account_id: string
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          steps?: Json
          updated_at?: string
        }
        Update: {
          account_id?: string
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          steps?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_attachments: {
        Row: {
          account_id: string
          created_at: string
          data_uri: string
          entity_id: string
          entity_type: string
          file_name: string | null
          file_type: string | null
          id: string
          label: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          data_uri: string
          entity_id: string
          entity_type: string
          file_name?: string | null
          file_type?: string | null
          id?: string
          label?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          data_uri?: string
          entity_id?: string
          entity_type?: string
          file_name?: string | null
          file_type?: string | null
          id?: string
          label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_attachments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_invoices: {
        Row: {
          account_id: string
          amount: number
          approver_ids: string[]
          approver_names: string[]
          assigned_at: string | null
          assigned_to: string | null
          assigned_to_name: string | null
          awaiting_secondary: boolean
          class_names: string[]
          decided_at: string | null
          decided_by: string | null
          decided_by_name: string | null
          decision_reason: string | null
          due_date: string | null
          duplicate_of: string | null
          email_attachment_key: string | null
          email_from: string | null
          email_message_id: string | null
          email_subject: string | null
          exported_at: string | null
          exported_by: string | null
          exported_by_name: string | null
          file_name: string | null
          file_path: string | null
          file_type: string | null
          first_approved_at: string | null
          first_approved_by: string | null
          first_approved_by_name: string | null
          gl_allocations: Json | null
          gl_code: string | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          location_id: string | null
          location_ids: string[]
          memo: string | null
          notify_status: string | null
          reminder_sent_at: string | null
          resubmit_by_name: string | null
          resubmit_note: string | null
          secondary_approver_ids: string[]
          secondary_approver_names: string[]
          site_allocations: Json
          status: string
          submitted_at: string
          submitted_by: string | null
          submitted_by_name: string | null
          vendor_name: string | null
          verified_at: string | null
          verified_by: string | null
          verified_by_name: string | null
        }
        Insert: {
          account_id: string
          amount?: number
          approver_ids?: string[]
          approver_names?: string[]
          assigned_at?: string | null
          assigned_to?: string | null
          assigned_to_name?: string | null
          awaiting_secondary?: boolean
          class_names?: string[]
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          decision_reason?: string | null
          due_date?: string | null
          duplicate_of?: string | null
          email_attachment_key?: string | null
          email_from?: string | null
          email_message_id?: string | null
          email_subject?: string | null
          exported_at?: string | null
          exported_by?: string | null
          exported_by_name?: string | null
          file_name?: string | null
          file_path?: string | null
          file_type?: string | null
          first_approved_at?: string | null
          first_approved_by?: string | null
          first_approved_by_name?: string | null
          gl_allocations?: Json | null
          gl_code?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          location_id?: string | null
          location_ids?: string[]
          memo?: string | null
          notify_status?: string | null
          reminder_sent_at?: string | null
          resubmit_by_name?: string | null
          resubmit_note?: string | null
          secondary_approver_ids?: string[]
          secondary_approver_names?: string[]
          site_allocations?: Json
          status?: string
          submitted_at?: string
          submitted_by?: string | null
          submitted_by_name?: string | null
          vendor_name?: string | null
          verified_at?: string | null
          verified_by?: string | null
          verified_by_name?: string | null
        }
        Update: {
          account_id?: string
          amount?: number
          approver_ids?: string[]
          approver_names?: string[]
          assigned_at?: string | null
          assigned_to?: string | null
          assigned_to_name?: string | null
          awaiting_secondary?: boolean
          class_names?: string[]
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          decision_reason?: string | null
          due_date?: string | null
          duplicate_of?: string | null
          email_attachment_key?: string | null
          email_from?: string | null
          email_message_id?: string | null
          email_subject?: string | null
          exported_at?: string | null
          exported_by?: string | null
          exported_by_name?: string | null
          file_name?: string | null
          file_path?: string | null
          file_type?: string | null
          first_approved_at?: string | null
          first_approved_by?: string | null
          first_approved_by_name?: string | null
          gl_allocations?: Json | null
          gl_code?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          location_id?: string | null
          location_ids?: string[]
          memo?: string | null
          notify_status?: string | null
          reminder_sent_at?: string | null
          resubmit_by_name?: string | null
          resubmit_note?: string | null
          secondary_approver_ids?: string[]
          secondary_approver_names?: string[]
          site_allocations?: Json
          status?: string
          submitted_at?: string
          submitted_by?: string | null
          submitted_by_name?: string | null
          vendor_name?: string | null
          verified_at?: string | null
          verified_by?: string | null
          verified_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_invoices_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_invoices_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_invoices_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_invoices_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "ops_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_invoices_exported_by_fkey"
            columns: ["exported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_invoices_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_invoices_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_invoices_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_notes: {
        Row: {
          account_id: string
          additional_notes: string | null
          created_at: string
          department: string | null
          id: string
          location_id: string | null
          note_type: string | null
          other_description: string | null
          submitted_by: string | null
          submitted_by_name: string | null
        }
        Insert: {
          account_id: string
          additional_notes?: string | null
          created_at?: string
          department?: string | null
          id?: string
          location_id?: string | null
          note_type?: string | null
          other_description?: string | null
          submitted_by?: string | null
          submitted_by_name?: string | null
        }
        Update: {
          account_id?: string
          additional_notes?: string | null
          created_at?: string
          department?: string | null
          id?: string
          location_id?: string | null
          note_type?: string | null
          other_description?: string | null
          submitted_by?: string | null
          submitted_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_notes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_notes_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_notes_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      part_assets: {
        Row: {
          asset_id: string
          notes: string | null
          part_id: string
          qty_per: number
        }
        Insert: {
          asset_id: string
          notes?: string | null
          part_id: string
          qty_per?: number
        }
        Update: {
          asset_id?: string
          notes?: string | null
          part_id?: string
          qty_per?: number
        }
        Relationships: [
          {
            foreignKeyName: "part_assets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_assets_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
        ]
      }
      part_restock_log: {
        Row: {
          created_at: string
          id: string
          location_id: string
          notes: string | null
          part_id: string
          quantity_added: number
          restocked_by: string | null
          restocked_by_name: string | null
          unit_cost_at_time: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          notes?: string | null
          part_id: string
          quantity_added: number
          restocked_by?: string | null
          restocked_by_name?: string | null
          unit_cost_at_time?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          notes?: string | null
          part_id?: string
          quantity_added?: number
          restocked_by?: string | null
          restocked_by_name?: string | null
          unit_cost_at_time?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "part_restock_log_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_restock_log_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_restock_log_restocked_by_fkey"
            columns: ["restocked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      parts: {
        Row: {
          abc_class: string | null
          account_id: string
          barcode: string | null
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          is_critical: boolean
          is_sample: boolean
          lead_time_days: number | null
          link_url: string | null
          manufacturer: string | null
          mfr_part_number: string | null
          name: string
          ordering_part_number: string | null
          pack_qty: number
          part_number: number
          photo_path: string | null
          qr_code: string
          sku: string | null
          sku_legacy_dup: boolean
          spec: Json
          stale_days: number | null
          unit_cost: number | null
          uom: string
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          abc_class?: string | null
          account_id: string
          barcode?: string | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_critical?: boolean
          is_sample?: boolean
          lead_time_days?: number | null
          link_url?: string | null
          manufacturer?: string | null
          mfr_part_number?: string | null
          name: string
          ordering_part_number?: string | null
          pack_qty?: number
          part_number: number
          photo_path?: string | null
          qr_code: string
          sku?: string | null
          sku_legacy_dup?: boolean
          spec?: Json
          stale_days?: number | null
          unit_cost?: number | null
          uom?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          abc_class?: string | null
          account_id?: string
          barcode?: string | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_critical?: boolean
          is_sample?: boolean
          lead_time_days?: number | null
          link_url?: string | null
          manufacturer?: string | null
          mfr_part_number?: string | null
          name?: string
          ordering_part_number?: string | null
          pack_qty?: number
          part_number?: number
          photo_path?: string | null
          qr_code?: string
          sku?: string | null
          sku_legacy_dup?: boolean
          spec?: Json
          stale_days?: number | null
          unit_cost?: number | null
          uom?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "mi_part_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      parts_inventory: {
        Row: {
          id: string
          last_updated_at: string
          link_url: string | null
          location_id: string
          manufacturer: string | null
          minimum_in_stock: number
          name: string | null
          part_id: string
          quantity_on_hand: number
          reorder_threshold: number | null
          sku: string | null
          unit_cost: number | null
          vendor: string | null
        }
        Insert: {
          id?: string
          last_updated_at?: string
          link_url?: string | null
          location_id: string
          manufacturer?: string | null
          minimum_in_stock: number
          name?: string | null
          part_id: string
          quantity_on_hand?: number
          reorder_threshold?: number | null
          sku?: string | null
          unit_cost?: number | null
          vendor?: string | null
        }
        Update: {
          id?: string
          last_updated_at?: string
          link_url?: string | null
          location_id?: string
          manufacturer?: string | null
          minimum_in_stock?: number
          name?: string | null
          part_id?: string
          quantity_on_hand?: number
          reorder_threshold?: number | null
          sku?: string | null
          unit_cost?: number | null
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parts_inventory_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_inventory_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
        ]
      }
      per_diem_requests: {
        Row: {
          account_id: string
          amount: number
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          business_unit: string | null
          category: string | null
          created_at: string
          currency: string
          department: string | null
          description: string | null
          expense_date: string
          id: string
          policy: string | null
          requested_by: string | null
          requested_by_name: string | null
          status: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          business_unit?: string | null
          category?: string | null
          created_at?: string
          currency?: string
          department?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          policy?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          business_unit?: string | null
          category?: string | null
          created_at?: string
          currency?: string
          department?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          policy?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "per_diem_requests_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "per_diem_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "per_diem_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pm_plans: {
        Row: {
          account_id: string
          active: boolean
          created_at: string
          description: string | null
          equipment_id: string | null
          frequency_count: number
          frequency_unit: string
          id: string
          last_generated_at: string | null
          lead_time_days: number
          location_id: string
          next_due_date: string
          priority: string
          procedure_template_id: string | null
          team_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          account_id: string
          active?: boolean
          created_at?: string
          description?: string | null
          equipment_id?: string | null
          frequency_count?: number
          frequency_unit?: string
          id?: string
          last_generated_at?: string | null
          lead_time_days?: number
          location_id: string
          next_due_date: string
          priority?: string
          procedure_template_id?: string | null
          team_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          active?: boolean
          created_at?: string
          description?: string | null
          equipment_id?: string | null
          frequency_count?: number
          frequency_unit?: string
          id?: string
          last_generated_at?: string | null
          lead_time_days?: number
          location_id?: string
          next_due_date?: string
          priority?: string
          procedure_template_id?: string | null
          team_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pm_plans_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_plans_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_plans_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_plans_procedure_template_id_fkey"
            columns: ["procedure_template_id"]
            isOneToOne: false
            referencedRelation: "procedure_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_plans_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      procedure_fields: {
        Row: {
          id: string
          label: string
          options: Json
          order_index: number
          required: boolean
          template_id: string
          type: string
        }
        Insert: {
          id?: string
          label: string
          options?: Json
          order_index?: number
          required?: boolean
          template_id: string
          type?: string
        }
        Update: {
          id?: string
          label?: string
          options?: Json
          order_index?: number
          required?: boolean
          template_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "procedure_fields_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "procedure_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      procedure_templates: {
        Row: {
          account_id: string
          archived: boolean
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          account_id: string
          archived?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procedure_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      qb_connections: {
        Row: {
          account_id: string
          company_file: string | null
          created_at: string
          created_by: string | null
          file_id: string
          last_contact_at: string | null
          last_error: string | null
          lists_requested_at: string | null
          lists_synced_at: string | null
          owner_id: string
          password_hash: string | null
          qbxml_version: string | null
          session_stage: string | null
          session_started_at: string | null
          session_ticket: string | null
          updated_at: string
          username: string
        }
        Insert: {
          account_id: string
          company_file?: string | null
          created_at?: string
          created_by?: string | null
          file_id?: string
          last_contact_at?: string | null
          last_error?: string | null
          lists_requested_at?: string | null
          lists_synced_at?: string | null
          owner_id?: string
          password_hash?: string | null
          qbxml_version?: string | null
          session_stage?: string | null
          session_started_at?: string | null
          session_ticket?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          account_id?: string
          company_file?: string | null
          created_at?: string
          created_by?: string | null
          file_id?: string
          last_contact_at?: string | null
          last_error?: string | null
          lists_requested_at?: string | null
          lists_synced_at?: string | null
          owner_id?: string
          password_hash?: string | null
          qbxml_version?: string | null
          session_stage?: string | null
          session_started_at?: string | null
          session_ticket?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "qb_connections_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_connections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      qb_jobs: {
        Row: {
          account_id: string
          attempts: number
          created_at: string
          created_by: string | null
          done_at: string | null
          error: string | null
          id: string
          invoice_id: string | null
          kind: string
          payload: Json
          qb_txn_id: string | null
          sent_at: string | null
          status: string
          ticket: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          attempts?: number
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          error?: string | null
          id?: string
          invoice_id?: string | null
          kind?: string
          payload: Json
          qb_txn_id?: string | null
          sent_at?: string | null
          status?: string
          ticket?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          attempts?: number
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          error?: string | null
          id?: string
          invoice_id?: string | null
          kind?: string
          payload?: Json
          qb_txn_id?: string | null
          sent_at?: string | null
          status?: string
          ticket?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qb_jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_jobs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "ops_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      qb_list_items: {
        Row: {
          account_id: string
          account_number: string | null
          account_type: string | null
          full_name: string
          is_active: boolean
          list_id: string
          list_type: string
          name: string
          synced_at: string
        }
        Insert: {
          account_id: string
          account_number?: string | null
          account_type?: string | null
          full_name: string
          is_active?: boolean
          list_id: string
          list_type: string
          name: string
          synced_at?: string
        }
        Update: {
          account_id?: string
          account_number?: string | null
          account_type?: string | null
          full_name?: string
          is_active?: boolean
          list_id?: string
          list_type?: string
          name?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qb_list_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          created_at: string
          due_date: string | null
          employee_id: string
          goals: string | null
          id: string
          notes: string | null
          rating: number | null
          review_date: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          due_date?: string | null
          employee_id: string
          goals?: string | null
          id?: string
          notes?: string | null
          rating?: number | null
          review_date?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          due_date?: string | null
          employee_id?: string
          goals?: string | null
          id?: string
          notes?: string | null
          rating?: number | null
          review_date?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_reports: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          date_range_type: string
          filters: Json
          id: string
          module: string
          name: string
          report_key: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          date_range_type?: string
          filters?: Json
          id?: string
          module: string
          name: string
          report_key: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          date_range_type?: string
          filters?: Json
          id?: string
          module?: string
          name?: string
          report_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_reports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_portals: {
        Row: {
          account_id: string
          active: boolean
          created_at: string
          id: string
          token: string
        }
        Insert: {
          account_id: string
          active?: boolean
          created_at?: string
          id?: string
          token?: string
        }
        Update: {
          account_id?: string
          active?: boolean
          created_at?: string
          id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_portals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          location_id: string
          name: string
          shifts: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id: string
          name: string
          shifts?: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string
          name?: string
          shifts?: Json
        }
        Relationships: [
          {
            foreignKeyName: "schedule_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_templates_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          location_id: string
          published: boolean
          week_start_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id: string
          published?: boolean
          week_start_date: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string
          published?: boolean
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_tokens: {
        Row: {
          expires_at: string
          provider: string
          token: string
          updated_at: string
        }
        Insert: {
          expires_at: string
          provider: string
          token: string
          updated_at?: string
        }
        Update: {
          expires_at?: string
          provider?: string
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      shifts: {
        Row: {
          date: string
          employee_id: string
          end_time: string
          id: string
          notes: string | null
          role_label: string | null
          schedule_id: string
          start_time: string
        }
        Insert: {
          date: string
          employee_id: string
          end_time: string
          id?: string
          notes?: string | null
          role_label?: string | null
          schedule_id: string
          start_time: string
        }
        Update: {
          date?: string
          employee_id?: string
          end_time?: string
          id?: string
          notes?: string | null
          role_label?: string | null
          schedule_id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      signage_artwork: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string | null
          path: string
          sign_category: string | null
          sort_order: number | null
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string | null
          path: string
          sign_category?: string | null
          sort_order?: number | null
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string | null
          path?: string
          sign_category?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "signage_artwork_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signage_artwork_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      signage_requests: {
        Row: {
          account_id: string
          artwork_name: string | null
          artwork_path: string | null
          created_at: string
          first_name: string | null
          height: number | null
          id: string
          last_name: string | null
          location_id: string | null
          notes: string | null
          quantity: number
          quantity_completed: number
          requested_by: string | null
          sided: string | null
          sign_category: string
          sign_type: string | null
          size_option: string | null
          size_unit: string
          status: string
          status_updated_at: string | null
          title: string | null
          tracking_number: string | null
          width: number | null
        }
        Insert: {
          account_id: string
          artwork_name?: string | null
          artwork_path?: string | null
          created_at?: string
          first_name?: string | null
          height?: number | null
          id?: string
          last_name?: string | null
          location_id?: string | null
          notes?: string | null
          quantity?: number
          quantity_completed?: number
          requested_by?: string | null
          sided?: string | null
          sign_category: string
          sign_type?: string | null
          size_option?: string | null
          size_unit?: string
          status?: string
          status_updated_at?: string | null
          title?: string | null
          tracking_number?: string | null
          width?: number | null
        }
        Update: {
          account_id?: string
          artwork_name?: string | null
          artwork_path?: string | null
          created_at?: string
          first_name?: string | null
          height?: number | null
          id?: string
          last_name?: string | null
          location_id?: string | null
          notes?: string | null
          quantity?: number
          quantity_completed?: number
          requested_by?: string | null
          sided?: string | null
          sign_category?: string
          sign_type?: string | null
          size_option?: string | null
          size_unit?: string
          status?: string
          status_updated_at?: string | null
          title?: string | null
          tracking_number?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "signage_requests_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signage_requests_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signage_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      site_audits: {
        Row: {
          account_id: string
          created_at: string
          draft_answers: Json | null
          edit_draft: Json | null
          edited_at: string | null
          edited_by: string | null
          edited_by_name: string | null
          explanation: string | null
          final_thoughts: Json | null
          id: string
          initial_observations: string | null
          location_id: string | null
          photos: Json | null
          primary_section: Json | null
          priority_section: Json | null
          secondary_section: Json | null
          section_comments: Json | null
          status: string
          submitted_by: string | null
          submitted_by_name: string | null
          updated_at: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          draft_answers?: Json | null
          edit_draft?: Json | null
          edited_at?: string | null
          edited_by?: string | null
          edited_by_name?: string | null
          explanation?: string | null
          final_thoughts?: Json | null
          id?: string
          initial_observations?: string | null
          location_id?: string | null
          photos?: Json | null
          primary_section?: Json | null
          priority_section?: Json | null
          secondary_section?: Json | null
          section_comments?: Json | null
          status?: string
          submitted_by?: string | null
          submitted_by_name?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          draft_answers?: Json | null
          edit_draft?: Json | null
          edited_at?: string | null
          edited_by?: string | null
          edited_by_name?: string | null
          explanation?: string | null
          final_thoughts?: Json | null
          id?: string
          initial_observations?: string | null
          location_id?: string | null
          photos?: Json | null
          primary_section?: Json | null
          priority_section?: Json | null
          secondary_section?: Json | null
          section_comments?: Json | null
          status?: string
          submitted_by?: string | null
          submitted_by_name?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_audits_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_audits_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_audits_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_audits_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      site_daily_metrics: {
        Row: {
          account_id: string
          date: string
          drb_cars: number | null
          drb_recharge: number | null
          drb_sales: number | null
          drb_test_cars: number | null
          flex_cars: number | null
          flex_recharge: number | null
          flex_sales: number | null
          site_number: number
          updated_at: string
        }
        Insert: {
          account_id: string
          date: string
          drb_cars?: number | null
          drb_recharge?: number | null
          drb_sales?: number | null
          drb_test_cars?: number | null
          flex_cars?: number | null
          flex_recharge?: number | null
          flex_sales?: number | null
          site_number: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          date?: string
          drb_cars?: number | null
          drb_recharge?: number | null
          drb_sales?: number | null
          drb_test_cars?: number | null
          flex_cars?: number | null
          flex_recharge?: number | null
          flex_sales?: number | null
          site_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_daily_metrics_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      site_evaluations: {
        Row: {
          account_id: string
          additional_notes: string | null
          answers: Json
          follow_up_instructions: string | null
          id: string
          location_id: string | null
          result: string | null
          submitted_at: string
          submitted_by: string | null
          submitted_by_name: string | null
        }
        Insert: {
          account_id: string
          additional_notes?: string | null
          answers?: Json
          follow_up_instructions?: string | null
          id?: string
          location_id?: string | null
          result?: string | null
          submitted_at?: string
          submitted_by?: string | null
          submitted_by_name?: string | null
        }
        Update: {
          account_id?: string
          additional_notes?: string | null
          answers?: Json
          follow_up_instructions?: string | null
          id?: string
          location_id?: string | null
          result?: string | null
          submitted_at?: string
          submitted_by?: string | null
          submitted_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_evaluations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_evaluations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_evaluations_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      site_performance_days: {
        Row: {
          account_id: string
          cars: number | null
          cars_per_hour: number | null
          created_at: string
          date: string
          hours: number | null
          id: string
          labor_cost: number | null
          labor_pct: number | null
          recharge: number | null
          sales: number | null
          site: string
          site_number: number | null
          updated_at: string
        }
        Insert: {
          account_id: string
          cars?: number | null
          cars_per_hour?: number | null
          created_at?: string
          date: string
          hours?: number | null
          id?: string
          labor_cost?: number | null
          labor_pct?: number | null
          recharge?: number | null
          sales?: number | null
          site: string
          site_number?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          cars?: number | null
          cars_per_hour?: number | null
          created_at?: string
          date?: string
          hours?: number | null
          id?: string
          labor_cost?: number | null
          labor_pct?: number | null
          recharge?: number | null
          sales?: number | null
          site?: string
          site_number?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_performance_days_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      site_performance_months: {
        Row: {
          account_id: string
          cars: number
          created_at: string
          id: string
          month: string
          site: string
          site_number: number
          source: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          cars: number
          created_at?: string
          id?: string
          month: string
          site: string
          site_number: number
          source?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          cars?: number
          created_at?: string
          id?: string
          month?: string
          site?: string
          site_number?: number
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_performance_months_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      site_violations: {
        Row: {
          account_id: string
          created_at: string
          department: string | null
          description: string | null
          due_date: string | null
          id: string
          location_id: string | null
          reported_at: string
          reported_by: string | null
          reported_by_name: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_by_name: string | null
          severity: string
          status: string
          violation_type: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          department?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          location_id?: string | null
          reported_at?: string
          reported_by?: string | null
          reported_by_name?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_by_name?: string | null
          severity?: string
          status?: string
          violation_type?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          department?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          location_id?: string | null
          reported_at?: string
          reported_by?: string | null
          reported_by_name?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_by_name?: string | null
          severity?: string
          status?: string
          violation_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_violations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_violations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_violations_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_violations_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_optin_tokens: {
        Row: {
          account_id: string
          created_at: string
          expires_at: string
          token_hash: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          expires_at: string
          token_hash: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          expires_at?: string
          token_hash?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_optin_tokens_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_optin_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          account_id: string
          ai_generated: boolean
          body: string | null
          created_at: string
          created_by: string | null
          holiday_id: string | null
          id: string
          model: string | null
          notes: string | null
          platform: string | null
          post_date: string
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          ai_generated?: boolean
          body?: string | null
          created_at?: string
          created_by?: string | null
          holiday_id?: string | null
          id?: string
          model?: string | null
          notes?: string | null
          platform?: string | null
          post_date: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          ai_generated?: boolean
          body?: string | null
          created_at?: string
          created_by?: string | null
          holiday_id?: string | null
          id?: string
          model?: string | null
          notes?: string | null
          platform?: string | null
          post_date?: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      supplies_requests: {
        Row: {
          category: string | null
          category_other: string | null
          created_at: string
          first_name: string | null
          id: string
          item: string
          last_name: string | null
          location_id: string
          notes: string | null
          priority: string
          quantity: number
          requested_by: string | null
          status: string
        }
        Insert: {
          category?: string | null
          category_other?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          item: string
          last_name?: string | null
          location_id: string
          notes?: string | null
          priority?: string
          quantity?: number
          requested_by?: string | null
          status?: string
        }
        Update: {
          category?: string | null
          category_other?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          item?: string
          last_name?: string | null
          location_id?: string
          notes?: string | null
          priority?: string
          quantity?: number
          requested_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplies_requests_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplies_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          team_id: string
          user_id: string
        }
        Insert: {
          team_id: string
          user_id: string
        }
        Update: {
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          account_id: string
          archived: boolean
          color: string
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          account_id: string
          archived?: boolean
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived?: boolean
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          auto_closed: boolean
          clock_in: string
          clock_out: string | null
          created_at: string
          edited_at: string | null
          edited_by: string | null
          employee_id: string
          id: string
          location_id: string
          notes: string | null
          punch_in_distance_m: number | null
          punch_in_face_detected: boolean | null
          punch_in_lat: number | null
          punch_in_lng: number | null
          punch_in_outside_fence: boolean | null
          punch_in_photo_path: string | null
          punch_out_distance_m: number | null
          punch_out_face_detected: boolean | null
          punch_out_lat: number | null
          punch_out_lng: number | null
          punch_out_outside_fence: boolean | null
          punch_out_photo_path: string | null
        }
        Insert: {
          auto_closed?: boolean
          clock_in: string
          clock_out?: string | null
          created_at?: string
          edited_at?: string | null
          edited_by?: string | null
          employee_id: string
          id?: string
          location_id: string
          notes?: string | null
          punch_in_distance_m?: number | null
          punch_in_face_detected?: boolean | null
          punch_in_lat?: number | null
          punch_in_lng?: number | null
          punch_in_outside_fence?: boolean | null
          punch_in_photo_path?: string | null
          punch_out_distance_m?: number | null
          punch_out_face_detected?: boolean | null
          punch_out_lat?: number | null
          punch_out_lng?: number | null
          punch_out_outside_fence?: boolean | null
          punch_out_photo_path?: string | null
        }
        Update: {
          auto_closed?: boolean
          clock_in?: string
          clock_out?: string | null
          created_at?: string
          edited_at?: string | null
          edited_by?: string | null
          employee_id?: string
          id?: string
          location_id?: string
          notes?: string | null
          punch_in_distance_m?: number | null
          punch_in_face_detected?: boolean | null
          punch_in_lat?: number | null
          punch_in_lng?: number | null
          punch_in_outside_fence?: boolean | null
          punch_in_photo_path?: string | null
          punch_out_distance_m?: number | null
          punch_out_face_detected?: boolean | null
          punch_out_lat?: number | null
          punch_out_lng?: number | null
          punch_out_outside_fence?: boolean | null
          punch_out_photo_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      time_off_requests: {
        Row: {
          created_at: string
          employee_id: string
          end_date: string
          id: string
          location_id: string
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string
          status: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          end_date: string
          id?: string
          location_id: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date: string
          status?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          end_date?: string
          id?: string
          location_id?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_off_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_off_requests_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_off_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tips: {
        Row: {
          account_id: string
          amount_cents: number
          created_at: string
          currency: string
          id: string
          location_id: string
          status: string
          stripe_payment_intent_id: string | null
          stripe_session_id: string
          tipped_at: string
          tipper_note: string | null
        }
        Insert: {
          account_id: string
          amount_cents: number
          created_at?: string
          currency?: string
          id?: string
          location_id: string
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id: string
          tipped_at?: string
          tipper_note?: string | null
        }
        Update: {
          account_id?: string
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          location_id?: string
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string
          tipped_at?: string
          tipper_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tips_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tips_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      training_assignments: {
        Row: {
          account_id: string
          assigned_at: string
          assigned_by: string | null
          completed_at: string | null
          completed_by: string | null
          due_date: string | null
          employee_id: string
          id: string
          location_id: string | null
          notes: string | null
          training_item_id: string
        }
        Insert: {
          account_id: string
          assigned_at?: string
          assigned_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          due_date?: string | null
          employee_id: string
          id?: string
          location_id?: string | null
          notes?: string | null
          training_item_id: string
        }
        Update: {
          account_id?: string
          assigned_at?: string
          assigned_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          due_date?: string | null
          employee_id?: string
          id?: string
          location_id?: string | null
          notes?: string | null
          training_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_assignments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_assignments_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_assignments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_assignments_training_item_id_fkey"
            columns: ["training_item_id"]
            isOneToOne: false
            referencedRelation: "training_items"
            referencedColumns: ["id"]
          },
        ]
      }
      training_items: {
        Row: {
          account_id: string
          active: boolean
          body: string | null
          category: string | null
          content_type: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          required: boolean
          roles: string[] | null
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          account_id: string
          active?: boolean
          body?: string | null
          category?: string | null
          content_type?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          required?: boolean
          roles?: string[] | null
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          account_id?: string
          active?: boolean
          body?: string | null
          category?: string | null
          content_type?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          required?: boolean
          roles?: string[] | null
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "training_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ttaf_retail_snapshots: {
        Row: {
          account_id: string
          month_key: string
          retail_mtd: number
          site_ttaf: Json | null
          snapshot_date: string
          ttaf_mtd: number | null
          updated_at: string
        }
        Insert: {
          account_id: string
          month_key: string
          retail_mtd?: number
          site_ttaf?: Json | null
          snapshot_date: string
          ttaf_mtd?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          month_key?: string
          retail_mtd?: number
          site_ttaf?: Json | null
          snapshot_date?: string
          ttaf_mtd?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ttaf_retail_snapshots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      uniform_requests: {
        Row: {
          employee_id: string | null
          fulfilled_at: string | null
          id: string
          item: string
          location_id: string | null
          quantity: number
          requested_at: string
          size: string | null
          status: string
        }
        Insert: {
          employee_id?: string | null
          fulfilled_at?: string | null
          id?: string
          item: string
          location_id?: string | null
          quantity?: number
          requested_at?: string
          size?: string | null
          status?: string
        }
        Update: {
          employee_id?: string | null
          fulfilled_at?: string | null
          id?: string
          item?: string
          location_id?: string | null
          quantity?: number
          requested_at?: string
          size?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "uniform_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uniform_requests_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          account_id: string
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          last_seen_at: string | null
          location_ids: string[]
          name: string
          nav_favorites: string[] | null
          phone: string | null
          role: string
          role_category: string | null
          shift_favorites: Json | null
          sms_opt_in: boolean
          sms_opt_in_at: string | null
          sms_opt_in_source: string | null
        }
        Insert: {
          account_id: string
          avatar_url?: string | null
          created_at?: string
          email: string
          id: string
          last_seen_at?: string | null
          location_ids?: string[]
          name: string
          nav_favorites?: string[] | null
          phone?: string | null
          role: string
          role_category?: string | null
          shift_favorites?: Json | null
          sms_opt_in?: boolean
          sms_opt_in_at?: string | null
          sms_opt_in_source?: string | null
        }
        Update: {
          account_id?: string
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          last_seen_at?: string | null
          location_ids?: string[]
          name?: string
          nav_favorites?: string[] | null
          phone?: string | null
          role?: string
          role_category?: string | null
          shift_favorites?: Json | null
          sms_opt_in?: boolean
          sms_opt_in_at?: string | null
          sms_opt_in_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_site_visits: {
        Row: {
          account_id: string
          arrived_at: string
          created_at: string
          departed_at: string | null
          id: string
          location_id: string
          person_key: string | null
          person_name: string | null
          vehicle_name: string | null
          vehicle_number: string
        }
        Insert: {
          account_id: string
          arrived_at: string
          created_at?: string
          departed_at?: string | null
          id?: string
          location_id: string
          person_key?: string | null
          person_name?: string | null
          vehicle_name?: string | null
          vehicle_number: string
        }
        Update: {
          account_id?: string
          arrived_at?: string
          created_at?: string
          departed_at?: string | null
          id?: string
          location_id?: string
          person_key?: string | null
          person_name?: string | null
          vehicle_name?: string | null
          vehicle_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_site_visits_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_site_visits_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_contacts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
          role_title: string | null
          vendor_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          role_title?: string | null
          vendor_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          role_title?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_contacts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          account_id: string
          address: string | null
          created_at: string
          email: string | null
          id: string
          kind: string
          name: string
          notes: string | null
          phone: string | null
          website: string | null
        }
        Insert: {
          account_id: string
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          kind?: string
          name: string
          notes?: string | null
          phone?: string | null
          website?: string | null
        }
        Update: {
          account_id?: string
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          kind?: string
          name?: string
          notes?: string | null
          phone?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendors_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      weather_days: {
        Row: {
          account_id: string
          conditions: string | null
          created_at: string
          date: string
          id: string
          location_id: string
          precip_in: number | null
          source: string
          temp_max: number | null
          temp_min: number | null
          updated_at: string
          weather_code: number | null
        }
        Insert: {
          account_id: string
          conditions?: string | null
          created_at?: string
          date: string
          id?: string
          location_id: string
          precip_in?: number | null
          source?: string
          temp_max?: number | null
          temp_min?: number | null
          updated_at?: string
          weather_code?: number | null
        }
        Update: {
          account_id?: string
          conditions?: string | null
          created_at?: string
          date?: string
          id?: string
          location_id?: string
          precip_in?: number | null
          source?: string
          temp_max?: number | null
          temp_min?: number | null
          updated_at?: string
          weather_code?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "weather_days_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_days_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_assignees: {
        Row: {
          assigned_at: string
          user_id: string
          user_name: string
          work_order_id: string
        }
        Insert: {
          assigned_at?: string
          user_id: string
          user_name: string
          work_order_id: string
        }
        Update: {
          assigned_at?: string
          user_id?: string
          user_name?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_assignees_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_categories: {
        Row: {
          account_id: string
          color: string
          created_at: string
          icon: string | null
          id: string
          name: string
        }
        Insert: {
          account_id: string
          color?: string
          created_at?: string
          icon?: string | null
          id?: string
          name: string
        }
        Update: {
          account_id?: string
          color?: string
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_categories_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_category_links: {
        Row: {
          category_id: string
          work_order_id: string
        }
        Insert: {
          category_id: string
          work_order_id: string
        }
        Update: {
          category_id?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_category_links_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "work_order_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_category_links_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_comments: {
        Row: {
          attachment_path: string | null
          body: string
          created_at: string
          id: string
          kind: string
          user_id: string | null
          user_name: string
          work_order_id: string
        }
        Insert: {
          attachment_path?: string | null
          body: string
          created_at?: string
          id?: string
          kind: string
          user_id?: string | null
          user_name: string
          work_order_id: string
        }
        Update: {
          attachment_path?: string | null
          body?: string
          created_at?: string
          id?: string
          kind?: string
          user_id?: string | null
          user_name?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_comments_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_files: {
        Row: {
          created_at: string
          file_name: string | null
          id: string
          kind: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          uploaded_by: string | null
          work_order_id: string
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          id?: string
          kind: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          uploaded_by?: string | null
          work_order_id: string
        }
        Update: {
          created_at?: string
          file_name?: string | null
          id?: string
          kind?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          uploaded_by?: string | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_files_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_other_costs: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          work_order_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          work_order_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_other_costs_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_parts: {
        Row: {
          catalog_part_id: string | null
          created_at: string
          id: string
          mi_location_id: string | null
          part_id: string | null
          part_name: string
          qty_issued: number
          qty_planned: number
          qty_returned: number
          quantity: number
          unit_cost: number | null
          work_order_id: string
        }
        Insert: {
          catalog_part_id?: string | null
          created_at?: string
          id?: string
          mi_location_id?: string | null
          part_id?: string | null
          part_name: string
          qty_issued?: number
          qty_planned?: number
          qty_returned?: number
          quantity?: number
          unit_cost?: number | null
          work_order_id: string
        }
        Update: {
          catalog_part_id?: string | null
          created_at?: string
          id?: string
          mi_location_id?: string | null
          part_id?: string | null
          part_name?: string
          qty_issued?: number
          qty_planned?: number
          qty_returned?: number
          quantity?: number
          unit_cost?: number | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_parts_catalog_part_id_fkey"
            columns: ["catalog_part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_parts_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts_inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_parts_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_procedure_items: {
        Row: {
          id: string
          label: string
          options: Json
          order_index: number
          required: boolean
          responded_at: string | null
          responded_by: string | null
          type: string
          value: string | null
          wo_procedure_id: string
        }
        Insert: {
          id?: string
          label: string
          options?: Json
          order_index?: number
          required?: boolean
          responded_at?: string | null
          responded_by?: string | null
          type?: string
          value?: string | null
          wo_procedure_id: string
        }
        Update: {
          id?: string
          label?: string
          options?: Json
          order_index?: number
          required?: boolean
          responded_at?: string | null
          responded_by?: string | null
          type?: string
          value?: string | null
          wo_procedure_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_procedure_items_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_procedure_items_wo_procedure_id_fkey"
            columns: ["wo_procedure_id"]
            isOneToOne: false
            referencedRelation: "work_order_procedures"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_procedures: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          name: string
          template_id: string | null
          work_order_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          name: string
          template_id?: string | null
          work_order_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          name?: string
          template_id?: string | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_procedures_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "procedure_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_procedures_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_teams: {
        Row: {
          team_id: string
          team_name: string
          work_order_id: string
        }
        Insert: {
          team_id: string
          team_name: string
          work_order_id: string
        }
        Update: {
          team_id?: string
          team_name?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_teams_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_time_entries: {
        Row: {
          created_at: string
          hourly_rate: number | null
          id: string
          minutes: number
          notes: string | null
          user_id: string | null
          user_name: string
          work_order_id: string
        }
        Insert: {
          created_at?: string
          hourly_rate?: number | null
          id?: string
          minutes: number
          notes?: string | null
          user_id?: string | null
          user_name: string
          work_order_id: string
        }
        Update: {
          created_at?: string
          hourly_rate?: number | null
          id?: string
          minutes?: number
          notes?: string | null
          user_id?: string | null
          user_name?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_time_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_time_entries_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_vendor_links: {
        Row: {
          vendor_id: string
          work_order_id: string
        }
        Insert: {
          vendor_id: string
          work_order_id: string
        }
        Update: {
          vendor_id?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_vendor_links_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_vendor_links_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_orders: {
        Row: {
          account_id: string
          completed_at: string | null
          completed_by: string | null
          completed_by_name: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          department: string | null
          description: string | null
          due_at: string | null
          equipment_id: string | null
          estimated_minutes: number | null
          id: string
          location_id: string
          maintainx_id: number | null
          maintainx_updated_at: string | null
          mi_schedule_id: string | null
          number: number
          parent_work_order_id: string | null
          pm_plan_id: string | null
          priority: string
          recurrence: string
          recurrence_interval: number | null
          recurrence_unit: string | null
          requested_by: string | null
          requested_by_name: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          start_at: string | null
          status: string
          title: string
          updated_at: string
          work_type: string
          work_type_source: string
        }
        Insert: {
          account_id: string
          completed_at?: string | null
          completed_by?: string | null
          completed_by_name?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          department?: string | null
          description?: string | null
          due_at?: string | null
          equipment_id?: string | null
          estimated_minutes?: number | null
          id?: string
          location_id: string
          maintainx_id?: number | null
          maintainx_updated_at?: string | null
          mi_schedule_id?: string | null
          number?: number
          parent_work_order_id?: string | null
          pm_plan_id?: string | null
          priority?: string
          recurrence?: string
          recurrence_interval?: number | null
          recurrence_unit?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          start_at?: string | null
          status?: string
          title: string
          updated_at?: string
          work_type?: string
          work_type_source?: string
        }
        Update: {
          account_id?: string
          completed_at?: string | null
          completed_by?: string | null
          completed_by_name?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          department?: string | null
          description?: string | null
          due_at?: string | null
          equipment_id?: string | null
          estimated_minutes?: number | null
          id?: string
          location_id?: string
          maintainx_id?: number | null
          maintainx_updated_at?: string | null
          mi_schedule_id?: string | null
          number?: number
          parent_work_order_id?: string | null
          pm_plan_id?: string | null
          priority?: string
          recurrence?: string
          recurrence_interval?: number | null
          recurrence_unit?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          start_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          work_type?: string
          work_type_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_mi_schedule_id_fkey"
            columns: ["mi_schedule_id"]
            isOneToOne: false
            referencedRelation: "mi_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_parent_work_order_id_fkey"
            columns: ["parent_work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_pm_plan_fk"
            columns: ["pm_plan_id"]
            isOneToOne: false
            referencedRelation: "pm_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      work_request_portals: {
        Row: {
          account_id: string
          active: boolean
          created_at: string
          id: string
          location_id: string | null
          name: string
          token: string
        }
        Insert: {
          account_id: string
          active?: boolean
          created_at?: string
          id?: string
          location_id?: string | null
          name?: string
          token?: string
        }
        Update: {
          account_id?: string
          active?: boolean
          created_at?: string
          id?: string
          location_id?: string | null
          name?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_request_portals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_request_portals_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      work_requests: {
        Row: {
          account_id: string
          created_at: string
          description: string | null
          equipment_id: string | null
          id: string
          it_asset_id: string | null
          location_id: string
          priority: string
          requester_email: string | null
          requester_name: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          title: string
          work_order_id: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          description?: string | null
          equipment_id?: string | null
          id?: string
          it_asset_id?: string | null
          location_id: string
          priority?: string
          requester_email?: string | null
          requester_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          title: string
          work_order_id?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          description?: string | null
          equipment_id?: string | null
          id?: string
          it_asset_id?: string | null
          location_id?: string
          priority?: string
          requester_email?: string | null
          requester_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          title?: string
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_requests_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_requests_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_requests_it_asset_id_fkey"
            columns: ["it_asset_id"]
            isOneToOne: false
            referencedRelation: "it_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_requests_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_requests_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      checklist_item_state: {
        Row: {
          checked: boolean | null
          instance_id: string | null
          item_id: string | null
          last_actor_id: string | null
          last_actor_name: string | null
          last_event_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_item_events_actor_id_fkey"
            columns: ["last_actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_item_events_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "checklist_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_item_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_submission_latest: {
        Row: {
          ai_notes: string | null
          ai_status: string | null
          created_at: string | null
          id: string | null
          instance_id: string | null
          item_id: string | null
          location_id: string | null
          submitted_by_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_submissions_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "checklist_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_submissions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_submissions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      it_accessory_stock: {
        Row: {
          account_id: string | null
          available: number | null
          category_id: string | null
          checked_out: number | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          id: string | null
          location_id: string | null
          min_qty: number | null
          model_number: string | null
          name: string | null
          notes: string | null
          qty_total: number | null
          supplier_id: string | null
          unit_cost: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "it_accessories_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_accessories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "it_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_accessories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_accessories_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "it_accessories_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "it_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _auth_user_id_by_email: { Args: { p_email: string }; Returns: string }
      academy__can_act: { Args: { p_learner: string }; Returns: boolean }
      academy__can_see: { Args: { p_learner: string }; Returns: boolean }
      academy__complete: {
        Args: { p_learner: string; p_level: string }
        Returns: boolean
      }
      academy__editor: { Args: never; Returns: boolean }
      academy__grade: {
        Args: { p_answers: Json; p_ids: string[]; p_reveal: boolean }
        Returns: Json
      }
      academy__import: {
        Args: { p_account: string; p_doc: Json }
        Returns: Json
      }
      academy__leader: { Args: never; Returns: boolean }
      academy__touch: { Args: { p_learner: string }; Returns: undefined }
      academy_check_quiz: {
        Args: { p_answers: Json; p_learner?: string; p_lesson: string }
        Returns: Json
      }
      academy_check_skill: {
        Args: {
          p_learner: string
          p_level: string
          p_on: boolean
          p_skill: string
        }
        Returns: undefined
      }
      academy_import_local: { Args: { p_state: Json }; Returns: Json }
      academy_level_questions: {
        Args: { p_level: string }
        Returns: {
          id: string
          kind: string
          lesson_id: string
          options: string[]
          prompt: string
          sort: number
          title: string
        }[]
      }
      academy_me: { Args: never; Returns: Json }
      academy_question_counts: {
        Args: never
        Returns: {
          kind: string
          lesson_id: string
          level_id: string
          n: number
        }[]
      }
      academy_save_questions: {
        Args: {
          p_items: Json
          p_kind: string
          p_lesson: string
          p_level: string
        }
        Returns: number
      }
      academy_save_selfcheck: {
        Args: {
          p_checks: boolean[]
          p_finish: boolean
          p_focus: number
          p_learner: string
          p_lesson: string
        }
        Returns: undefined
      }
      academy_sign: {
        Args: {
          p_leader_name: string
          p_learner: string
          p_level: string
          p_location: string
          p_name: string
          p_signed_on: string
          p_verify?: boolean
        }
        Returns: string
      }
      academy_submit: {
        Args: {
          p_answers: Json
          p_kind: string
          p_learner?: string
          p_level: string
        }
        Returns: Json
      }
      academy_team: {
        Args: { p_location?: string }
        Returns: {
          is_user: boolean
          last_active_at: string
          learner_id: string
          level_key: string
          levels: Json
          location_id: string
          name: string
        }[]
      }
      academy_trainee: { Args: { p_employee: string }; Returns: Json }
      academy_unsign: { Args: { p_signoff: string }; Returns: undefined }
      academy_update_learner: {
        Args: { p_learner: string; p_level_key: string; p_location: string }
        Returns: undefined
      }
      academy_verify: {
        Args: { p_on: boolean; p_signoff: string }
        Returns: undefined
      }
      accept_invitation: {
        Args: { p_token: string; p_user_name?: string }
        Returns: string
      }
      account_for_invoice_token: { Args: { p_token: string }; Returns: string }
      acknowledge_counseling: {
        Args: { p_record_id: string }
        Returns: undefined
      }
      admin_accept_invitation: {
        Args: { p_token: string; p_user_id: string; p_user_name?: string }
        Returns: string
      }
      auth_account_id: { Args: never; Returns: string }
      auth_can_see_employee: { Args: { emp: string }; Returns: boolean }
      auth_employee_id: { Args: never; Returns: string }
      auth_has_location: { Args: { loc: string }; Returns: boolean }
      auth_in_conversation: { Args: { conv: string }; Returns: boolean }
      auth_is_manager_plus: { Args: never; Returns: boolean }
      auth_is_wo_reviewer: {
        Args: { dept: string; loc: string }
        Returns: boolean
      }
      auth_location_ids: { Args: never; Returns: string[] }
      auth_role: { Args: never; Returns: string }
      auth_role_category: { Args: never; Returns: string }
      auth_site_ids: { Args: never; Returns: string[] }
      biometric_consent_status: {
        Args: { p_location_id: string }
        Returns: {
          consented: boolean
          consented_at: string
          employee_id: string
          name: string
          revoked_at: string
        }[]
      }
      corenav_set_error: {
        Args: { p_error: string; p_user: string }
        Returns: undefined
      }
      corenav_status: { Args: never; Returns: Json }
      corenav_tokens_connect: {
        Args: { p_tokens: Json; p_user: string }
        Returns: undefined
      }
      corenav_tokens_delete: { Args: { p_user: string }; Returns: undefined }
      corenav_tokens_get: { Args: { p_user: string }; Returns: Json }
      corenav_tokens_save: {
        Args: { p_tokens: Json; p_user: string }
        Returns: undefined
      }
      currently_working: { Args: { p_location_id: string }; Returns: Json }
      employee_has_pin: { Args: { p_employee_id: string }; Returns: boolean }
      ensure_checklist_instance: {
        Args: { p_checklist_id: string; p_location_id: string }
        Returns: string
      }
      ensure_today_instances: {
        Args: { p_location_id: string }
        Returns: string[]
      }
      gen_invoice_inbox_token: { Args: never; Returns: string }
      generate_due_pm_work_orders: { Args: never; Returns: number }
      generate_pm_plan: { Args: { p_plan_id: string }; Returns: string }
      get_invitation_email: { Args: { p_token: string }; Returns: string }
      get_invitation_info: { Args: { p_token: string }; Returns: Json }
      gm_bonus_set_site_managers: {
        Args: { p_account_id: string; p_site_managers: Json }
        Returns: undefined
      }
      interior_cars_washed: {
        Args: { p_end: string; p_site_numbers: number[]; p_start: string }
        Returns: number
      }
      invoice_approver_digest: {
        Args: never
        Returns: {
          account_id: string
          amount: number
          approver_ids: string[]
          approver_names: string[]
          assigned_at: string | null
          assigned_to: string | null
          assigned_to_name: string | null
          awaiting_secondary: boolean
          class_names: string[]
          decided_at: string | null
          decided_by: string | null
          decided_by_name: string | null
          decision_reason: string | null
          due_date: string | null
          duplicate_of: string | null
          email_attachment_key: string | null
          email_from: string | null
          email_message_id: string | null
          email_subject: string | null
          exported_at: string | null
          exported_by: string | null
          exported_by_name: string | null
          file_name: string | null
          file_path: string | null
          file_type: string | null
          first_approved_at: string | null
          first_approved_by: string | null
          first_approved_by_name: string | null
          gl_allocations: Json | null
          gl_code: string | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          location_id: string | null
          location_ids: string[]
          memo: string | null
          notify_status: string | null
          reminder_sent_at: string | null
          resubmit_by_name: string | null
          resubmit_note: string | null
          secondary_approver_ids: string[]
          secondary_approver_names: string[]
          site_allocations: Json
          status: string
          submitted_at: string
          submitted_by: string | null
          submitted_by_name: string | null
          vendor_name: string | null
          verified_at: string | null
          verified_by: string | null
          verified_by_name: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "ops_invoices"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      invoice_approver_reminders: {
        Args: never
        Returns: {
          account_id: string
          amount: number
          approver_ids: string[]
          approver_names: string[]
          assigned_at: string | null
          assigned_to: string | null
          assigned_to_name: string | null
          awaiting_secondary: boolean
          class_names: string[]
          decided_at: string | null
          decided_by: string | null
          decided_by_name: string | null
          decision_reason: string | null
          due_date: string | null
          duplicate_of: string | null
          email_attachment_key: string | null
          email_from: string | null
          email_message_id: string | null
          email_subject: string | null
          exported_at: string | null
          exported_by: string | null
          exported_by_name: string | null
          file_name: string | null
          file_path: string | null
          file_type: string | null
          first_approved_at: string | null
          first_approved_by: string | null
          first_approved_by_name: string | null
          gl_allocations: Json | null
          gl_code: string | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          location_id: string | null
          location_ids: string[]
          memo: string | null
          notify_status: string | null
          reminder_sent_at: string | null
          resubmit_by_name: string | null
          resubmit_note: string | null
          secondary_approver_ids: string[]
          secondary_approver_names: string[]
          site_allocations: Json
          status: string
          submitted_at: string
          submitted_by: string | null
          submitted_by_name: string | null
          vendor_name: string | null
          verified_at: string | null
          verified_by: string | null
          verified_by_name: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "ops_invoices"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      it_audit_scan: {
        Args: { p_area?: string; p_run: string; p_tag: string }
        Returns: Json
      }
      it_bootstrap: {
        Args: never
        Returns: {
          account_id: string
          audit_interval_months: number
          audit_warning_days: number
          created_at: string
          created_by: string | null
          id: string
          label_logo_path: string | null
          label_show_logo: boolean
          reminders_enabled: boolean
          short_code: string
          site_prefixes: Json
          support_phone: string | null
          tag_padding: number
          tag_prefix: string
          updated_at: string
          use_site_prefix: boolean
        }
        SetofOptions: {
          from: "*"
          to: "it_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      it_can_read: { Args: { loc: string }; Returns: boolean }
      it_can_write: { Args: { loc: string }; Returns: boolean }
      it_cancel_audit: { Args: { p_run: string }; Returns: undefined }
      it_category_from_other: { Args: { p_name: string }; Returns: string }
      it_check_in: {
        Args: { p_asset_ids: string[]; p_note?: string; p_status_id?: string }
        Returns: Json
      }
      it_check_out: {
        Args: {
          p_asset_ids: string[]
          p_assigned_label?: string
          p_expected?: string
          p_note?: string
          p_signature?: string
          p_target: string
          p_type: string
        }
        Returns: Json
      }
      it_complete_audit: {
        Args: { p_note?: string; p_run: string }
        Returns: Json
      }
      it_find_duplicates: {
        Args: { p_exclude?: string; p_mac: string; p_serial: string }
        Returns: {
          asset_id: string
          asset_name: string
          asset_tag: string
          can_open: boolean
          field: string
          site_name: string
        }[]
      }
      it_find_site: { Args: { p_name: string }; Returns: string }
      it_finish_repair: {
        Args: {
          p_completed?: string
          p_cost?: number
          p_id: string
          p_note?: string
        }
        Returns: Json
      }
      it_generate_tags: {
        Args: { p_count: number; p_location?: string }
        Returns: {
          account_id: string
          asset_id: string | null
          batch_id: string | null
          created_at: string
          created_by: string | null
          id: string
          last_printed_at: string | null
          location_id: string | null
          printed_count: number
          source: string
          status: string
          tag: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "it_asset_tags"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      it_import_assets: {
        Args: { p_commit: boolean; p_create?: Json; p_rows: Json }
        Returns: Json
      }
      it_import_models: {
        Args: { p_commit: boolean; p_create?: Json; p_rows: Json }
        Returns: Json
      }
      it_import_subscriptions: {
        Args: { p_commit: boolean; p_create?: Json; p_rows: Json }
        Returns: Json
      }
      it_is_admin: { Args: never; Returns: boolean }
      it_is_shared_site: { Args: { loc: string }; Returns: boolean }
      it_is_staff: { Args: never; Returns: boolean }
      it_log_import: { Args: { p_summary: Json }; Returns: string }
      it_log_repair: {
        Args: {
          p_asset: string
          p_completed?: string
          p_cost?: number
          p_downtime_minutes?: number
          p_is_warranty?: boolean
          p_notes?: string
          p_out_of_service?: boolean
          p_start?: string
          p_supplier?: string
          p_title: string
          p_type: string
        }
        Returns: string
      }
      it_move: {
        Args: {
          p_area?: string
          p_asset_ids: string[]
          p_location: string
          p_note?: string
        }
        Returns: Json
      }
      it_next_tag: {
        Args: { p_account: string; p_location: string }
        Returns: string
      }
      it_num: { Args: { p: string }; Returns: number }
      it_overview: {
        Args: { p_location?: string; p_today?: string }
        Returns: Json
      }
      it_reminder_candidates: {
        Args: { p_account: string; p_horizon: number; p_today: string }
        Returns: {
          due_date: string
          entity_id: string
          entity_type: string
          info: Json
          kind: string
          location_id: string
          site: string
        }[]
      }
      it_resolve_tag: {
        Args: { p_short: string; p_tag: string }
        Returns: Json
      }
      it_reveal_secret: {
        Args: { p_asset: string; p_field: string }
        Returns: string
      }
      it_search: {
        Args: { p_limit?: number; p_q: string }
        Returns: {
          asset_tag: string
          category: string
          exact: boolean
          id: string
          matched: string
          name: string
          site: string
        }[]
      }
      it_set_secret: {
        Args: { p_asset: string; p_field: string; p_value: string }
        Returns: undefined
      }
      it_set_status: {
        Args: { p_asset_ids: string[]; p_note?: string; p_status_id: string }
        Returns: Json
      }
      it_start_audit: { Args: { p_location: string }; Returns: string }
      kiosk_punch: {
        Args: { p_employee_id: string; p_pin: string }
        Returns: string
      }
      kiosk_punch_by_pin: {
        Args: {
          p_distance_m?: number
          p_face_detected?: boolean
          p_lat?: number
          p_lng?: number
          p_location_id: string
          p_outside_fence?: boolean
          p_photo_path?: string
          p_pin: string
        }
        Returns: Json
      }
      kiosk_record_biometric_consent: {
        Args: {
          p_full_name: string
          p_location_id: string
          p_pin: string
          p_policy_version: string
          p_user_agent?: string
        }
        Returns: Json
      }
      mcp_set_error: {
        Args: { p_error: string; p_provider: string; p_user: string }
        Returns: undefined
      }
      mcp_status: { Args: never; Returns: Json }
      mcp_tokens_connect: {
        Args: { p_provider: string; p_tokens: Json; p_user: string }
        Returns: undefined
      }
      mcp_tokens_delete: {
        Args: { p_provider: string; p_user: string }
        Returns: undefined
      }
      mcp_tokens_get: {
        Args: { p_provider: string; p_user: string }
        Returns: Json
      }
      mcp_tokens_save: {
        Args: { p_provider: string; p_tokens: Json; p_user: string }
        Returns: undefined
      }
      mi__account: { Args: never; Returns: string }
      mi__actor_name: { Args: { p_user: string }; Returns: string }
      mi__add_interval: {
        Args: { p_date: string; p_n: number; p_unit: string }
        Returns: string
      }
      mi__alert_recipients: {
        Args: { p_alert: string }
        Returns: {
          name: string
          phone: string
          sms_ok: boolean
          user_id: string
        }[]
      }
      mi__area_for: {
        Args: { p_account: string; p_name: string; p_site: string }
        Returns: string
      }
      mi__audit_run: {
        Args: { p_open?: boolean; p_run: string }
        Returns: {
          account_id: string
          completed_at: string | null
          completed_by: string | null
          completed_by_name: string | null
          id: string
          location_id: string
          note: string | null
          scope: string
          started_at: string
          started_by: string | null
          started_by_name: string | null
          status: string
          summary: Json | null
        }
        SetofOptions: {
          from: "*"
          to: "mi_audit_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi__can_approve_transfer: {
        Args: { p_from: string; p_to: string }
        Returns: boolean
      }
      mi__checklist_asset: {
        Args: { p_linked: string; p_site: string }
        Returns: string
      }
      mi__clone_one: {
        Args: {
          p_children: boolean
          p_name: string
          p_parent: string
          p_src: string
        }
        Returns: string
      }
      mi__entry_parts_cost: {
        Args: { p_entry: string; p_wo: string }
        Returns: {
          cost: number
          n: number
        }[]
      }
      mi__eval_stock: {
        Args: { p_location: string; p_part: string }
        Returns: undefined
      }
      mi__force_count: {
        Args: { p_account: string; p_location: string; p_part: string }
        Returns: undefined
      }
      mi__idem_finish: {
        Args: { p_account: string; p_result: Json; p_txn: string }
        Returns: Json
      }
      mi__idem_start: {
        Args: { p_account: string; p_txn: string }
        Returns: Json
      }
      mi__interval_days: {
        Args: { p_n: number; p_unit: string }
        Returns: number
      }
      mi__local_date: {
        Args: { p_account: string; p_at: string }
        Returns: string
      }
      mi__make_count: {
        Args: {
          acct: string
          p_blind: boolean
          p_due: string
          p_location: string
          p_notes: string
          p_scheduled: boolean
          p_scope_type: string
          p_scope_value: string
        }
        Returns: Json
      }
      mi__next_number: {
        Args: { p_account: string; p_kind: string }
        Returns: number
      }
      mi__nightly: { Args: { p_account: string }; Returns: Json }
      mi__on_order: {
        Args: { p_location: string; p_part: string }
        Returns: number
      }
      mi__po_for_update: {
        Args: { p_po: string }
        Returns: {
          account_id: string
          approved_at: string | null
          approved_by: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          is_sample: boolean
          notes: string | null
          number: number
          sent_at: string | null
          sent_by: string | null
          sent_to: string | null
          ship_to_location_id: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          urgent: boolean
          vendor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mi_purchase_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi__post: {
        Args: {
          p_account: string
          p_allow_negative?: boolean
          p_asset?: string
          p_blend_cost?: boolean
          p_count?: string
          p_location: string
          p_notes?: string
          p_part: string
          p_po_line?: string
          p_qty: number
          p_reason?: string
          p_sample?: boolean
          p_source?: string
          p_transfer?: string
          p_txn?: string
          p_type: string
          p_unit_cost?: number
          p_wo?: string
        }
        Returns: {
          account_id: string
          asset_id: string | null
          client_txn_id: string | null
          count_id: string | null
          created_at: string
          id: string
          is_sample: boolean
          location_id: string
          notes: string | null
          part_id: string
          performed_by: string | null
          po_line_id: string | null
          qty: number
          qty_after: number
          qty_before: number
          reason_code: string | null
          source: string
          transfer_id: string | null
          type: string
          unit_cost: number
          work_order_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mi_inventory_transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi__raise_alert: {
        Args: {
          p_account: string
          p_bypass?: boolean
          p_count?: string
          p_detail?: Json
          p_key: string
          p_kind: string
          p_location?: string
          p_message: string
          p_part?: string
          p_target?: string
          p_tool?: string
        }
        Returns: undefined
      }
      mi__recompute_schedule: {
        Args: { p_schedule: string }
        Returns: undefined
      }
      mi__region_sites: {
        Args: { p_account: string; p_regions: string[] }
        Returns: string[]
      }
      mi__require_act: { Args: { p_location: string }; Returns: undefined }
      mi__require_manage: {
        Args: { p_location: string; p_what?: string }
        Returns: undefined
      }
      mi__require_rank: {
        Args: { p_rank: number; p_what?: string }
        Returns: undefined
      }
      mi__reserve: {
        Args: {
          p_account: string
          p_delta: number
          p_location: string
          p_part: string
          p_source: string
          p_txn?: string
          p_wo: string
        }
        Returns: undefined
      }
      mi__scan_bin: { Args: { p_bin: string; p_code: string }; Returns: Json }
      mi__scan_part: { Args: { p_code: string; p_part: string }; Returns: Json }
      mi__schedule_json: {
        Args: { p_attention?: boolean; p_ids: string[] }
        Returns: Json
      }
      mi__schedule_state: {
        Args: { p_ids: string[] }
        Returns: {
          anchor: string
          cars_due_on: string
          cars_pct: number
          cars_since: number
          daily_cars: number
          days_left: number
          due_on: string
          schedule_id: string
          status: string
          today: string
        }[]
      }
      mi__schedule_work_order: {
        Args: { p_by: string; p_by_name: string; p_schedule: string }
        Returns: {
          account_id: string
          completed_at: string | null
          completed_by: string | null
          completed_by_name: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          department: string | null
          description: string | null
          due_at: string | null
          equipment_id: string | null
          estimated_minutes: number | null
          id: string
          location_id: string
          maintainx_id: number | null
          maintainx_updated_at: string | null
          mi_schedule_id: string | null
          number: number
          parent_work_order_id: string | null
          pm_plan_id: string | null
          priority: string
          recurrence: string
          recurrence_interval: number | null
          recurrence_unit: string | null
          requested_by: string | null
          requested_by_name: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          start_at: string | null
          status: string
          title: string
          updated_at: string
          work_type: string
          work_type_source: string
        }
        SetofOptions: {
          from: "*"
          to: "work_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi__schedules_nightly: { Args: { p_account: string }; Returns: Json }
      mi__site_cars: {
        Args: {
          p_account: string
          p_after: string
          p_site: string
          p_through: string
        }
        Returns: number
      }
      mi__site_daily_cars: {
        Args: { p_account: string; p_site: string }
        Returns: number
      }
      mi__site_number: { Args: { p_site: string }; Returns: number }
      mi__stock_row: {
        Args: { s: Database["public"]["Tables"]["mi_stock_levels"]["Row"] }
        Returns: Json
      }
      mi__today: { Args: { p_account: string }; Returns: string }
      mi__tool_event: {
        Args: {
          p_action: string
          p_condition?: string
          p_due?: string
          p_from_loc: string
          p_from_user: string
          p_notes?: string
          p_source?: string
          p_to_loc: string
          p_to_user: string
          p_txn?: string
          t: Database["public"]["Tables"]["mi_tools"]["Row"]
        }
        Returns: undefined
      }
      mi__tool_for_update: {
        Args: { p_tool: string }
        Returns: {
          account_id: string
          category: string | null
          checked_out_at: string | null
          condition: string
          cost: number | null
          created_at: string
          created_by: string | null
          custodian_location_id: string | null
          custodian_user_id: string | null
          due_at: string | null
          home_location_id: string
          id: string
          is_sample: boolean
          make: string | null
          model: string | null
          name: string
          notes: string | null
          pending_at: string | null
          pending_from_user_id: string | null
          pending_to_location_id: string | null
          pending_to_user_id: string | null
          photo_path: string | null
          serial_number: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "mi_tools"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi__tunnel_items_json: { Args: { p_layout: string }; Returns: Json }
      mi__tunnel_layout_json: {
        Args: { l: Database["public"]["Tables"]["mi_tunnel_layouts"]["Row"] }
        Returns: Json
      }
      mi__usage: {
        Args: { p_account: string; p_assets: string[] }
        Returns: {
          asset_id: string
          basis: string
          cars_12m: number
          cars_30d: number
          cars_all: number
          cars_since: number
          cars_today: number
          data_from: string
          data_through: string
          since: string
          since_source: string
          state: string
        }[]
      }
      mi__wo_part: {
        Args: { p_location: string; p_part: string; p_wo: string }
        Returns: {
          catalog_part_id: string | null
          created_at: string
          id: string
          mi_location_id: string | null
          part_id: string | null
          part_name: string
          qty_issued: number
          qty_planned: number
          qty_returned: number
          quantity: number
          unit_cost: number | null
          work_order_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_order_parts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_accept_tool_transfer: {
        Args: { p_client_txn_id?: string; p_source?: string; p_tool: string }
        Returns: Json
      }
      mi_account_users: {
        Args: never
        Returns: {
          email: string
          id: string
          name: string
        }[]
      }
      mi_adjust_stock: {
        Args: {
          p_client_txn_id?: string
          p_delta: number
          p_location: string
          p_notes?: string
          p_part: string
          p_reason: string
          p_source?: string
          p_unit_cost?: number
        }
        Returns: Json
      }
      mi_alerts_list: { Args: { p_limit?: number }; Returns: Json }
      mi_approve_po: {
        Args: { p_approve?: boolean; p_po: string }
        Returns: {
          account_id: string
          approved_at: string | null
          approved_by: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          is_sample: boolean
          notes: string | null
          number: number
          sent_at: string | null
          sent_by: string | null
          sent_to: string | null
          ship_to_location_id: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          urgent: boolean
          vendor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mi_purchase_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_archive_schedule: { Args: { p_id: string }; Returns: undefined }
      mi_asset_detail: { Args: { p_asset: string }; Returns: Json }
      mi_assets_list: { Args: { p_q?: string; p_site: string }; Returns: Json }
      mi_audit_cancel: { Args: { p_run: string }; Returns: undefined }
      mi_audit_complete: {
        Args: { p_note?: string; p_rest_missing?: boolean; p_run: string }
        Returns: Json
      }
      mi_audit_detail: { Args: { p_run: string }; Returns: Json }
      mi_audit_mark: {
        Args: {
          p_area?: string
          p_condition?: string
          p_item: string
          p_note?: string
          p_result: string
        }
        Returns: undefined
      }
      mi_audit_scan: {
        Args: {
          p_area?: string
          p_code: string
          p_condition?: string
          p_run: string
        }
        Returns: Json
      }
      mi_audit_start: {
        Args: { p_scope?: string; p_site: string }
        Returns: string
      }
      mi_audits_list: { Args: never; Returns: Json }
      mi_blank_tags: { Args: { p_site?: string }; Returns: Json }
      mi_can_act_at: { Args: { p_location: string }; Returns: boolean }
      mi_can_manage_at: { Args: { p_location: string }; Returns: boolean }
      mi_cancel_count: { Args: { p_count: string }; Returns: undefined }
      mi_cancel_po: {
        Args: { p_po: string }
        Returns: {
          account_id: string
          approved_at: string | null
          approved_by: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          is_sample: boolean
          notes: string | null
          number: number
          sent_at: string | null
          sent_by: string | null
          sent_to: string | null
          ship_to_location_id: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          urgent: boolean
          vendor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mi_purchase_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_cancel_tool_transfer: { Args: { p_tool: string }; Returns: undefined }
      mi_cancel_transfer: {
        Args: { p_transfer: string }
        Returns: {
          account_id: string
          approved_at: string | null
          approved_by: string | null
          from_location_id: string
          id: string
          is_sample: boolean
          notes: string | null
          number: number
          received_at: string | null
          received_by: string | null
          requested_at: string
          requested_by: string | null
          shipped_at: string | null
          shipped_by: string | null
          status: string
          to_location_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mi_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_check_part_duplicates: {
        Args: {
          p_barcode?: string
          p_exclude?: string
          p_manufacturer?: string
          p_mpn?: string
          p_name: string
        }
        Returns: Json
      }
      mi_checklist_asset: {
        Args: { p_instance: string; p_item: string }
        Returns: string
      }
      mi_checkout_tool: {
        Args: {
          p_client_txn_id?: string
          p_due?: string
          p_source?: string
          p_to_location?: string
          p_to_user?: string
          p_tool: string
        }
        Returns: Json
      }
      mi_claim_tag: {
        Args: { p_asset: string; p_code: string; p_replace?: boolean }
        Returns: Json
      }
      mi_close_po: {
        Args: { p_po: string }
        Returns: {
          account_id: string
          approved_at: string | null
          approved_by: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          is_sample: boolean
          notes: string | null
          number: number
          sent_at: string | null
          sent_by: string | null
          sent_to: string | null
          ship_to_location_id: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          urgent: boolean
          vendor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mi_purchase_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_consume_context: {
        Args: { p_asset?: string; p_location: string; p_part: string }
        Returns: Json
      }
      mi_count_detail: { Args: { p_count: string }; Returns: Json }
      mi_counts_list: { Args: { p_status?: string }; Returns: Json }
      mi_create_count: {
        Args: {
          p_blind?: boolean
          p_due?: string
          p_location: string
          p_notes?: string
          p_scope_type?: string
          p_scope_value?: string
        }
        Returns: Json
      }
      mi_create_draft_pos: {
        Args: { p_client_txn_id?: string; p_lines: Json; p_urgent?: boolean }
        Returns: Json
      }
      mi_create_po: {
        Args: {
          p_location: string
          p_notes?: string
          p_urgent?: boolean
          p_vendor: string
        }
        Returns: {
          account_id: string
          approved_at: string | null
          approved_by: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          is_sample: boolean
          notes: string | null
          number: number
          sent_at: string | null
          sent_by: string | null
          sent_to: string | null
          ship_to_location_id: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          urgent: boolean
          vendor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mi_purchase_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_create_work_order: {
        Args: {
          p_asset?: string
          p_description?: string
          p_parts?: Json
          p_priority?: string
          p_site: string
          p_title: string
        }
        Returns: {
          account_id: string
          completed_at: string | null
          completed_by: string | null
          completed_by_name: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          department: string | null
          description: string | null
          due_at: string | null
          equipment_id: string | null
          estimated_minutes: number | null
          id: string
          location_id: string
          maintainx_id: number | null
          maintainx_updated_at: string | null
          mi_schedule_id: string | null
          number: number
          parent_work_order_id: string | null
          pm_plan_id: string | null
          priority: string
          recurrence: string
          recurrence_interval: number | null
          recurrence_unit: string | null
          requested_by: string | null
          requested_by_name: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          start_at: string | null
          status: string
          title: string
          updated_at: string
          work_type: string
          work_type_source: string
        }
        SetofOptions: {
          from: "*"
          to: "work_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_dashboard: {
        Args: { p_from?: string; p_site?: string; p_to?: string }
        Returns: Json
      }
      mi_decide_part_request: {
        Args: { p_approve: boolean; p_part?: Json; p_request: string }
        Returns: {
          account_id: string
          barcode: string | null
          created_part_id: string | null
          decided_at: string | null
          decided_by: string | null
          id: string
          manufacturer: string | null
          mfr_part_number: string | null
          name: string
          notes: string | null
          requested_at: string
          requested_by: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "mi_part_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_decide_transfer: {
        Args: { p_approve: boolean; p_transfer: string }
        Returns: {
          account_id: string
          approved_at: string | null
          approved_by: string | null
          from_location_id: string
          id: string
          is_sample: boolean
          notes: string | null
          number: number
          received_at: string | null
          received_by: string | null
          requested_at: string
          requested_by: string | null
          shipped_at: string | null
          shipped_by: string | null
          status: string
          to_location_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mi_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_ensure_tag: { Args: { p_id: string; p_type: string }; Returns: string }
      mi_enter_count: {
        Args: {
          p_client_txn_id?: string
          p_line: string
          p_qty: number
          p_source?: string
        }
        Returns: Json
      }
      mi_equipment_bulk: {
        Args: { p_ids: string[]; p_op: string; p_value?: string }
        Returns: Json
      }
      mi_equipment_clone: {
        Args: {
          p_asset: string
          p_count?: number
          p_names?: string[]
          p_with_children?: boolean
        }
        Returns: Json
      }
      mi_equipment_detail: { Args: { p_asset: string }; Returns: Json }
      mi_equipment_list: {
        Args: { p_include_retired?: boolean }
        Returns: Json
      }
      mi_equipment_restore: { Args: { p_ids: string[] }; Returns: Json }
      mi_equipment_retire: {
        Args: { p_ids: string[]; p_note?: string }
        Returns: Json
      }
      mi_equipment_save: { Args: { p: Json }; Returns: Json }
      mi_equipment_timeline: {
        Args: { p_asset: string; p_limit?: number }
        Returns: Json
      }
      mi_export_stock: { Args: never; Returns: Json }
      mi_finish_tool_audit: { Args: { p_audit: string }; Returns: Json }
      mi_generate_blank_tags: {
        Args: { p_count: number; p_site?: string }
        Returns: Json
      }
      mi_home: { Args: never; Returns: Json }
      mi_import_equipment: {
        Args: { p_commit?: boolean; p_rows: Json }
        Returns: Json
      }
      mi_import_parts: {
        Args: { p_commit?: boolean; p_rows: Json }
        Returns: Json
      }
      mi_issue_part: {
        Args: {
          p_asset?: string
          p_client_txn_id?: string
          p_location: string
          p_notes?: string
          p_part: string
          p_qty: number
          p_source?: string
          p_work_order?: string
        }
        Returns: Json
      }
      mi_label_setup: { Args: never; Returns: Json }
      mi_location_stock: {
        Args: { p_location: string; p_q?: string }
        Returns: Json
      }
      mi_log_add: {
        Args: { p: Json; p_client_txn_id?: string; p_source?: string }
        Returns: Json
      }
      mi_log_counts: { Args: never; Returns: Json }
      mi_log_entry: { Args: { p_id: string }; Returns: Json }
      mi_log_feed: { Args: { p?: Json }; Returns: Json }
      mi_log_report: {
        Args: { p_from?: string; p_site?: string; p_to?: string }
        Returns: Json
      }
      mi_log_update: { Args: { p: Json; p_id: string }; Returns: undefined }
      mi_log_void: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      mi_mark_po_sent: {
        Args: { p_po: string; p_sent_to?: string }
        Returns: {
          account_id: string
          approved_at: string | null
          approved_by: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          is_sample: boolean
          notes: string | null
          number: number
          sent_at: string | null
          sent_by: string | null
          sent_to: string | null
          ship_to_location_id: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          urgent: boolean
          vendor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mi_purchase_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_mark_printed: { Args: { p_codes: string[] }; Returns: undefined }
      mi_me: { Args: never; Returns: Json }
      mi_my_regions: { Args: never; Returns: string[] }
      mi_note_part_needed: {
        Args: { p_part: string; p_qty: number; p_work_order: string }
        Returns: undefined
      }
      mi_offline_snapshot: { Args: never; Returns: Json }
      mi_open_count_line: {
        Args: { p_location: string; p_part: string }
        Returns: Json
      }
      mi_open_po_lines: {
        Args: { p_location: string; p_part: string }
        Returns: Json
      }
      mi_part_detail: { Args: { p_part: string }; Returns: Json }
      mi_part_stock_for_site: {
        Args: { p_part: string; p_site: string }
        Returns: Json
      }
      mi_parts_forecast: {
        Args: { p_days?: number; p_site?: string }
        Returns: Json
      }
      mi_parts_list: {
        Args: {
          p_category?: string
          p_filter?: string
          p_limit?: number
          p_offset?: number
          p_q?: string
        }
        Returns: Json
      }
      mi_people: {
        Args: never
        Returns: {
          email: string
          has_phone: boolean
          id: string
          name: string
          region_names: string[]
          role: string
          site_ids: string[]
        }[]
      }
      mi_po_detail: { Args: { p_po: string }; Returns: Json }
      mi_po_total: { Args: { p_po: string }; Returns: number }
      mi_pos_list: { Args: { p_status?: string }; Returns: Json }
      mi_post_count: {
        Args: { p_client_txn_id?: string; p_count: string; p_decisions?: Json }
        Returns: Json
      }
      mi_rank: { Args: never; Returns: number }
      mi_receive_po_line: {
        Args: {
          p_bin?: string
          p_client_txn_id?: string
          p_line: string
          p_packing_slip?: string
          p_qty?: number
          p_source?: string
          p_unit_cost?: number
        }
        Returns: Json
      }
      mi_receive_stock: {
        Args: {
          p_bin?: string
          p_client_txn_id?: string
          p_location: string
          p_notes?: string
          p_part: string
          p_qty: number
          p_source?: string
          p_unit_cost: number
        }
        Returns: Json
      }
      mi_receive_transfer: {
        Args: {
          p_client_txn_id?: string
          p_lines?: Json
          p_notes?: string
          p_source?: string
          p_transfer: string
        }
        Returns: Json
      }
      mi_refs: { Args: never; Returns: Json }
      mi_remove_member: { Args: { p_user: string }; Returns: undefined }
      mi_remove_sample_data: { Args: never; Returns: Json }
      mi_reorder_suggestions: { Args: { p_location?: string }; Returns: Json }
      mi_report_tool_issue: {
        Args: {
          p_client_txn_id?: string
          p_condition: string
          p_notes?: string
          p_source?: string
          p_tool: string
        }
        Returns: Json
      }
      mi_request_part: {
        Args: {
          p_barcode?: string
          p_manufacturer?: string
          p_mpn?: string
          p_name: string
          p_notes?: string
        }
        Returns: {
          account_id: string
          barcode: string | null
          created_part_id: string | null
          decided_at: string | null
          decided_by: string | null
          id: string
          manufacturer: string | null
          mfr_part_number: string | null
          name: string
          notes: string | null
          requested_at: string
          requested_by: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "mi_part_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_reserve_parts: {
        Args: {
          p_client_txn_id?: string
          p_location: string
          p_part: string
          p_qty: number
          p_work_order: string
        }
        Returns: Json
      }
      mi_reset_usage: {
        Args: {
          p_asset: string
          p_client_txn_id?: string
          p_note?: string
          p_on?: string
        }
        Returns: Json
      }
      mi_resolve_scan: { Args: { p_raw: string }; Returns: Json }
      mi_retire_tag: {
        Args: { p_code: string; p_reason?: string }
        Returns: undefined
      }
      mi_return_part: {
        Args: {
          p_asset?: string
          p_client_txn_id?: string
          p_location: string
          p_notes?: string
          p_part: string
          p_qty: number
          p_source?: string
          p_work_order?: string
        }
        Returns: Json
      }
      mi_return_tool: {
        Args: {
          p_client_txn_id?: string
          p_condition?: string
          p_location?: string
          p_notes?: string
          p_source?: string
          p_tool: string
        }
        Returns: Json
      }
      mi_role: { Args: never; Returns: string }
      mi_save_part: {
        Args: { p: Json }
        Returns: {
          abc_class: string | null
          account_id: string
          barcode: string | null
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          is_critical: boolean
          is_sample: boolean
          lead_time_days: number | null
          link_url: string | null
          manufacturer: string | null
          mfr_part_number: string | null
          name: string
          ordering_part_number: string | null
          pack_qty: number
          part_number: number
          photo_path: string | null
          qr_code: string
          sku: string | null
          sku_legacy_dup: boolean
          spec: Json
          stale_days: number | null
          unit_cost: number | null
          uom: string
          updated_at: string
          vendor_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "parts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_save_po_line: {
        Args: {
          p_part: string
          p_po: string
          p_qty: number
          p_unit_cost?: number
        }
        Returns: undefined
      }
      mi_save_schedule: { Args: { p: Json }; Returns: Json }
      mi_save_tool: {
        Args: { p: Json }
        Returns: {
          account_id: string
          category: string | null
          checked_out_at: string | null
          condition: string
          cost: number | null
          created_at: string
          created_by: string | null
          custodian_location_id: string | null
          custodian_user_id: string | null
          due_at: string | null
          home_location_id: string
          id: string
          is_sample: boolean
          make: string | null
          model: string | null
          name: string
          notes: string | null
          pending_at: string | null
          pending_from_user_id: string | null
          pending_to_location_id: string | null
          pending_to_user_id: string | null
          photo_path: string | null
          serial_number: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "mi_tools"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_schedule_detail: { Args: { p_id: string }; Returns: Json }
      mi_schedule_work_order: { Args: { p_id: string }; Returns: Json }
      mi_schedules_list: {
        Args: {
          p_asset?: string
          p_part?: string
          p_q?: string
          p_site?: string
          p_status?: string
        }
        Returns: Json
      }
      mi_search_assets: { Args: { p_q: string }; Returns: Json }
      mi_set_bom_line: {
        Args: {
          p_asset: string
          p_notes?: string
          p_part: string
          p_qty: number
        }
        Returns: undefined
      }
      mi_set_checklist_item_asset: {
        Args: { p_asset: string; p_item: string }
        Returns: undefined
      }
      mi_set_member: {
        Args: {
          p_region_names?: string[]
          p_role: string
          p_site_ids?: string[]
          p_user: string
        }
        Returns: {
          account_id: string
          created_at: string
          created_by: string | null
          region_names: string[]
          role: string
          site_ids: string[]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mi_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_set_site_setting: {
        Args: { p_allow_negative: boolean; p_site: string }
        Returns: undefined
      }
      mi_set_stock_params: {
        Args: {
          p_bin?: string
          p_location: string
          p_max?: number
          p_min?: number
          p_part: string
          p_reorder?: number
        }
        Returns: {
          account_id: string
          available: number | null
          avg_cost: number
          bin_id: string | null
          id: string
          is_sample: boolean
          last_counted_at: string | null
          last_moved_at: string | null
          location_id: string
          max_qty: number | null
          min_qty: number | null
          on_hand: number
          part_id: string
          reorder_point: number | null
          reserved: number
        }
        SetofOptions: {
          from: "*"
          to: "mi_stock_levels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_set_tag_condition: {
        Args: { p_codes: string[]; p_condition: string }
        Returns: Json
      }
      mi_set_tool_status: {
        Args: { p_notes?: string; p_status: string; p_tool: string }
        Returns: {
          account_id: string
          category: string | null
          checked_out_at: string | null
          condition: string
          cost: number | null
          created_at: string
          created_by: string | null
          custodian_location_id: string | null
          custodian_user_id: string | null
          due_at: string | null
          home_location_id: string
          id: string
          is_sample: boolean
          make: string | null
          model: string | null
          name: string
          notes: string | null
          pending_at: string | null
          pending_from_user_id: string | null
          pending_to_location_id: string | null
          pending_to_user_id: string | null
          photo_path: string | null
          serial_number: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "mi_tools"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_ship_transfer: {
        Args: {
          p_client_txn_id?: string
          p_lines?: Json
          p_source?: string
          p_transfer: string
        }
        Returns: Json
      }
      mi_site_signals: { Args: { p_site?: string }; Returns: Json }
      mi_start_tool_audit: { Args: { p_location: string }; Returns: string }
      mi_start_tool_transfer: {
        Args: {
          p_client_txn_id?: string
          p_notes?: string
          p_source?: string
          p_to_location?: string
          p_to_user?: string
          p_tool: string
        }
        Returns: Json
      }
      mi_start_transfer: {
        Args: {
          p_client_txn_id?: string
          p_from: string
          p_lines: Json
          p_notes?: string
          p_to: string
        }
        Returns: Json
      }
      mi_sticker_queue: { Args: { p_site?: string }; Returns: Json }
      mi_stock_elsewhere: {
        Args: { p_exclude?: string; p_part: string }
        Returns: Json
      }
      mi_submit_count: { Args: { p_count: string }; Returns: Json }
      mi_submit_po: {
        Args: { p_po: string }
        Returns: {
          account_id: string
          approved_at: string | null
          approved_by: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          is_sample: boolean
          notes: string | null
          number: number
          sent_at: string | null
          sent_by: string | null
          sent_to: string | null
          ship_to_location_id: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          urgent: boolean
          vendor_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mi_purchase_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_tool_audit_scan: {
        Args: { p_audit: string; p_condition?: string; p_tool: string }
        Returns: undefined
      }
      mi_tool_detail: { Args: { p_tool: string }; Returns: Json }
      mi_tools_list: {
        Args: { p_mine?: boolean; p_q?: string; p_status?: string }
        Returns: Json
      }
      mi_transfers_list: { Args: { p_status?: string }; Returns: Json }
      mi_tunnel_apply: {
        Args: {
          p_commit?: boolean
          p_opts?: Json
          p_sites: string[]
          p_source: string
        }
        Returns: Json
      }
      mi_tunnel_delete: { Args: { p_layout: string }; Returns: undefined }
      mi_tunnel_get: {
        Args: { p_site: string; p_tunnel?: number }
        Returns: Json
      }
      mi_tunnel_link_item: {
        Args: { p_asset: string; p_item: string }
        Returns: Json
      }
      mi_tunnel_save: { Args: { p: Json }; Returns: Json }
      mi_tunnel_template: { Args: { p_layout: string }; Returns: Json }
      mi_tunnel_templates: { Args: never; Returns: Json }
      mi_update_asset: {
        Args: { p: Json; p_asset: string }
        Returns: undefined
      }
      mi_update_settings: {
        Args: { p: Json }
        Returns: {
          account_id: string
          auto_counts_enabled: boolean
          carrying_rate: number
          count_schedule: Json
          count_tolerance_pct: number
          count_variance_threshold: number
          high_value_photo_cost: number | null
          po_limits: Json
          quiet_end_hour: number
          quiet_start_hour: number
          sms_enabled: boolean
          stale_days: number
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "mi_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mi_visible_location_ids: { Args: never; Returns: string[] }
      mi_work_order_detail: { Args: { p_wo: string }; Returns: Json }
      mi_work_order_from_checklist: {
        Args: { p_instance: string; p_item: string; p_note?: string }
        Returns: Json
      }
      mi_work_orders_list: {
        Args: { p_q?: string; p_site?: string; p_status?: string }
        Returns: Json
      }
      mw_daily_summary:
        | { Args: never; Returns: Json }
        | { Args: { p_day: string }; Returns: Json }
      notify_location_managers: {
        Args: { p_kind: string; p_location_id: string; p_payload: Json }
        Returns: undefined
      }
      oauth_client_get: { Args: { p_provider: string }; Returns: Json }
      oauth_client_save: {
        Args: {
          p_client_id: string
          p_client_secret: string
          p_provider: string
          p_redirect_uris: string[]
        }
        Returns: undefined
      }
      operator_ask_sql: { Args: { query: string }; Returns: Json }
      pm_generate_for_plan: {
        Args: { p_advance?: boolean; p_plan_id: string }
        Returns: string
      }
      qb_check_login: {
        Args: { p_password: string; p_username: string }
        Returns: string
      }
      qb_new_password: {
        Args: never
        Returns: {
          password: string
          username: string
        }[]
      }
      qb_replace_list: {
        Args: { p_account: string; p_items: Json; p_type: string }
        Returns: number
      }
      qb_request_lists: { Args: never; Returns: undefined }
      resolve_kiosk_pin: {
        Args: { p_location_id: string; p_pin: string }
        Returns: Json
      }
      revoke_biometric_consent: {
        Args: { p_employee_id: string }
        Returns: undefined
      }
      set_employee_pin: {
        Args: { p_employee_id: string; p_pin: string }
        Returns: undefined
      }
      signup_account: {
        Args: {
          p_account_name: string
          p_location_name: string
          p_timezone?: string
          p_user_name?: string
        }
        Returns: string
      }
      site_daily_bounds: {
        Args: never
        Returns: {
          max_date: string
          min_date: string
        }[]
      }
      site_daily_totals: {
        Args: { p_end: string; p_start: string }
        Returns: {
          cars: number
          recharge: number
          sales: number
          site_number: number
        }[]
      }
      start_break: { Args: { p_break_id: string }; Returns: undefined }
      sync_maintainx_work_orders: { Args: { p_rows: Json }; Returns: number }
      users_for_site: {
        Args: { loc: string }
        Returns: {
          user_id: string
        }[]
      }
      wo_recompute_cost: { Args: { p_wo: string }; Returns: undefined }
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
