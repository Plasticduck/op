import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// The Driver Assignment phone app (/driverassignment). Everything goes through the
// driver-assign edge function: a driver is identified by their 4-digit PIN alone
// (fleet_driver_pins, RLS-locked; Admins set PINs in Fleet Management), and the
// PIN is sent with every call.

const FN = 'driver-assign'

export type DriverSession = { pin: string; name: string; vehicle: string | null }
export type Assigned = { vehicle: { name: string; description: string | null }; already?: boolean; replaced?: string | null }

type Result<T> = { data: T; error: null } | { data: null; error: string }

async function call<T>(body: Record<string, unknown>, fallback: string): Promise<Result<T>> {
  const { data, error } = await supabase.functions.invoke(FN, { body })
  if (error || !data?.ok) return { data: null, error: await fnErrorMessage(error, data, fallback) }
  return { data: data as T, error: null }
}

export const driverAssign = {
  signIn: async (pin: string): Promise<Result<DriverSession>> => {
    const r = await call<{ driver: { name: string }; vehicle: { name: string } | null }>({ action: 'sign_in', pin }, "Couldn't check that PIN.")
    if (r.error !== null) return r
    return { data: { pin, name: r.data.driver.name, vehicle: r.data.vehicle?.name ?? null }, error: null }
  },

  // `code`: what the camera read off the sticker (the /v/<code> link or the code).
  assign: (pin: string, code: string) => call<Assigned>({ action: 'assign', pin, code }, "Couldn't put you on that vehicle."),
}
