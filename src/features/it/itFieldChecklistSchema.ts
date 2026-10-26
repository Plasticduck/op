// The IT Field Checklist items, grouped into sections. Keys are stable ids
// stored on each checklist, so labels can be reworded (or items added) without
// touching past records, which keep the label they were checked against.
export type ItChecklistSection = { title: string; items: { key: string; label: string }[] }

export const IT_FIELD_CHECKLIST: ItChecklistSection[] = [
  {
    title: 'Check-in',
    items: [
      { key: 'outstanding_issues', label: 'Ask manager on duty if there are any outstanding issues' },
    ],
  },
  {
    title: 'Network & Server',
    items: [
      { key: 'network_gear', label: 'Verify server, firewall, router, and network switches are working properly' },
      { key: 'cables_secure', label: 'Ensure all network and power cables are secure' },
      { key: 'rack_clean', label: 'Make sure server rack is clean and has proper air flow' },
    ],
  },
  {
    title: 'Manager Computers',
    items: [
      { key: 'computers_peripherals', label: 'Check all manager computers and connected peripherals are working properly' },
      { key: 'software_security', label: 'Check required software is up to date and review any security alerts' },
      { key: 'computer_airflow', label: 'Make sure computers have proper airflow and cables are managed' },
    ],
  },
  {
    title: 'Payment & Entry',
    items: [
      { key: 'payment_systems', label: 'Check payment systems for proper operation' },
      { key: 'offline_errors', label: 'Check for offline devices or error messages' },
      { key: 'loops_lpr', label: 'Verify loops and LPR are working correctly' },
    ],
  },
  {
    title: 'Tunnel Controls',
    items: [
      { key: 'tunnel_wash_control', label: 'Verify tunnel computer and wash control board are communicating properly' },
      { key: 'mcc_tunnel', label: 'Ensure the MCC and tunnel are communicating' },
    ],
  },
]
