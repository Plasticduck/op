import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  type LucideIcon,
} from 'lucide-react'

// Geocoding via Nominatim (OpenStreetMap) — free, keyless, continuously updated.
// Converts a street address to coordinates so the weather outlook needs no
// manual lat/long entry. Low volume (only on location create/edit) keeps us well
// within OSM's usage policy.
export async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lon: number } | null> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const arr = (await res.json()) as { lat: string; lon: string }[]
    if (!Array.isArray(arr) || arr.length === 0) return null
    const lat = parseFloat(arr[0].lat)
    const lon = parseFloat(arr[0].lon)
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
  } catch {
    return null
  }
}

// Weekly forecast via Open-Meteo (free, no API key). Driven by a location's
// latitude/longitude.

export type DayForecast = {
  date: string
  code: number
  tMax: number
  tMin: number
  rain: number // precipitation probability %, max for the day
}

export async function fetchWeather(lat: number, lon: number): Promise<DayForecast[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&hourly=cloud_cover,precipitation_probability` +
    `&temperature_unit=fahrenheit&timezone=auto&forecast_days=7`
  const res = await fetch(url)
  if (!res.ok) throw new Error('weather fetch failed')
  const j = (await res.json()) as {
    daily: {
      time: string[]
      weather_code: number[]
      temperature_2m_max: number[]
      temperature_2m_min: number[]
      precipitation_probability_max: (number | null)[]
    }
    hourly: { time: string[]; cloud_cover: number[]; precipitation_probability: (number | null)[] }
  }

  // Open-Meteo's daily weather_code reports the *most significant* condition over
  // a full 24h, so it over-reports both clouds and precipitation (a sunny 90°F
  // day gets tagged "overcast" or "drizzle" from a brief overnight trace). We
  // recompute the day's icon from real *daytime* (8am–6pm) data instead.
  const cloudByDate: Record<string, number[]> = {}
  const ppByDate: Record<string, number[]> = {}
  const h = j.hourly
  if (h?.time) {
    h.time.forEach((t, i) => {
      const [date, hm] = t.split('T')
      const hr = Number(hm.slice(0, 2))
      if (hr < 8 || hr > 18) return
      ;(cloudByDate[date] ??= []).push(h.cloud_cover[i])
      ;(ppByDate[date] ??= []).push(h.precipitation_probability[i] ?? 0)
    })
  }
  const mean = (a: number[]) => a.reduce((x, c) => x + c, 0) / a.length

  // Reclassify a day's WMO code from daytime cloud cover + daytime rain chance.
  const reclassify = (code: number, date: string): number => {
    const clouds = cloudByDate[date]
    if (!clouds || clouds.length === 0) return code // no hourly data → trust daily
    const avgCloud = mean(clouds)
    const maxPP = Math.max(0, ...(ppByDate[date] ?? []))

    // Snow and storms are significant + safety-relevant: always honor them.
    if ((code >= 71 && code <= 77) || code === 85 || code === 86 || code >= 95) return code
    // Rain / drizzle / showers: only show if rain is actually likely in the day.
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
      if (maxPP >= 40) return code
      // otherwise fall through to the sky condition
    } else if (code === 45 || code === 48) {
      // Fog: keep only if it's genuinely murky during the day.
      if (avgCloud >= 60) return code
    }
    // Sky condition from daytime cloud cover.
    return avgCloud < 30 ? 0 : avgCloud < 65 ? 2 : 3
  }

  const d = j.daily
  return d.time.map((date, i) => {
    const code = reclassify(d.weather_code[i], date)
    return {
      date,
      code,
      tMax: Math.round(d.temperature_2m_max[i]),
      tMin: Math.round(d.temperature_2m_min[i]),
      rain: d.precipitation_probability_max[i] ?? 0,
    }
  })
}

// WMO weather code → short label + Lucide icon + a playful color and gentle
// motion. `color` is a hex applied inline (independent of the theme palette);
// `anim` is a CSS class defined in index.css (sun spins, clouds bob, rain drips,
// storm flashes), all gated behind prefers-reduced-motion.
export type WeatherStyle = {
  label: string
  Icon: LucideIcon
  color: string
  anim: string
}

export function weatherLabel(code: number): WeatherStyle {
  // WMO: 0 clear, 1 mainly clear, 2 partly cloudy, 3 overcast. Codes 0–1 are
  // sunny (don't show a cloud); only 2 is partly cloudy.
  if (code <= 1) return { label: code === 0 ? 'Clear' : 'Mainly clear', Icon: Sun, color: '#f59e0b', anim: 'wx-bob' }
  if (code === 2) return { label: 'Partly cloudy', Icon: CloudSun, color: '#fbbf24', anim: 'wx-bob' }
  if (code === 3) return { label: 'Overcast', Icon: Cloud, color: '#94a3b8', anim: 'wx-bob' }
  if (code <= 48) return { label: 'Fog', Icon: CloudFog, color: '#cbd5e1', anim: 'wx-bob' }
  if (code <= 57) return { label: 'Drizzle', Icon: CloudDrizzle, color: '#38bdf8', anim: 'wx-drip' }
  if (code <= 67) return { label: 'Rain', Icon: CloudRain, color: '#3b82f6', anim: 'wx-drip' }
  if (code <= 77) return { label: 'Snow', Icon: CloudSnow, color: '#7dd3fc', anim: 'wx-bob' }
  if (code <= 82) return { label: 'Showers', Icon: CloudRain, color: '#2563eb', anim: 'wx-drip' }
  if (code <= 86) return { label: 'Snow showers', Icon: CloudSnow, color: '#67e8f9', anim: 'wx-bob' }
  return { label: 'Storm', Icon: CloudLightning, color: '#8b5cf6', anim: 'wx-flash' }
}
