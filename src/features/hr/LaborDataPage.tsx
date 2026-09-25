import LaborReport from './LaborReport'

// Operational labor view: hourly staff plus non-Corporate salaried, with a toggle
// to show or hide salaried. Corporate salaried lives on the Salaried Labor page.
export default function LaborDataPage() {
  return <LaborReport variant="labor" />
}
