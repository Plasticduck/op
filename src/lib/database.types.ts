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
      accounts: {
        Row: {
          account_type: string
          billing_status: string
          company_settings: Json
          created_at: string
          id: string
          invoice_inbox_token: string
          is_demo: boolean
          name: string
          plan: string | null
          site_plan: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_quantity: number
          trial_ends_at: string
        }
        Insert: {
          account_type?: string
          billing_status?: string
          company_settings?: Json
          created_at?: string
          id?: string
          invoice_inbox_token: string
          is_demo?: boolean
          name: string
          plan?: string | null
          site_plan?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_quantity?: number
          trial_ends_at?: string
        }
        Update: {
          account_type?: string
          billing_status?: string
          company_settings?: Json
          created_at?: string
          id?: string
          invoice_inbox_token?: string
          is_demo?: boolean
          name?: string
          plan?: string | null
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
          checklist_id: string
          id: string
          label: string
          order_index: number
          requires_photo: boolean
        }
        Insert: {
          checklist_id: string
          id?: string
          label: string
          order_index?: number
          requires_photo?: boolean
        }
        Update: {
          checklist_id?: string
          id?: string
          label?: string
          order_index?: number
          requires_photo?: boolean
        }
        Relationships: [
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
      employees: {
        Row: {
          avatar_url: string | null
          certifications: string[] | null
          created_at: string
          email: string | null
          first_name: string
          hourly_rate: number | null
          id: string
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
          asset_number: number
          created_at: string
          criticality: string
          description: string | null
          id: string
          last_serviced_at: string | null
          location_id: string
          manufacturer: string | null
          model: string | null
          name: string
          parent_asset_id: string | null
          purchase_date: string | null
          qr_code: string | null
          serial_number: string | null
          service_interval_days: number | null
          status: string
          type: string | null
          updated_at: string
          warranty_expiry: string | null
        }
        Insert: {
          account_id: string
          asset_number: number
          created_at?: string
          criticality?: string
          description?: string | null
          id?: string
          last_serviced_at?: string | null
          location_id: string
          manufacturer?: string | null
          model?: string | null
          name: string
          parent_asset_id?: string | null
          purchase_date?: string | null
          qr_code?: string | null
          serial_number?: string | null
          service_interval_days?: number | null
          status?: string
          type?: string | null
          updated_at?: string
          warranty_expiry?: string | null
        }
        Update: {
          account_id?: string
          asset_number?: number
          created_at?: string
          criticality?: string
          description?: string | null
          id?: string
          last_serviced_at?: string | null
          location_id?: string
          manufacturer?: string | null
          model?: string | null
          name?: string
          parent_asset_id?: string | null
          purchase_date?: string | null
          qr_code?: string | null
          serial_number?: string | null
          service_interval_days?: number | null
          status?: string
          type?: string | null
          updated_at?: string
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
      inventory_counts: {
        Row: {
          account_id: string
          brand: string | null
          category: string | null
          created_at: string
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
          id: string
          item: string | null
        }
        Insert: {
          account_id: string
          brand?: string | null
          category?: string | null
          created_at?: string
          id?: string
          item?: string | null
        }
        Update: {
          account_id?: string
          brand?: string | null
          category?: string | null
          created_at?: string
          id?: string
          item?: string | null
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
      locations: {
        Row: {
          account_id: string
          address: string | null
          archived: boolean
          closeout_time: string
          created_at: string
          downtime_alert_hours: number
          geofence_radius_m: number
          id: string
          latitude: number | null
          longitude: number | null
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
          geofence_radius_m?: number
          id?: string
          latitude?: number | null
          longitude?: number | null
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
          geofence_radius_m?: number
          id?: string
          latitude?: number | null
          longitude?: number | null
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
      messages: {
        Row: {
          attachment_path: string | null
          attachment_type: string | null
          body: string | null
          conversation_id: string
          created_at: string
          edited_at: string | null
          id: string
          sender_id: string
        }
        Insert: {
          attachment_path?: string | null
          attachment_type?: string | null
          body?: string | null
          conversation_id: string
          created_at?: string
          edited_at?: string | null
          id?: string
          sender_id: string
        }
        Update: {
          attachment_path?: string | null
          attachment_type?: string | null
          body?: string | null
          conversation_id?: string
          created_at?: string
          edited_at?: string | null
          id?: string
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
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
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
          assigned_at: string | null
          assigned_to: string | null
          assigned_to_name: string | null
          decided_at: string | null
          decided_by: string | null
          decided_by_name: string | null
          decision_reason: string | null
          file_name: string | null
          file_type: string | null
          gl_code: string | null
          id: string
          invoice_date: string | null
          location_id: string | null
          notify_status: string | null
          status: string
          submitted_at: string
          submitted_by: string | null
          submitted_by_name: string | null
          vendor_name: string | null
        }
        Insert: {
          account_id: string
          amount?: number
          assigned_at?: string | null
          assigned_to?: string | null
          assigned_to_name?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          decision_reason?: string | null
          file_name?: string | null
          file_type?: string | null
          gl_code?: string | null
          id?: string
          invoice_date?: string | null
          location_id?: string | null
          notify_status?: string | null
          status?: string
          submitted_at?: string
          submitted_by?: string | null
          submitted_by_name?: string | null
          vendor_name?: string | null
        }
        Update: {
          account_id?: string
          amount?: number
          assigned_at?: string | null
          assigned_to?: string | null
          assigned_to_name?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          decision_reason?: string | null
          file_name?: string | null
          file_type?: string | null
          gl_code?: string | null
          id?: string
          invoice_date?: string | null
          location_id?: string | null
          notify_status?: string | null
          status?: string
          submitted_at?: string
          submitted_by?: string | null
          submitted_by_name?: string | null
          vendor_name?: string | null
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
          part_id: string
        }
        Insert: {
          asset_id: string
          part_id: string
        }
        Update: {
          asset_id?: string
          part_id?: string
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
          account_id: string
          created_at: string
          description: string | null
          id: string
          lead_time_days: number | null
          link_url: string | null
          manufacturer: string | null
          name: string
          ordering_part_number: string | null
          part_number: number
          qr_code: string
          sku: string | null
          unit_cost: number | null
          uom: string
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          description?: string | null
          id?: string
          lead_time_days?: number | null
          link_url?: string | null
          manufacturer?: string | null
          name: string
          ordering_part_number?: string | null
          part_number: number
          qr_code: string
          sku?: string | null
          unit_cost?: number | null
          uom?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          description?: string | null
          id?: string
          lead_time_days?: number | null
          link_url?: string | null
          manufacturer?: string | null
          name?: string
          ordering_part_number?: string | null
          part_number?: number
          qr_code?: string
          sku?: string | null
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
      site_audits: {
        Row: {
          account_id: string
          created_at: string
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
          submitted_by: string | null
          submitted_by_name: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
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
          submitted_by?: string | null
          submitted_by_name?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
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
          submitted_by?: string | null
          submitted_by_name?: string | null
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
          created_at: string
          id: string
          item: string
          location_id: string
          notes: string | null
          quantity: number
          requested_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          item: string
          location_id: string
          notes?: string | null
          quantity?: number
          requested_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          item?: string
          location_id?: string
          notes?: string | null
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
      uniform_requests: {
        Row: {
          employee_id: string
          fulfilled_at: string | null
          id: string
          item: string
          quantity: number
          requested_at: string
          size: string | null
          status: string
        }
        Insert: {
          employee_id: string
          fulfilled_at?: string | null
          id?: string
          item: string
          quantity?: number
          requested_at?: string
          size?: string | null
          status?: string
        }
        Update: {
          employee_id?: string
          fulfilled_at?: string | null
          id?: string
          item?: string
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
          role: string
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
          role: string
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
          role?: string
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
          created_at: string
          id: string
          part_id: string | null
          part_name: string
          quantity: number
          unit_cost: number | null
          work_order_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          part_id?: string | null
          part_name: string
          quantity?: number
          unit_cost?: number | null
          work_order_id: string
        }
        Update: {
          created_at?: string
          id?: string
          part_id?: string | null
          part_name?: string
          quantity?: number
          unit_cost?: number | null
          work_order_id?: string
        }
        Relationships: [
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
          description: string | null
          due_at: string | null
          equipment_id: string | null
          estimated_minutes: number | null
          id: string
          location_id: string
          number: number
          parent_work_order_id: string | null
          priority: string
          recurrence: string
          recurrence_interval: number | null
          recurrence_unit: string | null
          requested_by: string | null
          requested_by_name: string | null
          start_at: string | null
          status: string
          title: string
          updated_at: string
          work_type: string
        }
        Insert: {
          account_id: string
          completed_at?: string | null
          completed_by?: string | null
          completed_by_name?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          description?: string | null
          due_at?: string | null
          equipment_id?: string | null
          estimated_minutes?: number | null
          id?: string
          location_id: string
          number?: number
          parent_work_order_id?: string | null
          priority?: string
          recurrence?: string
          recurrence_interval?: number | null
          recurrence_unit?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          start_at?: string | null
          status?: string
          title: string
          updated_at?: string
          work_type?: string
        }
        Update: {
          account_id?: string
          completed_at?: string | null
          completed_by?: string | null
          completed_by_name?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          description?: string | null
          due_at?: string | null
          equipment_id?: string | null
          estimated_minutes?: number | null
          id?: string
          location_id?: string
          number?: number
          parent_work_order_id?: string | null
          priority?: string
          recurrence?: string
          recurrence_interval?: number | null
          recurrence_unit?: string | null
          requested_by?: string | null
          requested_by_name?: string | null
          start_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          work_type?: string
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
            foreignKeyName: "work_orders_parent_work_order_id_fkey"
            columns: ["parent_work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
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
    }
    Functions: {
      accept_invitation: {
        Args: { p_token: string; p_user_name?: string }
        Returns: string
      }
      account_for_invoice_token: { Args: { p_token: string }; Returns: string }
      acknowledge_counseling: {
        Args: { p_record_id: string }
        Returns: undefined
      }
      auth_account_id: { Args: never; Returns: string }
      auth_can_see_employee: { Args: { emp: string }; Returns: boolean }
      auth_employee_id: { Args: never; Returns: string }
      auth_has_location: { Args: { loc: string }; Returns: boolean }
      auth_in_conversation: { Args: { conv: string }; Returns: boolean }
      auth_is_manager_plus: { Args: never; Returns: boolean }
      auth_location_ids: { Args: never; Returns: string[] }
      auth_role: { Args: never; Returns: string }
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
      get_invitation_email: { Args: { p_token: string }; Returns: string }
      get_invitation_info: { Args: { p_token: string }; Returns: Json }
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
      notify_location_managers: {
        Args: { p_kind: string; p_location_id: string; p_payload: Json }
        Returns: undefined
      }
      resolve_kiosk_pin: {
        Args: { p_location_id: string; p_pin: string }
        Returns: Json
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
      start_break: { Args: { p_break_id: string }; Returns: undefined }
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
