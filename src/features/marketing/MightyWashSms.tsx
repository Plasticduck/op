import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'

// Standalone, Mighty Wash–specific SMS program legal pages, for the A2P 10DLC
// campaign registration (Privacy Policy + Terms URLs). Intentionally NOT tied to
// the WashLyfe/Operator marketing pages — this is for Mighty Wash Operations LLC
// only. The program is INTERNAL: operational/account text alerts to authorized
// staff who opt in; it is not used to message customers and is not marketing.
// Edit the constants below to update contact details everywhere.
const COMPANY = 'Mighty Wash Operations LLC'
const BRAND = 'Mighty Wash'
const WEBSITE = 'https://www.mighty-wash.com'
const WEBSITE_LABEL = 'www.mighty-wash.com'
const CONTACT_EMAIL = 'support@mighty-wash.com'
const LAST_UPDATED = 'October 14, 2026'
const PRIVACY_PATH = '/mighty-wash/sms-privacy'
const TERMS_PATH = '/mighty-wash/sms-terms'

function SmsLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-content">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-baseline justify-between gap-3 px-4 py-5 sm:px-6">
          <div>
            <div className="text-lg font-bold tracking-tight text-ink">{BRAND}</div>
            <div className="text-xs text-ink-subtle">{COMPANY}</div>
          </div>
          <a href={WEBSITE} className="text-sm text-accent hover:underline">{WEBSITE_LABEL}</a>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-ink-muted">Last updated: {LAST_UPDATED}</p>
        <div className="mt-8 flex flex-col gap-7">{children}</div>
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-ink-subtle">
        © {new Date().getFullYear()} {COMPANY} · <a href={WEBSITE} className="hover:underline">{WEBSITE_LABEL}</a>
      </footer>
    </div>
  )
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-ink">{heading}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-ink-muted">{children}</div>
    </section>
  )
}

function Email() {
  return <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent hover:underline">{CONTACT_EMAIL}</a>
}

export function SmsPrivacyPage() {
  return (
    <SmsLayout title="SMS Privacy Policy">
      <Section heading="Overview">
        <p>
          This SMS Privacy Policy explains how {COMPANY} ("{BRAND}," "we," "us," or "our") handles
          information in connection with our internal text‑messaging program. The program sends
          operational and account alerts to authorized {BRAND} personnel (owners, managers, and staff)
          who opt in. It is <strong>not used to message customers or the general public, and it is not
          used for marketing</strong>.
        </p>
      </Section>
      <Section heading="Information we collect">
        <p>When an authorized user opts in to receive text messages from us, we collect:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>the mobile phone number the user provides, and the name/account associated with it;</li>
          <li>the consent record — the date, time, and method by which the user opted in; and</li>
          <li>message and delivery activity, such as whether a message was delivered and whether the user replied (for example, with STOP or HELP).</li>
        </ul>
      </Section>
      <Section heading="How we use your information">
        <p>
          We use the mobile number solely to operate the internal {BRAND} text‑messaging program — to
          send operational and account notifications (for example, labor and time‑clock alerts, approval
          reminders, daily summaries, and account/security notices), to respond to HELP requests, to
          honor opt‑out requests, and to secure and support the program. We do not use it for marketing.
        </p>
      </Section>
      <Section heading="How we share your information">
        <p className="font-medium text-ink">
          No mobile information will be shared with third parties or affiliates for marketing or
          promotional purposes.
        </p>
        <p>
          We share mobile information only with vendors who help us operate the messaging program (for
          example, our SMS provider, Twilio), and only to the extent needed to deliver the service; these
          vendors are contractually limited to that purpose. We do not sell or rent phone numbers. We may
          disclose information if required by law or to protect our legal rights.
        </p>
      </Section>
      <Section heading="Opting out">
        <p>
          A user can stop receiving messages at any time by replying <strong>STOP</strong> to any message.
          Reply <strong>HELP</strong> for assistance. Opt‑out requests are processed automatically, and we
          will send a single confirmation after a user opts out.
        </p>
      </Section>
      <Section heading="Data retention and security">
        <p>
          We retain opt‑in and messaging records for as long as needed to operate the program and to meet
          our legal and recordkeeping obligations, and we use reasonable administrative and technical
          safeguards to protect this information.
        </p>
      </Section>
      <Section heading="Eligibility">
        <p>The program is limited to authorized {BRAND} personnel who are at least 18 years old; it is not directed to the general public or to minors.</p>
      </Section>
      <Section heading="Changes to this policy">
        <p>We may update this policy from time to time; the "Last updated" date above reflects the most recent changes.</p>
      </Section>
      <Section heading="Contact us">
        <p>
          {COMPANY}<br />
          Email: <Email /><br />
          Web: <a href={WEBSITE} className="text-accent hover:underline">{WEBSITE_LABEL}</a>
        </p>
      </Section>
      <p className="text-sm">
        <Link to={TERMS_PATH} className="text-accent hover:underline">View the SMS Terms &amp; Conditions →</Link>
      </p>
    </SmsLayout>
  )
}

export function SmsTermsPage() {
  return (
    <SmsLayout title="SMS Terms &amp; Conditions">
      <Section heading="1. The program">
        <p>
          The {BRAND} text‑messaging program is for internal use by authorized {BRAND} personnel. By
          opting in, you agree to receive recurring automated operational and account text alerts from
          {' '}{BRAND} (for example, labor and time‑clock alerts, approval reminders, and account/security
          notices) at the mobile number you provided. <strong>Consent is not a condition of employment or
          of using any {BRAND} system.</strong> The program is not used for marketing.
        </p>
      </Section>
      <Section heading="2. Message frequency">
        <p>Message frequency varies based on operational activity and the alerts you have opted in to receive.</p>
      </Section>
      <Section heading="3. Cost">
        <p>
          <strong>Message and data rates may apply</strong>, according to your mobile carrier's plan.
          {' '}{BRAND} does not charge you for the messages.
        </p>
      </Section>
      <Section heading="4. How to opt out">
        <p>
          Reply <strong>STOP</strong> to any message to cancel at any time. After you text STOP, we will
          send one confirmation message and then stop sending messages to that number. To rejoin, opt in
          again.
        </p>
      </Section>
      <Section heading="5. How to get help">
        <p>Reply <strong>HELP</strong> to any message, or contact us at <Email />.</p>
      </Section>
      <Section heading="6. Carriers">
        <p>
          Supported carriers include AT&amp;T, Verizon, T‑Mobile, and others. <strong>Carriers are not
          liable for delayed or undelivered messages.</strong>
        </p>
      </Section>
      <Section heading="7. Eligibility">
        <p>You must be an authorized {BRAND} user of the mobile number you enroll, and at least 18 years old.</p>
      </Section>
      <Section heading="8. Privacy">
        <p>
          Your information is handled in accordance with our{' '}
          <Link to={PRIVACY_PATH} className="text-accent hover:underline">SMS Privacy Policy</Link>.
        </p>
      </Section>
      <Section heading="9. Changes">
        <p>
          We may modify or terminate the program or these Terms at any time. Your continued participation
          after a change takes effect constitutes acceptance of the updated Terms.
        </p>
      </Section>
      <Section heading="10. Contact us">
        <p>
          {COMPANY}<br />
          Email: <Email /><br />
          Web: <a href={WEBSITE} className="text-accent hover:underline">{WEBSITE_LABEL}</a>
        </p>
      </Section>
      <p className="text-sm">
        <Link to={PRIVACY_PATH} className="text-accent hover:underline">View the SMS Privacy Policy →</Link>
      </p>
    </SmsLayout>
  )
}
