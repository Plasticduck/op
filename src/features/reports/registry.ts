import type { ReportColumn, ReportDef } from './types'
import * as L from './loaders'

const col = (header: string, key: string, numeric = false): ReportColumn => ({ header, key, numeric })

export const REPORTS: ReportDef[] = [
  // Ops
  {
    key: 'checklists',
    title: 'Checklist Completion',
    description: 'Completion counts by checklist over the period.',
    module: 'ops',
    columns: [col('Checklist', 'name'), col('Frequency', 'frequency'), col('Completions', 'completions', true), col('Last completed', 'last')],
    load: L.checklistCompletion,
  },
  {
    key: 'work-orders',
    title: 'Work Order Report',
    description: 'Work orders opened in the period, with cost and time to close.',
    module: 'ops',
    columns: [col('Title', 'title'), col('Status', 'status'), col('Priority', 'priority'), col('Cost', 'cost', true), col('Opened', 'opened'), col('Closed', 'closed')],
    load: L.workOrderReport,
  },
  {
    key: 'downtime',
    title: 'Downtime Report',
    description: 'Outages by equipment and reason, with total hours.',
    module: 'ops',
    columns: [col('Equipment', 'equipment'), col('Category', 'category'), col('Reason', 'reason'), col('Started', 'started'), col('Hours', 'hours', true)],
    load: L.downtimeReport,
  },
  {
    key: 'parts',
    title: 'Parts & Inventory',
    description: 'Current stock levels and inventory value.',
    module: 'ops',
    columns: [col('Part', 'name'), col('SKU', 'sku'), col('On hand', 'on_hand', true), col('Reorder at', 'reorder', true), col('Value', 'value', true), col('Status', 'status')],
    load: (locs) => L.partsReport(locs),
  },
  {
    key: 'closeouts',
    title: 'Closeout Summary',
    description: 'Daily sales, cash vs card, and deposits.',
    module: 'ops',
    columns: [col('Date', 'date'), col('Total', 'total', true), col('Cash', 'cash', true), col('Card', 'card', true), col('Deposit', 'deposit', true)],
    load: L.closeoutSummary,
  },
  // People
  {
    key: 'hours',
    title: 'Hours Report',
    description: 'Hours by employee with regular vs overtime split.',
    module: 'people',
    columns: [col('Employee', 'name'), col('Total', 'total', true), col('Regular', 'regular', true), col('Overtime', 'overtime', true)],
    load: L.hoursReport,
  },
  {
    key: 'attendance',
    title: 'Attendance Report',
    description: 'Auto-clockouts and edited time entries.',
    module: 'people',
    columns: [col('Employee', 'name'), col('Clock in', 'in'), col('Flag', 'flag')],
    load: L.attendanceReport,
  },
  {
    key: 'labor-cost',
    title: 'Labor Cost Report',
    description: 'Estimated labor spend by employee.',
    module: 'people',
    columns: [col('Employee', 'name'), col('Role', 'role'), col('Hours', 'hours', true), col('Rate', 'rate', true), col('Cost', 'cost', true)],
    load: L.laborCostReport,
  },
  {
    key: 'counseling',
    title: 'Counseling & Discipline',
    description: 'Counseling records by employee and type.',
    module: 'people',
    columns: [col('Employee', 'name'), col('Type', 'type'), col('Date', 'date')],
    load: L.counselingReport,
  },
  {
    key: 'injuries',
    title: 'Injury Report Summary',
    description: 'Incidents over the period — OSHA-ready.',
    module: 'people',
    columns: [col('Employee', 'name'), col('Date', 'date'), col('Body part', 'body_part'), col('Treatment', 'treatment')],
    load: L.injuryReport,
  },
  {
    key: 'reviews',
    title: 'Review Completion',
    description: 'Who has and has not had a recent review.',
    module: 'people',
    columns: [col('Employee', 'name'), col('Last review', 'last_review'), col('Days since', 'days_since', true)],
    load: (locs) => L.reviewCompletion(locs),
  },
]

export const reportByKey = (key: string) => REPORTS.find((r) => r.key === key)
