import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { MarketingNav, MarketingFooter } from './components'

const CONTACT_EMAIL = 'info@washlyfe.com'
const LAST_UPDATED = 'May 22, 2026'

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
          (the "Service"), software for car wash operators to manage operations, equipment,
          and teams. By creating an account or using the Service, you agree to these Terms. If
          you are using the Service on behalf of an organization, you represent that you are
          authorized to accept these Terms on its behalf.
        </p>
      </Section>
      <Section heading="2. The service">
        <p>
          The Service provides tools including operations and equipment tracking, checklists,
          scheduling, time tracking, reporting, and related features. We may add, change, or
          remove features over time. We aim for high availability but do not guarantee the
          Service will be uninterrupted or error-free.
        </p>
      </Section>
      <Section heading="3. Accounts and eligibility">
        <p>
          You must provide accurate account information and keep it up to date. You are
          responsible for safeguarding your login credentials and for all activity under your
          account, including the activity of users you invite. Notify us promptly of any
          unauthorized use. You must be at least 18 years old to use the Service.
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
      <Section heading="5. Your data and ownership">
        <p>
          You retain all rights to the data you and your users submit ("Customer Data"). You
          grant us a limited license to host, process, and display Customer Data solely to
          provide and improve the Service. You are responsible for the accuracy and legality of
          Customer Data and for obtaining any consents required from your employees and others.
        </p>
      </Section>
      <Section heading="6. Subscriptions, trials, and billing">
        <p>
          Paid plans are billed in advance on a recurring basis through our payment processor.
          Free trials, where offered, convert to a paid subscription unless canceled before the
          trial ends. Fees are non-refundable except where required by law. We may change pricing
          with reasonable notice; changes apply to subsequent billing periods.
        </p>
      </Section>
      <Section heading="7. Third-party services">
        <p>
          The Service relies on third-party providers (for example, hosting, database, payment,
          and weather/geocoding services). Your use of those features may be subject to the
          providers' terms. We are not responsible for third-party services we do not control.
        </p>
      </Section>
      <Section heading="8. Disclaimers">
        <p>
          The Service is provided "as is" and "as available" without warranties of any kind,
          whether express or implied, including merchantability, fitness for a particular
          purpose, and non-infringement. We do not warrant that the Service will meet your
          requirements or be error-free.
        </p>
      </Section>
      <Section heading="9. Limitation of liability">
        <p>
          To the maximum extent permitted by law, we will not be liable for any indirect,
          incidental, special, consequential, or punitive damages, or any loss of data, profits,
          or revenue. Our total liability for any claim relating to the Service will not exceed
          the amount you paid to us for the Service in the twelve months before the claim arose.
        </p>
      </Section>
      <Section heading="10. Termination">
        <p>
          You may stop using the Service and cancel your subscription at any time. We may suspend
          or terminate access if you breach these Terms or to protect the Service. Upon
          termination, your right to use the Service ends; we may delete Customer Data after a
          reasonable period unless retention is required by law.
        </p>
      </Section>
      <Section heading="11. Changes to these terms">
        <p>
          We may update these Terms from time to time. If we make material changes, we will take
          reasonable steps to notify you. Your continued use of the Service after changes take
          effect constitutes acceptance of the updated Terms.
        </p>
      </Section>
      <Section heading="12. Contact">
        <p>Questions about these Terms? Contact us at <Email />.</p>
      </Section>
    </LegalLayout>
  )
}

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <Section heading="Overview">
        <p>
          This Privacy Policy explains how WashLyfe Operator ("we", "us") collects, uses, and
          shares information when you use the Service. We act as a processor for the data your
          organization manages in the Service, and as a controller for account and billing
          information.
        </p>
      </Section>
      <Section heading="Information we collect">
        <ul className="list-disc pl-5">
          <li>
            <span className="text-ink">Account information:</span> name, email, role, and
            organization details you provide when signing up or being invited.
          </li>
          <li>
            <span className="text-ink">Customer Data:</span> the operational data you and your
            users enter, such as locations, equipment, checklists, schedules, time entries, and
            related records.
          </li>
          <li>
            <span className="text-ink">Usage and device data:</span> basic technical
            information such as log data, browser type, and timestamps, used to operate and
            secure the Service.
          </li>
          <li>
            <span className="text-ink">Payment information:</span> handled by our payment
            processor; we do not store full card numbers.
          </li>
        </ul>
      </Section>
      <Section heading="How we use information">
        <ul className="list-disc pl-5">
          <li>to provide, maintain, and improve the Service;</li>
          <li>to authenticate users and secure accounts;</li>
          <li>to process payments and manage subscriptions;</li>
          <li>to respond to support requests and communicate about the Service;</li>
          <li>to comply with legal obligations and enforce our terms.</li>
        </ul>
      </Section>
      <Section heading="How we share information">
        <p>
          We do not sell personal information. We share information with service providers who
          help us run the Service (for example, hosting, database, and payment providers) under
          confidentiality obligations, with members of your own organization as part of normal
          use, and when required by law or to protect rights and safety.
        </p>
      </Section>
      <Section heading="Data retention">
        <p>
          We retain information for as long as your account is active or as needed to provide the
          Service. After account termination, we may retain or delete data within a reasonable
          period, except where longer retention is required by law.
        </p>
      </Section>
      <Section heading="Security">
        <p>
          We use administrative, technical, and organizational measures designed to protect
          information, including access controls and encryption in transit. No method of
          transmission or storage is completely secure, and we cannot guarantee absolute security.
        </p>
      </Section>
      <Section heading="Your rights">
        <p>
          Depending on your location, you may have rights to access, correct, delete, or export
          your personal information, or to object to or restrict certain processing. To make a
          request, contact us at <Email />. If your data is managed by your employer's account,
          we may direct your request to that organization.
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
          The Service is intended for business use and is not directed to children under 13, and
          we do not knowingly collect their personal information.
        </p>
      </Section>
      <Section heading="Changes to this policy">
        <p>
          We may update this Privacy Policy from time to time. We will revise the "Last updated"
          date above and, for material changes, take reasonable steps to notify you.
        </p>
      </Section>
      <Section heading="Contact">
        <p>Questions about privacy or your data? Contact us at <Email />.</p>
      </Section>
    </LegalLayout>
  )
}
