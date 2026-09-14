import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

const LAST_UPDATED = 'September 14, 2026'

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
        <p className="rounded-xl border-2 border-ink/15 bg-cream p-3 text-xs text-muted-ink">
          Fruit Crew is a small tool built and run by one person, currently offered free while it's
          in trial with a handful of small businesses. This page is written in plain language so
          you actually know what you're agreeing to — it hasn't been drafted or reviewed by a
          lawyer, so treat it as a good-faith description of how things work rather than a
          bulletproof legal document.
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

        <Section title="3. Free trial, and that this is early-stage software">
          Access is currently free. There's no guarantee it stays free forever, that any given
          feature stays exactly as it is, or that the service has no downtime or bugs — it's run by
          one person, not a company with an on-call team. If a paid plan is ever introduced,
          existing users will be told in advance and won't be silently switched to it.
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
          including lost revenue, labor disputes, or scheduling mistakes. Given this is offered free
          during a trial, that limitation is a central part of why it can be offered at all.
        </Section>

        <Section title="8. Ending access">
          You can stop using Fruit Crew and ask for your data to be deleted at any time. Access can
          also be suspended or ended for violating these terms, extended inactivity, or if the
          service is discontinued — with reasonable notice where practical.
        </Section>

        <Section title="9. Changes">
          These terms may be updated as the product changes. Meaningful changes will be flagged in
          the app; continuing to use Fruit Crew after a change means you accept the update.
        </Section>

        <Section title="10. Contact">
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
