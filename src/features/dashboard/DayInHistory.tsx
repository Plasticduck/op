// "This day in car wash history" — a friendly dashboard greeting. There's no
// public car-wash-history API, so this is a curated pool of history/trivia that
// rotates one entry per day (stable within a day, different across days).

const CAR_WASH_HISTORY: string[] = [
  'The first car wash is credited to Detroit in 1914, where attendants pushed cars by hand through a line of wash stations.',
  'Early "automatic" washes in the 1940s still needed workers to soap and rinse. The car moved, but people did the scrubbing.',
  'The first fully automatic conveyor car wash appeared around 1946, using pumps, sprinklers, and blowers instead of hands.',
  "Dan Hanna's \"Rub a Dub\" washes in 1950s Portland, Oregon helped turn the car wash into a fast, franchised business.",
  'Soft cloth (friction) washing was introduced to clean paint more gently than stiff brushes.',
  'Touchless washes skip brushes entirely, relying on high pressure water and stronger detergents.',
  'A modern express tunnel can wash a car in about three minutes, start to finish.',
  'Many modern washes reclaim and reuse well over half of their water.',
  'Rose Royce\'s 1976 hit "Car Wash" made the corner car wash a piece of pop culture history.',
  'The conveyor chain that pulls cars through a tunnel borrowed ideas from the auto assembly line.',
  'Foaming bug prep and presoak arches were added over time to loosen grime before the main wash.',
  'Spot free rinses use purified (reverse osmosis) water so cars dry without water spots.',
  'Unlimited monthly wash memberships reshaped the industry in the 2010s, trading one big wash for many small ones.',
  'Ceramic and graphene sealants are a recent addition to many wash menus.',
  'Early hand car washes could take a crew 15 minutes or more per vehicle.',
  'Air dryers replaced hand toweling in tunnels, using powerful blowers to sheet water off the paint.',
  'The self serve coin op bay, a mainstay of the 1960s, let drivers wash their own cars for a quarter.',
  'Wraparound mitter curtains of soft cloth strips are a signature sight inside friction tunnels.',
  'Undercarriage sprayers were added to blast away road salt, a big deal in snowy climates.',
  'Tire shine applicators automated a finishing touch that used to be done by hand.',
  'Water recycling was not just green. It helped washes stay open during droughts and water restrictions.',
  'LED lighting and show tunnels turned the wash itself into part of the customer experience.',
  'License plate recognition now lets members drive up and wash without stopping to pay.',
  'A wash bay\'s high pressure pumps can push water at well over 1,000 psi.',
  'Conveyor correlators gently center and align a car\'s tires before the pull through begins.',
  'Presoak chemistry is tuned to pH so it clings to grime without harming clear coat.',
  'Blower horsepower is a bragging point for tunnels racing to dry cars faster.',
  'Free vacuums replaced paid ones at many express washes to win over members.',
  'The shift from full service to express exterior washes reshaped the business in the 2000s and 2010s.',
  'Some of the earliest washes advertised "your car washed while you wait" as a novelty.',
  'Drying agents, the car wash version of wax, sheet water off so the blowers can finish the job.',
  'Neutralizers rinse away the salts left by hard water to keep spots from forming.',
  'The humble chamois gave way to microfiber and forced air drying over the decades.',
  'Reclaim tanks settle out dirt and grit so recycled wash water stays usable.',
  'Triple foam color and scent were added purely for showmanship and customer delight.',
  'Onsite water softening protects equipment from scale and improves rinse quality.',
]

// Stable per day, rotating across days (index by day of year).
function factForToday(date = new Date()): string {
  const start = new Date(date.getFullYear(), 0, 0)
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86400000)
  return CAR_WASH_HISTORY[dayOfYear % CAR_WASH_HISTORY.length]
}

export function DayInHistory() {
  return (
    <p className="mt-1 text-xs text-ink-muted sm:text-sm">
      <span className="font-semibold text-ink">This day in car wash history:</span>{' '}
      {factForToday()}
    </p>
  )
}
