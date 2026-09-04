// GM / AGM monthly bonus math. This mirrors Mighty Wash's spreadsheet
// ("1 MW GM Bonus.xlsx") so the app produces identical numbers. All percentages
// for churn/conversion are whole-number percents (e.g. 9.3 means 9.3%);
// membership shares are fractions (0..1).

export type MonthInputs = {
  mighty_count: number
  super_count: number
  wonder_count: number
  avg_mos: number
  churn_pct: number
  conversion_pct: number
}

export type LevelCounts = {
  mighty_count: number
  super_count: number
  wonder_count: number
}

export type PrevCounts = LevelCounts | null

// Baselines are independent, effective-dated series. The membership baseline
// (level counts) and the average-months baseline reset separately, so they are
// passed in separately. Either can be null when no baseline is in effect yet.
export type MembershipBase = LevelCounts | null
export type AvgBase = number | null

export const LIFETIME_VALUE_BONUS = 1500
export const MEMBERSHIP_BONUS = 1500

// Some sites earn the Lifetime Value bonus on an absolute average-months
// milestone (paid once when avg months of active membership reaches the goal)
// instead of the default "+1 month vs base" growth rule. Keyed by site name.
export const LIFETIME_AVG_GOALS: Record<string, number> = {
  MW27: 9, MW28: 9, MW29: 9, MW31: 9, Spotless: 9,
}

export function lifetimeAvgGoal(siteName: string | null | undefined): number | null {
  const n = siteName?.trim()
  return n && n in LIFETIME_AVG_GOALS ? LIFETIME_AVG_GOALS[n] : null
}

// The default Lifetime Value growth rule pays when avg months rises at least 1
// vs base. Some sites use a smaller threshold (keyed by site name); everything
// else uses DEFAULT_LIFETIME_AVG_DELTA. Ignored when a site has an absolute
// LIFETIME_AVG_GOALS milestone.
export const DEFAULT_LIFETIME_AVG_DELTA = 1
export const LIFETIME_AVG_DELTAS: Record<string, number> = {
  MW06: 0.5, MW14: 0.5,
  MW22: 2, MW23: 2, MW24: 2, MW25: 2, MW26: 2,
}

export function lifetimeAvgDelta(siteName: string | null | undefined): number {
  const n = siteName?.trim()
  return n && n in LIFETIME_AVG_DELTAS ? LIFETIME_AVG_DELTAS[n] : DEFAULT_LIFETIME_AVG_DELTA
}

// Churn reward: first matching bracket wins. <7 -> 600, <=8 -> 520, <=9 -> 440,
// <=10 -> 360, <=11 -> 240, <=12 -> 120, >12 -> 0.
export const CHURN_BRACKETS: { test: (c: number) => boolean; amount: number; label: string }[] = [
  { test: (c) => c < 7, amount: 600, label: '< 7%' },
  { test: (c) => c <= 8, amount: 520, label: '<= 8%' },
  { test: (c) => c <= 9, amount: 440, label: '<= 9%' },
  { test: (c) => c <= 10, amount: 360, label: '<= 10%' },
  { test: (c) => c <= 11, amount: 240, label: '<= 11%' },
  { test: (c) => c <= 12, amount: 120, label: '<= 12%' },
  { test: () => true, amount: 0, label: '> 12%' },
]

export function churnReward(churnPct: number): number {
  return (CHURN_BRACKETS.find((b) => b.test(churnPct)) ?? CHURN_BRACKETS[CHURN_BRACKETS.length - 1]).amount
}

// Conversion reward on INT(conversion%): >=15 -> 400, 14 -> 350, 13 -> 300,
// 12 -> 250, 11 -> 150, 10 -> 80, else 0. Capped at 150 when churn >= 15%.
export function conversionReward(conversionPct: number, churnPct: number): number {
  const n = Math.trunc(conversionPct)
  let x: number
  if (n >= 15) x = 400
  else if (n === 14) x = 350
  else if (n === 13) x = 300
  else if (n === 12) x = 250
  else if (n === 11) x = 150
  else if (n === 10) x = 80
  else x = 0
  return churnPct >= 15 ? Math.min(x, 150) : x
}

export type LevelKey = 'mighty' | 'super' | 'wonder'

export type LevelRow = {
  key: LevelKey
  label: string
  count: number
  pct: number // fraction of total members
  pctChange: number | null // vs previous month, null when no prior month
  pctChangeSinceBase: number | null // vs base snapshot, null when no base
}

const LEVELS: { key: LevelKey; label: string }[] = [
  { key: 'mighty', label: 'Mighty Protector' },
  { key: 'super', label: 'Super Shine' },
  { key: 'wonder', label: 'Wonder Clean' },
]

const share = (n: number, total: number) => (total > 0 ? n / total : 0)

export type GmBonusResult = {
  currentTotal: number
  previousTotal: number | null
  levels: LevelRow[]
  avgMos: { base: number | null; current: number; delta: number | null }
  avgMonthsGoal: number | null // absolute milestone in effect for this site, or null
  avgMonthsDelta: number // growth threshold (vs base) in effect when not on a milestone
  lifetimeValue: { earned: boolean | null; amount: number; goalReached: boolean }
  membership: { earned: boolean | null; amount: number; combinedChangeSinceBase: number | null; goalReached: boolean }
  oneTimeTotal: number
  churn: { pct: number; amount: number; bracket: string }
  conversion: { pct: number; amount: number; capped: boolean }
  gmTotal: number
  agmTotal: number
  hasMembershipBase: boolean
  hasAvgBase: boolean
  underConstruction: boolean
}

export function computeGmBonus(args: {
  current: MonthInputs
  previous: PrevCounts
  membershipBase: MembershipBase
  avgBase: AvgBase
  // When set, the Lifetime Value bonus uses this absolute avg-months milestone
  // instead of the default "+1 vs base" growth rule.
  avgMonthsGoal?: number | null
  // Growth threshold (avg months vs base) for the Lifetime Value bonus when not
  // on an absolute milestone. Defaults to 1.
  avgMonthsDelta?: number
  // When true, the site is under construction this month: no bonus is paid.
  underConstruction?: boolean
}): GmBonusResult {
  const { current, previous, membershipBase, avgBase } = args
  const avgMonthsGoal = args.avgMonthsGoal ?? null
  const avgMonthsDelta = args.avgMonthsDelta ?? 1
  const underConstruction = args.underConstruction ?? false

  const counts: Record<LevelKey, number> = {
    mighty: current.mighty_count,
    super: current.super_count,
    wonder: current.wonder_count,
  }
  const currentTotal = counts.mighty + counts.super + counts.wonder

  const prevCounts: Record<LevelKey, number> | null = previous
    ? { mighty: previous.mighty_count, super: previous.super_count, wonder: previous.wonder_count }
    : null
  const previousTotal = prevCounts
    ? prevCounts.mighty + prevCounts.super + prevCounts.wonder
    : null

  const baseCounts: Record<LevelKey, number> | null = membershipBase
    ? { mighty: membershipBase.mighty_count, super: membershipBase.super_count, wonder: membershipBase.wonder_count }
    : null
  const baseTotal = baseCounts ? baseCounts.mighty + baseCounts.super + baseCounts.wonder : null

  const levels: LevelRow[] = LEVELS.map(({ key, label }) => {
    const pct = share(counts[key], currentTotal)
    const prevPct = prevCounts && previousTotal ? share(prevCounts[key], previousTotal) : null
    const basePct = baseCounts && baseTotal ? share(baseCounts[key], baseTotal) : null
    return {
      key,
      label,
      count: counts[key],
      pct,
      pctChange: prevPct === null ? null : pct - prevPct,
      pctChangeSinceBase: basePct === null ? null : pct - basePct,
    }
  })

  // Lifetime value. Default: avg months of active membership up at least
  // `avgMonthsDelta` (usually 1) vs base. With an absolute milestone: paid once
  // when avg months reaches the goal, guarded by base < goal so a baseline reset
  // locks it in and it isn't repaid.
  // Tolerance for the "earned" comparisons: inputs are entered to one decimal, so
  // a difference like 16.4 - 15.9 lands at 0.499999... in floating point and would
  // wrongly miss a +0.5 threshold without this epsilon.
  const EARN_EPS = 1e-9
  const avgDelta = avgBase === null ? null : current.avg_mos - avgBase
  const lifeEarned =
    avgMonthsGoal !== null
      ? current.avg_mos >= avgMonthsGoal - EARN_EPS && (avgBase === null || avgBase < avgMonthsGoal)
      : avgDelta === null
        ? null
        : avgDelta >= avgMonthsDelta - EARN_EPS
  const lifetimeValue = {
    earned: lifeEarned,
    amount: lifeEarned ? LIFETIME_VALUE_BONUS : 0,
    goalReached: lifeEarned === true,
  }

  // Membership: Mighty + Super combined share is up at least 10 points vs base.
  const mightyChg = levels[0].pctChangeSinceBase
  const superChg = levels[1].pctChangeSinceBase
  const combined = mightyChg === null || superChg === null ? null : mightyChg + superChg
  const memEarned = combined === null ? null : combined >= 0.1 - EARN_EPS
  const membership = {
    earned: memEarned,
    amount: memEarned ? MEMBERSHIP_BONUS : 0,
    combinedChangeSinceBase: combined,
    goalReached: memEarned === true,
  }

  const oneTimeTotal = lifetimeValue.amount + membership.amount

  const churnAmt = churnReward(current.churn_pct)
  const churnBracket = (CHURN_BRACKETS.find((b) => b.test(current.churn_pct)) ?? CHURN_BRACKETS[CHURN_BRACKETS.length - 1]).label
  const convAmt = conversionReward(current.conversion_pct, current.churn_pct)
  const convUncapped = conversionReward(current.conversion_pct, 0)

  const gmTotal = oneTimeTotal + churnAmt + convAmt
  const agmTotal = gmTotal / 2

  const res: GmBonusResult = {
    currentTotal,
    previousTotal,
    levels,
    avgMos: { base: avgBase, current: current.avg_mos, delta: avgDelta },
    avgMonthsGoal,
    avgMonthsDelta,
    lifetimeValue,
    membership,
    oneTimeTotal,
    churn: { pct: current.churn_pct, amount: churnAmt, bracket: churnBracket },
    conversion: { pct: current.conversion_pct, amount: convAmt, capped: convAmt < convUncapped },
    gmTotal,
    agmTotal,
    hasMembershipBase: membershipBase !== null,
    hasAvgBase: avgBase !== null,
    underConstruction,
  }

  // While a site is under construction, no bonus is paid: zero every amount while
  // keeping the membership numbers (which carry from the prior month) for display.
  if (underConstruction) {
    res.lifetimeValue = { earned: false, amount: 0, goalReached: false }
    res.membership = { ...res.membership, earned: false, amount: 0, goalReached: false }
    res.oneTimeTotal = 0
    res.churn = { ...res.churn, amount: 0 }
    res.conversion = { ...res.conversion, amount: 0 }
    res.gmTotal = 0
    res.agmTotal = 0
  }

  return res
}
