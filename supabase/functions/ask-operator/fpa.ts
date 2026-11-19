// Operator AI's note on the FP&A Model (migration 0253): Mighty Wash's FP&A
// workbook, readable with run_sql through the fpa_current_* views. Only added
// for the people on the model's reader list (fpa_can_read); row-level security
// keeps the rows from everyone else whatever the prompt says.

export type FpaVersionInfo = { label: string; last_closed_month: string | null; info?: { budget_title?: string | null; forecast_title?: string | null } | null }

const monthName = (iso: string | null) => {
  if (!iso) return 'unknown'
  const [y, m] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, 1)))
}

export function fpaPrompt(v: FpaVersionInfo): string {
  return [
    `FP&A MODEL: this user can read Mighty Wash's FP&A model (version "${v.label}", last closed month ${monthName(v.last_closed_month)}) with run_sql.`,
    "It is the FP&A workbook's own results from QuickBooks, loaded into Operator; it is not live QuickBooks, so say which version and month your numbers come from.",
    'Views (current version only):',
    '- fpa_current_metrics(entity_key, entity_label, metric, month, value): one value per entity, metric and month (month = first of the month), from January 2024 to the last closed month.',
    '  Entities: G_CONS consolidated company; G_CWO all car wash operations; G_SS same-store car washes; regions G_LBK Lubbock, G_PB Permian Basin, G_NM New Mexico, G_CEN Central (Waco); G_LUBE site 19 lube; G_SPOT Spotless; G_CORP corporate incl. unclassified; S01..S34 sites (S08 includes IBA); CORP, SPOT, UNCL single QuickBooks classes. Labels in fpa_current_entities.',
    '  P&L line metrics: Wash Sales, House/Fleet Sales, Lube & Accessories, Other Operating Income, Discounts, Chargebacks & Adjustments, Chemical (CPC), Labor – Hourly (COGS), Lube Product Cost, Other COGS, Salaried Site Managers, Corporate Salaries & Bonuses, Payroll Taxes, Benefits & Services, Electricity, Water / Storm / Sewer, Other Utilities, Repairs & Maintenance, Backroom Chemical, Sales & Marketing, Merchant Fees, Insurance (P&C), Technology & Software, Property & Other Taxes, Startup / Pre-Opening, Other Operating Expenses, Guarantee Payments, Corporate Allocation, Other Non-Operating Income, Other Non-Operating Expense, Rent – MW Properties, Rent – MW Holdings, Rent – Other Leases, Depreciation & Amortization, Interest Expense, Interest Income, Franchise (Income) Tax, ASC 842 Lease Reclass, Year-End Adjustment – Unexplained (these names use an en dash).',
    '  Subtotals: Net Revenue, Total COGS, Gross Profit, Total Operating Expenses, Total Rent, EBITDA, Net Income, and EBITDAR (the model\'s own definition, not simply EBITDA plus rent).',
    '  Volumes and KPIs: Cars Washed; KPI Qualifying Cars with KPI Net Revenue, KPI Chemical, KPI Labor, KPI Backroom Chemical, KPI Water, KPI Electric (per car = KPI x / KPI Qualifying Cars, summed over the same months); POS: Active Members (POS) is a month-end count (never sum it across months), Memberships Sold (POS), Eligible Retail (POS) (conversion = sold / eligible retail), Recharge Revenue (POS), Recharges (POS), TTAF (POS), Churn Base Members and Churn Recharges (monthly churn = 1 - recharges / base), Est. Membership Revenue, Est. Retail Revenue, Net Wash Revenue.',
    '  Rules: costs are positive amounts; Net Revenue = QuickBooks total income; EBITDA = Gross Profit - Total Operating Expenses + Other Non-Operating Income - Other Non-Operating Expense - Total Rent; Net Income = EBITDA - D&A - Interest Expense + Interest Income - Franchise Tax - ASC 842 - Year-End Adjustment. Site results are after the corporate allocation (GL 70011). Margins = EBITDA / Net Revenue. YTD = January through the month; compare with the same months a year earlier.',
    '- fpa_current_pl_lines(month, qb_class, site_key, account, gl, amount, kpi_group, dashboard_row, region, segment, same_store, qb_type): the QuickBooks lines behind those metrics (kpi_group is the metric they roll into), for GL-account detail.',
    `- fpa_current_budget_ytd(key, location, region, landlord, in_budget, revenue_actual, revenue_budget, ebitda_actual, ebitda_budget, adj_ebitda_actual, adj_ebitda_budget): ${v.info?.budget_title ?? 'budget vs actual'} by location; key 'TOTAL' is the company.`,
    `- fpa_current_forecast(entity_key, region, segment, same_store, metric, month, value): ${v.info?.forecast_title ?? 'the forecast'}, per site (entity_key S01.., CORP, SPOT); sum the sites of a region with the region column. Metrics: Members (month-end), Memberships Sold, Membership Revenue, Retail Revenue, Wash Sales, Discounts, Fleet Revenue, Other Revenue, Net Revenue, Member & Fleet Washes, Retail Cars, Total Cars, Variable Costs, Fixed Costs, EBITDA.`,
    '- fpa_current_sites(key, site_number, name, region, segment, format, status, open_date, closed_from, reopen_date, same_store) and fpa_current_version(label, last_closed_month, info). info.definitions holds the workbook\'s own definitions.',
    'The model includes payroll lines (salaries, wages, bonuses); share them only with this user. Use these views for P&L, revenue, EBITDA, margins, costs, budget vs actual and forecast questions; live Site Performance tools remain the source for current-day car counts.',
  ].join('\n')
}
