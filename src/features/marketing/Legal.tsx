import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { MarketingNav, MarketingFooter } from './components'

const COMPANY = 'Wash Lyfe LLC'
const CONTACT_EMAIL = 'info@washlyfe.com'
const LAST_UPDATED = 'July 23, 2026'
const GOVERNING_STATE = 'Texas'

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-content">
      <MarketingNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-ink-muted">Last updated: {LAST_UPDATED}</p>
        <div className="mt-8 flex flex-col gap-8">{children}</div>
        <div className="mt-10 text-sm">
          <Link to="/" className="text-accent hover:underline">← Back to home</Link>
        </div>
      </main>
      <MarketingFooter />
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
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent hover:underline">
      {CONTACT_EMAIL}
    </a>
  )
}

export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service">
      <Section heading="1. Agreement to these terms">
        <p>
          These Terms of Service ("Terms") govern your access to and use of WashLyfe Operator
          (the "Service"), software provided by {COMPANY} ("WashLyfe", "we", "us") for car wash
          operators to manage operations, equipment, and teams. By creating an account or using
          the Service, you agree to these Terms. If you are using the Service on behalf of an
          organization (a "Customer"), you represent that you are authorized to accept these Terms
          on its behalf.
        </p>
      </Section>
      <Section heading="2. The service">
        <p>
          The Service provides tools including operations and equipment tracking, checklists,
          scheduling, time tracking (including optional geofenced and photo/face-verified punches),
          reporting, messaging, tipping, and AI-assisted features. We may add, change, or remove
          features over time. We aim for high availability but do not guarantee the Service will be
          uninterrupted or error-free.
        </p>
      </Section>
      <Section heading="3. Accounts and eligibility">
        <p>
          You must provide accurate account information and keep it up to date. You are responsible
          for safeguarding your login credentials and for all activity under your account,
          including the activity of users you invite. Notify us promptly of any unauthorized use.
          You must be at least 18 years old to use the Service.
        </p>
      </Section>
      <Section heading="4. Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc pl-5">
          <li>use the Service to violate any law or the rights of others;</li>
          <li>upload content you do not have the right to share, or that is unlawful or harmful;</li>
          <li>attempt to gain unauthorized access to the Service or its systems;</li>
          <li>interfere with or disrupt the integrity or performance of the Service;</li>
          <li>reverse engineer or resell the Service except as permitted by law.</li>
        </ul>
      </Section>
      <Section heading="5. Employee monitoring, biometric, and location features">
        <p>
          Some features let a Customer collect information from its workers, including time-clock
          photos, facial-recognition verification (a biometric identifier), and geolocation at the
          time of a punch. If you enable these features, you are the party that determines their
          use, and you are responsible for:
        </p>
        <ul className="list-disc pl-5">
          <li>
            providing any legally required notice and obtaining any legally required consent from
            each affected individual before collection, including under the Texas Capture or Use of
            Biometric Identifier Act, the Illinois Biometric Information Privacy Act, and any other
            applicable biometric, privacy, or employee-monitoring laws;
          </li>
          <li>using the collected information only for legitimate, lawful business purposes; and</li>
          <li>
            maintaining your own policies and records of consent as required by the laws that apply
            to you and your workforce.
          </li>
        </ul>
        <p>
          We provide these features as a tool and process the resulting data on your behalf as
          described in our <Link to="/privacy" className="text-accent hover:underline">Privacy Policy</Link>.
          You must not enable facial recognition or location capture for any individual who has not
          given the consent required by law.
        </p>
      </Section>
      <Section heading="6. Your data and ownership">
        <p>
          You retain all rights to the data you and your users submit ("Customer Data"). You grant
          us a limited license to host, process, and display Customer Data solely to provide,
          secure, and improve the Service. You are responsible for the accuracy and legality of
          Customer Data and for obtaining any consents required from your employees and others.
        </p>
      </Section>
      <Section heading="7. Subscriptions, trials, and billing">
        <p>
          Paid plans are billed in advance on a recurring basis through our payment processor,
          Stripe. Free trials, where offered, convert to a paid subscription unless canceled before
          the trial ends. Fees are non-refundable except where required by law. We may change
          pricing with reasonable notice; changes apply to subsequent billing periods.
        </p>
      </Section>
      <Section heading="8. Third-party services">
        <p>
          The Service relies on third-party providers, including hosting and database (Supabase),
          payments (Stripe and Stripe Connect), AI processing (Anthropic), weather and geocoding
          (Open-Meteo and OpenStreetMap/Nominatim), and optional integrations you choose to connect
          (such as Google Calendar). Your use of those features may be subject to the providers'
          terms. We are not responsible for third-party services we do not control.
        </p>
      </Section>
      <Section heading="9. Disclaimers">
        <p>
          The Service is provided "as is" and "as available" without warranties of any kind, whether
          express or implied, including merchantability, fitness for a particular purpose, and
          non-infringement. We do not warrant that the Service will meet your requirements or be
          error-free. AI-assisted outputs may be inaccurate or incomplete and should be reviewed
          before you rely on them.
        </p>
      </Section>
      <Section heading="10. Limitation of liability">
        <p>
          To the maximum extent permitted by law, we will not be liable for any indirect,
          incidental, special, consequential, or punitive damages, or any loss of data, profits, or
          revenue. Our total liability for any claim relating to the Service will not exceed the
          amount you paid to us for the Service in the twelve months before the claim arose.
        </p>
      </Section>
      <Section heading="11. Indemnification">
        <p>
          You will indemnify and hold harmless {COMPANY} from claims, damages, and expenses arising
          out of your Customer Data, your use of the employee-monitoring, biometric, or location
          features, your failure to obtain required consents or provide required notices, or your
          violation of these Terms or applicable law.
        </p>
      </Section>
      <Section heading="12. Termination">
        <p>
          You may stop using the Service and cancel your subscription at any time. We may suspend or
          terminate access if you breach these Terms or to protect the Service. Upon termination,
          your right to use the Service ends; we may delete Customer Data after a reasonable period
          unless retention is required by law.
        </p>
      </Section>
      <Section heading="13. Governing law and venue">
        <p>
          These Terms are governed by the laws of the State of {GOVERNING_STATE}, without regard to
          its conflict-of-laws rules. You agree that any dispute arising out of or relating to these
          Terms or the Service will be brought exclusively in the state or federal courts located in
          {' '}{GOVERNING_STATE}, and you consent to the personal jurisdiction of those courts.
        </p>
      </Section>
      <Section heading="14. Changes to these terms">
        <p>
          We may update these Terms from time to time. If we make material changes, we will take
          reasonable steps to notify you. Your continued use of the Service after changes take
          effect constitutes acceptance of the updated Terms.
        </p>
      </Section>
      <Section heading="15. Contact">
        <p>Questions about these Terms? Contact {COMPANY} at <Email />.</p>
      </Section>
    </LegalLayout>
  )
}

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <Section heading="Overview">
        <p>
          This Privacy Policy explains how {COMPANY} ("WashLyfe", "we", "us") collects, uses, and
          shares information when you use WashLyfe Operator (the "Service"). We act as a processor
          for the data your organization manages in the Service ("Customer Data"), and as a
          controller for account and billing information. Where the Service is provided to you
          through your employer, your employer determines how the features are used and is
          responsible for its own privacy practices.
        </p>
      </Section>
      <Section heading="Information we collect">
        <ul className="list-disc pl-5">
          <li>
            <span className="text-ink">Account information:</span> name, email, role, and
            organization details you provide when signing up or being invited.
          </li>
          <li>
            <span className="text-ink">Customer Data:</span> the operational data you and your users
            enter, such as locations, equipment, work orders, checklists, schedules, time entries,
            messages, and related records.
          </li>
          <li>
            <span className="text-ink">Photos and images:</span> images uploaded or captured in the
            Service, such as time-clock punch photos, checklist verification photos, and asset
            photos.
          </li>
          <li>
            <span className="text-ink">Biometric data:</span> where an employer enables facial
            verification for the time clock, a facial scan derived from punch photos used to confirm
            a worker's identity. See "Biometric data" below.
          </li>
          <li>
            <span className="text-ink">Location data:</span> where an employer enables geofencing,
            the device's approximate GPS coordinates at the moment of a clock-in or clock-out. See
            "Location data" below.
          </li>
          <li>
            <span className="text-ink">Device and notification data:</span> if you enable push
            notifications, a device subscription token used to deliver them; and basic technical
            information such as log data, browser type, and timestamps used to operate and secure
            the Service.
          </li>
          <li>
            <span className="text-ink">Integration data:</span> if you connect an optional
            integration such as Google Calendar, the limited data needed to provide it (for example,
            read-only calendar events and your connected email address).
          </li>
          <li>
            <span className="text-ink">Payment information:</span> processed by our payment
            processor, Stripe; we do not store full card numbers.
          </li>
        </ul>
      </Section>
      <Section heading="Biometric data">
        <p>
          If a Customer enables facial verification for the time clock, the Service captures a facial
          scan from a worker's punch photo and compares it to confirm the worker's identity, in
          order to prevent inaccurate or fraudulent punches. A facial geometry scan is a "biometric
          identifier" under laws such as the Texas Capture or Use of Biometric Identifier Act.
        </p>
        <ul className="list-disc pl-5">
          <li>
            <span className="text-ink">Consent and notice:</span> the Customer (employer) is
            responsible for providing the notice and obtaining the consent required by law before any
            facial data is captured. We enable the feature only at the Customer's direction.
          </li>
          <li>
            <span className="text-ink">Use:</span> we use biometric data only to verify identity for
            time tracking on the Customer's behalf. We do not use it for any other purpose and do not
            sell or lease it.
          </li>
          <li>
            <span className="text-ink">Disclosure:</span> we do not disclose biometric data except to
            the subprocessors that host and operate the Service, as directed by the Customer, or as
            required by law.
          </li>
          <li>
            <span className="text-ink">Retention and destruction:</span> we destroy biometric
            identifiers within a reasonable time, and no later than one year after the purpose for
            collecting them expires (for example, when a worker is no longer active, the Customer
            disables the feature, or the account is closed), consistent with applicable law.
          </li>
        </ul>
      </Section>
      <Section heading="Location data">
        <p>
          Geofencing is optional and, when enabled by a Customer, captures the device's approximate
          location only at the moment of a clock-in or clock-out, to confirm the punch occurred at an
          authorized site. We do not track device location continuously or in the background. The
          Customer determines whether this feature is used.
        </p>
      </Section>
      <Section heading="How we use information">
        <ul className="list-disc pl-5">
          <li>to provide, maintain, secure, and improve the Service;</li>
          <li>to authenticate users and verify time-clock punches;</li>
          <li>to generate AI-assisted features such as insights and answers about your own data;</li>
          <li>to process payments and manage subscriptions;</li>
          <li>to send operational and, where enabled, push notifications;</li>
          <li>to respond to support requests and communicate about the Service;</li>
          <li>to comply with legal obligations and enforce our terms.</li>
        </ul>
      </Section>
      <Section heading="AI features">
        <p>
          Certain features use a third-party AI provider (Anthropic) to process relevant Customer
          Data and generate outputs, such as checklist photo checks, operational insights, and
          answers to questions you ask about your data. This processing happens only to provide the
          feature. Our AI provider does not use Customer Data submitted through its API to train its
          models. AI outputs may be inaccurate and should be reviewed before you rely on them.
        </p>
      </Section>
      <Section heading="How we share information">
        <p>
          We do not sell personal information. We share information with service providers who help
          us run the Service, under confidentiality obligations, including: Supabase (hosting,
          database, storage, authentication), Stripe (payments and payouts), Anthropic (AI
          processing), and Open-Meteo and OpenStreetMap/Nominatim (weather and geocoding). If you
          connect Google Calendar, data is exchanged with Google to provide that integration. We
          also share information with members of your own organization as part of normal use, and
          when required by law or to protect rights and safety.
        </p>
      </Section>
      <Section heading="Data retention">
        <p>
          We retain information for as long as your account is active or as needed to provide the
          Service. Biometric identifiers are retained and destroyed as described under "Biometric
          data" above. After account termination, we may retain or delete data within a reasonable
          period, except where longer retention is required by law.
        </p>
      </Section>
      <Section heading="Security">
        <p>
          We use administrative, technical, and organizational measures designed to protect
          information, including access controls, row-level data isolation between organizations, and
          encryption in transit. No method of transmission or storage is completely secure, and we
          cannot guarantee absolute security.
        </p>
      </Section>
      <Section heading="Your rights">
        <p>
          Depending on your location, you may have rights to access, correct, delete, or export your
          personal information, or to object to or restrict certain processing. Texas residents may
          have rights under the Texas Data Privacy and Security Act. To make a request, contact us at
          {' '}<Email />. If your data is managed by your employer's account, we may direct your
          request to that organization, which controls the data.
        </p>
      </Section>
      <Section heading="Cookies">
        <p>
          We use cookies and similar technologies that are necessary to keep you signed in and to
          operate the Service. We do not use them for third-party advertising.
        </p>
      </Section>
      <Section heading="Children's privacy">
        <p>
          The Service is intended for business use and is not directed to children under 13, and we
          do not knowingly collect their personal information.
        </p>
      </Section>
      <Section heading="Changes to this policy">
        <p>
          We may update this Privacy Policy from time to time. We will revise the "Last updated" date
          above and, for material changes, take reasonable steps to notify you.
        </p>
      </Section>
      <Section heading="Contact">
        <p>Questions about privacy or your data? Contact {COMPANY} at <Email />.</p>
      </Section>
    </LegalLayout>
  )
}
