import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

const LAST_UPDATED = 'September 18, 2026'

/** Plain-language terms for a small, single-operator scheduling tool. Not a
 * substitute for a lawyer's review — see the note at the top of the page. */
export function Terms() {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-6 pb-16">
      <Link to="/login" className="font-body text-xs font-bold text-muted-ink underline">
        ← Back
      </Link>
      <h1 className="mt-3 font-heading text-2xl font-extrabold text-ink">Terms of Service</h1>
      <p className="mt-1 font-body text-xs text-muted-ink">Last updated {LAST_UPDATED}</p>

      <div className="mt-6 flex flex-col gap-5 font-body text-sm leading-relaxed text-ink">
        <p className="font-body text-xs text-muted-ink">
          Fruit Crew is operated by Vortyx LLC, a New Jersey limited liability company ("we," "us,"
          "our"). By creating an account or using Fruit Crew, you ("you," the business and anyone
          using the account on its behalf) agree to these terms.
        </p>

        <p className="rounded-xl border-2 border-ink/15 bg-cream p-3 text-xs text-muted-ink">
          Fruit Crew is a small tool built and run by one person, used by a small number of
          independent businesses to run their own staff scheduling. This page is written in plain
          language so you actually know what you're agreeing to — it hasn't been drafted or
          reviewed by a lawyer, so treat it as a good-faith description of how things work rather
          than a bulletproof legal document.
        </p>

        <Section title="1. What Fruit Crew is">
          Fruit Crew is a web app for building and sharing staff schedules: shift assignment,
          availability, shift swaps, a group chat, and related tools for a small business and its
          employees. You use it at your own discretion to run your own scheduling — Fruit Crew
          doesn't employ, manage, or direct anyone on your team.
        </Section>

        <Section title="2. Accounts and who's responsible for what">
          Whoever sets up an account for a business (the "owner") is responsible for the accuracy
          of the schedule, availability, and worker information entered into it, for keeping their
          own login secure, and for how that business uses the data collected — including
          complying with whatever labor laws, scheduling notice requirements, or record-keeping
          rules apply to their business. Fruit Crew is a tool, not a compliance service, and
          doesn't check your schedules against local labor law.
        </Section>

        <Section title="3. Fees, and that this is early-stage software">
          Fruit Crew is currently free to use. We reserve the right to introduce fees or paid plans
          in the future — if we do, you'll be told in advance of any change that affects your
          account, and you won't be automatically charged or switched to a paid plan without a
          chance to cancel first. There's also no guarantee any given feature stays exactly as it
          is, or that the service has no downtime or bugs — it's run by one person, not a company
          with an on-call team.
        </Section>

        <Section title="4. Acceptable use">
          Don't use Fruit Crew for anything illegal, to harass or abuse anyone in chat or direct
          messages, to try to access another business's data, or to interfere with the service
          (scraping, overloading it, probing for security holes without permission). An account can
          be suspended or removed for this kind of use.
        </Section>

        <Section title="5. Your data">
          Data you or your employees enter — schedules, availability, chat messages, contact info —
          belongs to your business. See the{' '}
          <Link to="/privacy" className="underline">
            Privacy Policy
          </Link>{' '}
          for what's collected and how it's used. You can ask for your business's data to be
          exported or deleted at any time.
        </Section>

        <Section title="6. No warranty">
          Fruit Crew is provided "as is." There's no guarantee it will be error-free, available at
          all times, or fit for any particular purpose — including that a generated schedule always
          gets staffing right. Always sanity-check a schedule before relying on it.
        </Section>

        <Section title="7. Limitation of liability">
          To the extent the law allows, Fruit Crew's operator isn't liable for indirect, incidental,
          or consequential damages arising from using (or being unable to use) the service —
          including lost revenue, labor disputes, or scheduling mistakes. Fruit Crew's total
          liability for any claim relating to the service is limited to whatever you paid for it in
          the 12 months before the claim arose, or $100 if you haven't paid anything — a limit
          that's a central part of why a tool like this can be run by one person at all.
        </Section>

        <Section title="8. Term and ending access">
          These terms apply for as long as you use Fruit Crew. You can stop using it and ask for
          your data to be deleted at any time. Access can also be suspended or ended for violating
          these terms, non-payment (if a paid plan is ever introduced), extended inactivity, or if
          the service is discontinued — with reasonable notice where practical.
        </Section>

        <Section title="9. Governing law">
          These terms are governed by the laws of the State of New Jersey, without regard to its
          conflict-of-law rules. Any dispute relating to these terms or the service will be handled
          in the state or federal courts located in New Jersey.
        </Section>

        <Section title="10. Changes">
          These terms may be updated as the product changes. Meaningful changes will be flagged in
          the app; continuing to use Fruit Crew after a change means you accept the update.
        </Section>

        <Section title="11. Contact">
          Questions about these terms:{' '}
          <a href="mailto:contact@fruitcrew.app" className="underline">
            contact@fruitcrew.app
          </a>
          .
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 font-heading text-sm font-bold text-ink">{title}</h2>
      <p className="text-muted-ink">{children}</p>
    </section>
  )
}
