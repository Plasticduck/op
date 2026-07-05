import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type Employee = T['employees']['Row']
export type Schedule = T['schedules']['Row']
export type Shift = T['shifts']['Row']
export type TimeEntry = T['time_entries']['Row']
export type Review = T['reviews']['Row']
export type CounselingRecord = T['counseling_records']['Row']
export type InjuryReport = T['injury_reports']['Row']
export type UniformRequest = T['uniform_requests']['Row']

export const employees = {
  list: (loc: string) =>
    supabase.from('employees').select('*').eq('location_id', loc).order('first_name'),
  listActive: (loc: string) =>
    supabase.from('employees').select('*').eq('location_id', loc).eq('status', 'active').order('first_name'),
  get: (id: string) => supabase.from('employees').select('*').eq('id', id).single(),
  // Active roster staff with no app login yet (user_id is null), across the given
  // locations. Used by the Team page to offer converting them to users.
  listNonUsers: (locationIds: string[]) =>
    supabase
      .from('employees')
      .select('*')
      .in('location_id', locationIds)
      .is('user_id', null)
      .eq('status', 'active')
      .order('first_name'),
  create: (row: T['employees']['Insert']) =>
    supabase.from('employees').insert(row).select().single(),
  update: (id: string, patch: T['employees']['Update']) =>
    supabase.from('employees').update(patch).eq('id', id),
  setPin: (employeeId: string, pin: string) =>
    supabase.rpc('set_employee_pin', { p_employee_id: employeeId, p_pin: pin }),
  byUser: (userId: string) =>
    supabase.from('employees').select('*').eq('user_id', userId).maybeSingle(),
}

export function currentlyWorking(locationId: string) {
  return supabase.rpc('currently_working', { p_location_id: locationId })
}

export const schedules = {
  getWeek: (loc: string, weekStart: string) =>
    supabase
      .from('schedules')
      .select('*')
      .eq('location_id', loc)
      .eq('week_start_date', weekStart)
      .maybeSingle(),
  create: (row: T['schedules']['Insert']) =>
    supabase.from('schedules').insert(row).select().single(),
  publish: (id: string, published: boolean) =>
    supabase.from('schedules').update({ published }).eq('id', id),
  shifts: (scheduleId: string) =>
    supabase.from('shifts').select('*').eq('schedule_id', scheduleId),
  addShift: (row: T['shifts']['Insert']) =>
    supabase.from('shifts').insert(row).select().single(),
  updateShift: (id: string, patch: T['shifts']['Update']) =>
    supabase.from('shifts').update(patch).eq('id', id).select().single(),
  removeShift: (id: string) => supabase.from('shifts').delete().eq('id', id),
  // Cross-location conflict detection: every shift for these employees in this
  // date range, joined to schedule.location_id so the caller can flag a double-
  // booking at a site the manager doesn't currently have open.
  shiftsForEmployeesInRange: (employeeIds: string[], fromDate: string, toDate: string) =>
    employeeIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string; employee_id: string; date: string; start_time: string; end_time: string; schedule: { id: string; location_id: string } | null }>, error: null })
      : supabase
          .from('shifts')
          .select('id, employee_id, date, start_time, end_time, schedule:schedule_id(id, location_id)')
          .in('employee_id', employeeIds)
          .gte('date', fromDate)
          .lte('date', toDate),
}

export const timeEntries = {
  forPeriod: (loc: string, startIso: string, endIso: string) =>
    supabase
      .from('time_entries')
      .select('*, employee:employee_id(first_name, last_name)')
      .eq('location_id', loc)
      .gte('clock_in', startIso)
      .lte('clock_in', endIso)
      .order('clock_in', { ascending: false }),
  update: (id: string, patch: T['time_entries']['Update']) =>
    supabase.from('time_entries').update(patch).eq('id', id),
  kioskPunch: (employeeId: string, pin: string) =>
    supabase.rpc('kiosk_punch', { p_employee_id: employeeId, p_pin: pin }),
  resolveKioskPin: (locationId: string, pin: string) =>
    supabase.rpc('resolve_kiosk_pin', { p_location_id: locationId, p_pin: pin }),
  kioskPunchByPin: (locationId: string, pin: string, meta?: {
    lat: number | null
    lng: number | null
    distance_m: number | null
    outside_fence: boolean | null
    face_detected: boolean | null
    photo_path: string | null
  }) =>
    supabase.rpc('kiosk_punch_by_pin', {
      p_location_id: locationId,
      p_pin: pin,
      p_lat: meta?.lat ?? undefined,
      p_lng: meta?.lng ?? undefined,
      p_distance_m: meta?.distance_m ?? undefined,
      p_outside_fence: meta?.outside_fence ?? undefined,
      p_face_detected: meta?.face_detected ?? undefined,
      p_photo_path: meta?.photo_path ?? undefined,
    }),
  uploadPunchPhoto: async (accountId: string, employeeId: string, blob: Blob) => {
    const path = `${accountId}/${employeeId}/${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage
      .from('punch-photos')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
    return { error, path: error ? null : path }
  },
  punchPhotoSignedUrl: async (path: string, expiresIn = 3600) => {
    const { data, error } = await supabase.storage
      .from('punch-photos')
      .createSignedUrl(path, expiresIn)
    return { error, url: data?.signedUrl ?? null }
  },
}

export const reviews = {
  list: (employeeIds: string[]) =>
    supabase.from('reviews').select('*').in('employee_id', employeeIds).order('created_at', { ascending: false }),
  forEmployee: (employeeId: string) =>
    supabase.from('reviews').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }),
  create: (row: T['reviews']['Insert']) =>
    supabase.from('reviews').insert(row).select().single(),
  update: (id: string, patch: T['reviews']['Update']) =>
    supabase.from('reviews').update(patch).eq('id', id),
}

export const counseling = {
  list: (employeeIds: string[]) =>
    supabase.from('counseling_records').select('*').in('employee_id', employeeIds).order('date', { ascending: false }),
  forEmployee: (employeeId: string) =>
    supabase.from('counseling_records').select('*').eq('employee_id', employeeId).order('date', { ascending: false }),
  create: (row: T['counseling_records']['Insert']) =>
    supabase.from('counseling_records').insert(row).select().single(),
}

export const injuries = {
  list: (loc: string) =>
    supabase
      .from('injury_reports')
      .select('*, employee:employee_id(first_name, last_name)')
      .eq('location_id', loc)
      .order('incident_date', { ascending: false }),
  create: (row: T['injury_reports']['Insert']) =>
    supabase.from('injury_reports').insert(row).select().single(),
}

export const uniforms = {
  list: (employeeIds: string[]) =>
    supabase.from('uniform_requests').select('*').in('employee_id', employeeIds).order('requested_at', { ascending: false }),
  forEmployee: (employeeId: string) =>
    supabase.from('uniform_requests').select('*').eq('employee_id', employeeId).order('requested_at', { ascending: false }),
  create: (row: T['uniform_requests']['Insert']) =>
    supabase.from('uniform_requests').insert(row).select().single(),
  update: (id: string, patch: T['uniform_requests']['Update']) =>
    supabase.from('uniform_requests').update(patch).eq('id', id),
}

export type TimeOffRequest = T['time_off_requests']['Row']
export type CalendarEvent = T['calendar_events']['Row']
export type Break = T['breaks']['Row']

export const timeOff = {
  forLocation: (loc: string) =>
    supabase
      .from('time_off_requests')
      .select('*, employee:employee_id(first_name, last_name)')
      .eq('location_id', loc)
      .order('start_date', { ascending: false }),
  forEmployee: (employeeId: string) =>
    supabase.from('time_off_requests').select('*').eq('employee_id', employeeId).order('start_date', { ascending: false }),
  create: (row: T['time_off_requests']['Insert']) =>
    supabase.from('time_off_requests').insert(row).select().single(),
  decide: (id: string, status: 'approved' | 'denied', reviewedBy: string) =>
    supabase
      .from('time_off_requests')
      .update({ status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
      .eq('id', id),
  remove: (id: string) => supabase.from('time_off_requests').delete().eq('id', id),
}

export const calendar = {
  forLocation: (loc: string, fromIso: string) =>
    supabase
      .from('calendar_events')
      .select('*')
      .eq('location_id', loc)
      .gte('start_at', fromIso)
      .order('start_at'),
  create: (row: T['calendar_events']['Insert']) =>
    supabase.from('calendar_events').insert(row).select().single(),
  remove: (id: string) => supabase.from('calendar_events').delete().eq('id', id),
}

export const breaks = {
  forLocation: (loc: string, fromIso: string) =>
    supabase
      .from('breaks')
      .select('*, employee:employee_id(first_name, last_name)')
      .eq('location_id', loc)
      .gte('scheduled_start', fromIso)
      .order('scheduled_start'),
  forEmployee: (employeeId: string, fromIso: string) =>
    supabase
      .from('breaks')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('scheduled_start', fromIso)
      .order('scheduled_start'),
  create: (row: T['breaks']['Insert']) =>
    supabase.from('breaks').insert(row).select().single(),
  update: (id: string, patch: T['breaks']['Update']) =>
    supabase.from('breaks').update(patch).eq('id', id),
  remove: (id: string) => supabase.from('breaks').delete().eq('id', id),
  // Employee goes on break: marks it started and auto clocks them out. Returning
  // from break is kiosk-only (the kiosk clock-in ends the break).
  start: (id: string) => supabase.rpc('start_break', { p_break_id: id }),
}
