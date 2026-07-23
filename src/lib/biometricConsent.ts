// Shared biometric-consent copy + version. Bump the version when the notice text
// changes materially; the version the employee agreed to is stored with their
// consent record so you can prove which disclosure they saw.
export const BIOMETRIC_CONSENT_VERSION = '2026-07-23'

// Plain-language biometric notice shown before the first face-verified punch.
// Written to satisfy the "inform before capture" requirement of the Texas
// Capture or Use of Biometric Identifier Act (and comparable laws).
export const BIOMETRIC_CONSENT_POINTS: { label: string; text: string }[] = [
  {
    label: 'What is collected',
    text: 'A scan of your facial geometry from the photo taken when you clock in or out. This is a biometric identifier.',
  },
  {
    label: 'Why',
    text: 'Only to confirm it is really you punching, so your time records stay accurate.',
  },
  {
    label: 'Sharing',
    text: 'It is not sold. It is shared only with the service providers that host this time clock, and only as needed to operate it.',
  },
  {
    label: 'Retention',
    text: 'Your facial data is destroyed within a reasonable time, and no later than one year after it is no longer needed (for example, when you leave or this feature is turned off).',
  },
  {
    label: 'Your choice',
    text: 'You may withdraw your consent at any time by asking your manager, after which face verification will be turned off for you.',
  },
]
