import { useEffect, useState } from 'react'
import { CloudRain } from 'lucide-react'
import { format } from 'date-fns'
import { fetchWeather, weatherLabel, type DayForecast } from '@/lib/weather'
import { cn } from '@/lib/utils'

export function WeatherOutlook({
  latitude,
  longitude,
}: {
  latitude: number | null
  longitude: number | null
}) {
  const [days, setDays] = useState<DayForecast[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (latitude == null || longitude == null) return
    let active = true
    fetchWeather(latitude, longitude)
      .then((d) => active && setDays(d))
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [latitude, longitude])

  if (latitude == null || longitude == null) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card px-4 py-3 text-sm text-ink-muted">
        Set this location's coordinates (Settings → Locations) to see the weekly weather outlook.
      </div>
    )
  }

  if (failed) return null

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
        <CloudRain className="size-3.5" /> 7-day outlook
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {(days ?? Array.from({ length: 7 })).map((d, i) => {
          if (!d) return <div key={i} className="h-16 animate-pulse rounded-md bg-content sm:h-20" />
          const w = weatherLabel(d.code)
          return (
            <div key={d.date} className="flex min-w-0 flex-col items-center rounded-md bg-content p-1 text-center sm:p-2">
              <div className="text-[10px] font-medium text-ink sm:text-xs">{format(new Date(d.date + 'T00:00'), 'EEE')}</div>
              <w.Icon
                className={cn('my-1 size-6 sm:my-1.5 sm:size-8', w.anim)}
                style={{ color: w.color }}
                strokeWidth={2.25}
                aria-label={w.label}
              />
              <div className="tabular text-[10px] leading-tight text-ink sm:text-xs">
                {d.tMax}°<span className="text-ink-subtle">/{d.tMin}°</span>
              </div>
              <div className="tabular mt-0.5 text-[10px] text-accent sm:text-[11px]">{d.rain}%<span className="hidden sm:inline"> rain</span></div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
