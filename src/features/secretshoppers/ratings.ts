// The star questions on a Secret Shopper report, in form order. The
// secret-shopper function keeps the same keys and labels (CATEGORIES) to check
// a report and write the email, so change both together.
export type RatingCategory = { key: string; label: string; hint: string }

export const RATING_CATEGORIES: RatingCategory[] = [
  { key: 'greeting', label: 'Greeting and friendliness', hint: 'Were you greeted right away, and was the team friendly?' },
  { key: 'speed', label: 'Speed of service', hint: 'How long did you wait, and did the line keep moving?' },
  { key: 'membership', label: 'Packages and membership offer', hint: 'Did someone explain the wash packages and offer a membership?' },
  { key: 'wash', label: 'Wash quality', hint: 'How clean was your car when it came out of the tunnel?' },
  { key: 'drying', label: 'Drying', hint: 'Was your car dry, with no drips or water spots?' },
  { key: 'site', label: 'Site cleanliness', hint: 'The lot, pay station, vacuums and restrooms.' },
  { key: 'overall', label: 'Overall experience', hint: 'Taking everything together, how was the visit?' },
]

export const STAR_WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent']
