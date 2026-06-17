// Curated promotional holidays + observances tailored for car wash operators.
// Mix of US federal holidays, food/coffee tie-ins worth a co-promo, car-themed
// quirky observances, and seasonal milestones the team can lean on.
//
// Date rules:
//   { month, day }                      fixed Gregorian date (Jan = 1)
//   { month, weekday, ordinal }         e.g. 3rd Sun of June (Father's Day)
//                                       ordinal: 1..4 or 'last'
//   { kind: 'easter' }                  computed astronomically per year
//   { month, day, range }               range = number of additional days
//                                       (used for things that span a few days
//                                       like a long weekend)
//
// Categories:
//   federal     US federal holidays
//   national    widely recognized US holidays (not federal, but mainstream)
//   observance  fun/quirky observance days good for posts
//   carwash     car-, clean-, or vehicle-themed days. The heart of this list.
//   seasonal    season-change milestones
//   coproppromo  tie-ins worth partnering with a local brand on
//
// promoAngle gives a one-line opener the AI can riff on.

export type HolidayCategory = 'federal' | 'national' | 'observance' | 'carwash' | 'seasonal' | 'coproppromo'

export type HolidayRule =
  | { kind: 'fixed'; month: number; day: number }
  | { kind: 'nth'; month: number; weekday: number; ordinal: 1 | 2 | 3 | 4 | 'last' }
  | { kind: 'easter' }

export type Holiday = {
  id: string
  name: string
  emoji: string
  category: HolidayCategory
  rule: HolidayRule
  promoAngle: string
  // For UI tone in the grid.
  tone?: 'accent' | 'ok' | 'warn' | 'danger' | 'neutral'
}

const f = (month: number, day: number): HolidayRule => ({ kind: 'fixed', month, day })
const n = (month: number, weekday: number, ordinal: 1 | 2 | 3 | 4 | 'last'): HolidayRule => ({
  kind: 'nth', month, weekday, ordinal,
})
const easter: HolidayRule = { kind: 'easter' }

export const HOLIDAYS: Holiday[] = [
  // JANUARY
  { id: 'new-years', name: "New Year's Day", emoji: '🎉', category: 'federal', rule: f(1, 1), tone: 'accent',
    promoAngle: 'Start the year with a clean slate. Resolution: a cleaner car every month.' },
  { id: 'mlk-day', name: 'Martin Luther King Jr. Day', emoji: '🕊️', category: 'federal', rule: n(1, 1, 3),
    promoAngle: 'A day of reflection and service. Consider donating a portion of sales.' },
  { id: 'dress-pet-day', name: 'Dress Up Your Pet Day', emoji: '🐶', category: 'observance', rule: f(1, 14),
    promoAngle: 'Bring your dressed-up pup for a free pet treat at the vac.' },
  { id: 'natl-pie-day', name: 'National Pie Day', emoji: '🥧', category: 'coproppromo', rule: f(1, 23),
    promoAngle: 'Partner with a local bakery: clean car, free slice.' },

  // FEBRUARY
  { id: 'groundhog-day', name: 'Groundhog Day', emoji: '🦫', category: 'observance', rule: f(2, 2),
    promoAngle: '6 more weeks of salt? Pre-buy a monthly to stay ahead of it.' },
  { id: 'clean-out-car', name: 'Clean Out Your Car Day', emoji: '🧹', category: 'carwash', rule: f(2, 12), tone: 'ok',
    promoAngle: 'The literal holiday. Free vacuum upgrade with any wash today.' },
  { id: 'valentines', name: "Valentine's Day", emoji: '💝', category: 'national', rule: f(2, 14),
    promoAngle: "Treat your sweetheart's car. Couple wash package, two for one." },
  { id: 'presidents-day', name: "Presidents' Day", emoji: '🇺🇸', category: 'federal', rule: n(2, 1, 3),
    promoAngle: 'Long weekend = road trip prep. Detail and shine package featured.' },
  { id: 'leap-day', name: 'Leap Day (every 4 years)', emoji: '🐸', category: 'observance', rule: f(2, 29),
    promoAngle: 'Once-every-4-years special. Bonus loyalty points or extra month free.' },

  // MARCH
  { id: 'natl-pig-day', name: 'National Pig Day', emoji: '🐷', category: 'observance', rule: f(3, 1),
    promoAngle: 'Stop driving a pig. Bring it in for a bath.' },
  { id: 'employee-appreciation', name: 'Employee Appreciation Day', emoji: '🙌', category: 'observance', rule: n(3, 5, 1),
    promoAngle: 'Shout out the team. Free wash for every employee. Customers feel it.' },
  { id: 'st-patricks', name: "St. Patrick's Day", emoji: '🍀', category: 'national', rule: f(3, 17),
    promoAngle: 'Get the green out (pollen, salt). Lucky upgrade special.' },
  { id: 'first-spring', name: 'First Day of Spring', emoji: '🌷', category: 'seasonal', rule: f(3, 20), tone: 'ok',
    promoAngle: 'Spring cleaning starts in the driveway. Detail package launch.' },
  { id: 'natl-car-wash-day', name: 'National Car Wash Day', emoji: '🧽', category: 'carwash', rule: f(3, 29), tone: 'accent',
    promoAngle: 'THE day. All-day promo, signed signage, social blast. Anchor of Q1.' },

  // APRIL
  { id: 'april-fools', name: "April Fools' Day", emoji: '🤡', category: 'observance', rule: f(4, 1),
    promoAngle: 'A clean car is no joke. Playful tone, real value.' },
  { id: 'natl-pet-day', name: 'National Pet Day', emoji: '🐾', category: 'observance', rule: f(4, 11),
    promoAngle: 'Free vacuum extension for pet hair owners. Photo contest.' },
  { id: 'easter', name: 'Easter Sunday', emoji: '🐰', category: 'national', rule: easter,
    promoAngle: 'Sparkle for spring brunch. Family-package weekend.' },
  { id: 'earth-day', name: 'Earth Day', emoji: '🌍', category: 'observance', rule: f(4, 22), tone: 'ok',
    promoAngle: 'Highlight your reclaim system + biodegradable soap. Saves 100+ gallons vs driveway.' },
  { id: 'admin-day', name: 'Administrative Professionals Day', emoji: '📋', category: 'observance', rule: n(4, 3, 4),
    promoAngle: 'Tell the office admin: detailing for the team car.' },
  { id: 'natl-car-care-month', name: 'National Car Care Month', emoji: '🚗', category: 'carwash', rule: f(4, 1), tone: 'ok',
    promoAngle: 'Whole-month theme. Tips series. Monthly membership push.' },

  // MAY
  { id: 'star-wars', name: 'Star Wars Day (May the 4th)', emoji: '⚔️', category: 'observance', rule: f(5, 4),
    promoAngle: 'May the suds be with you. Light puns, dark cars.' },
  { id: 'cinco-de-mayo', name: 'Cinco de Mayo', emoji: '🌮', category: 'coproppromo', rule: f(5, 5),
    promoAngle: 'Partner with a local taqueria. Clean car gets a taco voucher.' },
  { id: 'natl-nurses-day', name: 'National Nurses Day', emoji: '🩺', category: 'observance', rule: f(5, 6),
    promoAngle: 'Free wash for nurses. They earn it.' },
  { id: 'natl-teachers-day', name: 'National Teachers Day', emoji: '📚', category: 'observance', rule: n(5, 2, 1),
    promoAngle: 'Teachers get a free wash. They earn it too.' },
  { id: 'mothers-day', name: "Mother's Day", emoji: '💐', category: 'national', rule: n(5, 0, 2),
    promoAngle: 'Mom’s car deserves a treat. Gift cards push.' },
  { id: 'armed-forces-day', name: 'Armed Forces Day', emoji: '🎖️', category: 'national', rule: n(5, 6, 3),
    promoAngle: 'Free wash for active service and veterans this weekend.' },
  { id: 'memorial-day', name: 'Memorial Day', emoji: '🇺🇸', category: 'federal', rule: n(5, 1, 'last'),
    promoAngle: 'Honor with action. Discount for veteran families. Long weekend hours.' },

  // JUNE
  { id: 'natl-donut-day', name: 'National Donut Day', emoji: '🍩', category: 'coproppromo', rule: n(6, 5, 1),
    promoAngle: 'Partner with a local bakery. Free donut with any wash.' },
  { id: 'flag-day', name: 'Flag Day', emoji: '🇺🇸', category: 'national', rule: f(6, 14),
    promoAngle: 'Decorate the tunnel entrance. Patriotic monthly push.' },
  { id: 'fathers-day', name: "Father's Day", emoji: '👨', category: 'national', rule: n(6, 0, 3),
    promoAngle: "Dad’s ride, polished. Gift card focused promo." },
  { id: 'juneteenth', name: 'Juneteenth', emoji: '🎉', category: 'federal', rule: f(6, 19),
    promoAngle: 'Day off for the team. Featured local artist on social.' },
  { id: 'first-summer', name: 'First Day of Summer', emoji: '☀️', category: 'seasonal', rule: f(6, 21), tone: 'warn',
    promoAngle: 'Bug season starts. Pre-bug-armor package featured.' },
  { id: 'natl-selfie-day', name: 'National Selfie Day', emoji: '🤳', category: 'observance', rule: f(6, 21),
    promoAngle: 'Selfie with your sparkling car tag # for a free upgrade.' },

  // JULY
  { id: 'independence-day', name: 'Independence Day', emoji: '🎆', category: 'federal', rule: f(7, 4),
    promoAngle: 'Red, white, and clean. Family-day pricing for the long weekend.' },
  { id: 'natl-ice-cream-day', name: 'National Ice Cream Day', emoji: '🍦', category: 'coproppromo', rule: n(7, 0, 3),
    promoAngle: 'Partner with a local ice cream shop. Wash gets a cone.' },
  { id: 'natl-dad-joke-day', name: 'National Dad Joke Day', emoji: '😂', category: 'observance', rule: f(7, 30),
    promoAngle: "Why don’t cars tell jokes? Their windshield wipes the punchline." },

  // AUGUST
  { id: 'natl-girlfriends-day', name: 'National Girlfriends Day', emoji: '👯', category: 'observance', rule: f(8, 1),
    promoAngle: 'Treat your friend’s car. Pair pricing.' },
  { id: 'natl-dog-day', name: 'National Dog Day', emoji: '🐕', category: 'carwash', rule: f(8, 26), tone: 'ok',
    promoAngle: 'Bring your dog. Free vacuum + biscuit. Photo contest. Massive engagement day.' },
  { id: 'natl-beach-day', name: 'National Beach Day', emoji: '🏖️', category: 'observance', rule: f(8, 30),
    promoAngle: 'Sand in everything. Free post-beach vacuum extension.' },

  // SEPTEMBER
  { id: 'labor-day', name: 'Labor Day', emoji: '🛠️', category: 'federal', rule: n(9, 1, 1),
    promoAngle: 'End-of-summer push. Long weekend road trip prep.' },
  { id: 'natl-coffee-day', name: 'National Coffee Day', emoji: '☕', category: 'coproppromo', rule: f(9, 29),
    promoAngle: 'Coffee shop tie-in. Free coffee with a wash. Drive-thru-to-drive-thru.' },
  { id: 'first-fall', name: 'First Day of Fall', emoji: '🍂', category: 'seasonal', rule: f(9, 22),
    promoAngle: 'Leaves and pollen everywhere. Featured leaf-vacuum-extension.' },

  // OCTOBER
  { id: 'natl-boss-day', name: 'National Boss Day', emoji: '💼', category: 'observance', rule: f(10, 16),
    promoAngle: 'Treat the boss’s ride. Gift card focused promo.' },
  { id: 'halloween', name: 'Halloween', emoji: '🎃', category: 'national', rule: f(10, 31),
    promoAngle: 'Costume contest at the wash. Spooky-clean theme.' },

  // NOVEMBER
  { id: 'veterans-day', name: 'Veterans Day', emoji: '🎗️', category: 'federal', rule: f(11, 11), tone: 'ok',
    promoAngle: 'Free wash for all veterans and active military. All day.' },
  { id: 'thanksgiving', name: 'Thanksgiving', emoji: '🦃', category: 'federal', rule: n(11, 4, 4),
    promoAngle: 'Closed for family. Send a gratitude post to customers.' },
  { id: 'black-friday', name: 'Black Friday', emoji: '🛍️', category: 'national', rule: n(11, 5, 4),
    promoAngle: 'Membership steal. Annual prepay discount. Gift card bonuses.' },
  { id: 'small-bus-saturday', name: 'Small Business Saturday', emoji: '🏪', category: 'national', rule: n(11, 6, 4), tone: 'ok',
    promoAngle: 'Shop small. Cross-promote with neighborhood businesses.' },

  // DECEMBER
  { id: 'pearl-harbor', name: 'Pearl Harbor Remembrance Day', emoji: '⚓', category: 'observance', rule: f(12, 7),
    promoAngle: 'Quiet honor post. Veteran tribute.' },
  { id: 'first-winter', name: 'First Day of Winter', emoji: '❄️', category: 'seasonal', rule: f(12, 21), tone: 'warn',
    promoAngle: 'Salt season is here. Underbody wash featured. Frequency push.' },
  { id: 'christmas-eve', name: 'Christmas Eve', emoji: '🎄', category: 'national', rule: f(12, 24),
    promoAngle: 'Early-close hours. Holiday gratitude post.' },
  { id: 'christmas', name: 'Christmas Day', emoji: '🎁', category: 'federal', rule: f(12, 25),
    promoAngle: 'Closed. Send a thank-you-for-a-great-year post.' },
  { id: 'new-years-eve', name: "New Year's Eve", emoji: '🍾', category: 'national', rule: f(12, 31),
    promoAngle: 'Clean for the new year. Annual pre-pay last call.' },
]

// ---- Date resolution -------------------------------------------------------

function easterDate(year: number): Date {
  // Anonymous Gregorian algorithm.
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f2 = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f2 + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, ordinal: 1 | 2 | 3 | 4 | 'last'): Date {
  if (ordinal === 'last') {
    const last = new Date(year, month, 0) // last day of month (month here = 1-indexed end)
    const offset = (last.getDay() - weekday + 7) % 7
    return new Date(year, month - 1, last.getDate() - offset)
  }
  const first = new Date(year, month - 1, 1)
  const firstWeekday = first.getDay()
  const offset = (weekday - firstWeekday + 7) % 7
  const day = 1 + offset + (ordinal - 1) * 7
  return new Date(year, month - 1, day)
}

export function resolveHoliday(h: Holiday, year: number): Date {
  switch (h.rule.kind) {
    case 'fixed':
      return new Date(year, h.rule.month - 1, h.rule.day)
    case 'nth':
      return nthWeekdayOfMonth(year, h.rule.month, h.rule.weekday, h.rule.ordinal)
    case 'easter':
      return easterDate(year)
  }
}

export function holidaysInRange(from: Date, to: Date): Array<{ holiday: Holiday; date: Date }> {
  const out: Array<{ holiday: Holiday; date: Date }> = []
  const years = new Set<number>()
  years.add(from.getFullYear())
  years.add(to.getFullYear())
  for (const y of years) {
    for (const h of HOLIDAYS) {
      const d = resolveHoliday(h, y)
      if (d >= from && d <= to) out.push({ holiday: h, date: d })
    }
  }
  out.sort((a, b) => a.date.getTime() - b.date.getTime())
  return out
}
