import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

const LAST_UPDATED = 'September 18, 2026'

/** Plain-language privacy notice reflecting what Fruit Crew actually collects
 * and where it goes — see the Terms page for the same caveat about legal review. */
export function Privacy() {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-6 pb-16">
      <Link to="/login" className="font-body text-xs font-bold text-muted-ink underline">
        ← Back
      </Link>
      <h1 className="mt-3 font-heading text-2xl font-extrabold text-ink">Privacy Policy</h1>
      <p className="mt-1 font-body text-xs text-muted-ink">Last updated {LAST_UPDATED}</p>

      <div className="mt-6 flex flex-col gap-5 font-body text-sm leading-relaxed text-ink">
        <p className="font-body text-xs text-muted-ink">
          Fruit Crew is operated by Vortyx LLC, a New Jersey limited liability company.
        </p>

        <p className="rounded-xl border-2 border-ink/15 bg-cream p-3 text-xs text-muted-ink">
          Fruit Crew is a small tool built and run by one person. This describes what data it
          collects and why in plain language — nothing here is sold to advertisers or used to build
          a profile on anyone.
        </p>

        <Section title="What's collected">
          <ul className="list-disc pl-5">
            <li>
              <b>Account info:</b> email and password (handled by our authentication provider,
              Supabase — Fruit Crew never sees or stores your raw password), and optionally your
              name and phone number.
            </li>
            <li>
              <b>Work info a manager enters:</b> employee names, phone numbers, job tier, hour/day
              limits, and availability.
            </li>
            <li>
              <b>Schedule data:</b> shifts, shift-swap requests, time-off notices, and the schedule
              history for a store.
            </li>
            <li>
              <b>Messages:</b> store group chat and direct messages between coworkers, and shift
              pass-down notes.
            </li>
            <li>
              <b>Basic technical data:</b> if something crashes, the error message and page it
              happened on are sent automatically so it can get fixed — not sent for normal use,
              only when something actually goes wrong.
            </li>
          </ul>
        </Section>

        <Section title="What it's used for">
          Solely to run the scheduling app: building and showing schedules, sending the emails
          you'd expect (a shift got posted to the marketplace, someone @-mentioned you, a weekly
          availability reminder), and fixing bugs. Nothing here is used for advertising, sold to
          third parties, or used to build a profile on you outside of running this app.
        </Section>

        <Section title="Who it's shared with">
          A few services that help run Fruit Crew process this data on our behalf, only for that
          purpose:
          <ul className="mt-1.5 list-disc pl-5">
            <li>
              <b>Supabase</b> — login/authentication and the database that stores everything above.
            </li>
            <li>
              <b>Resend</b> — sends the transactional emails the app triggers (invites, reminders,
              notifications).
            </li>
            <li>
              <b>Railway</b> — hosts the application itself.
            </li>
          </ul>
          Within a business's own account, an owner or manager can see their workers' info and
          schedules — that's the point of the tool. A coworker sees only what the app normally shows
          them (shared shifts, chat, who's on a shift with them), not other employees' contact
          details beyond what's already shown in the app.
        </Section>

        <Section title="How long it's kept">
          Data is kept as long as the account or business is active on Fruit Crew. If a business
          stops using it, its data can be deleted on request — see Contact below.
        </Section>

        <Section title="Cookies and local storage">
          Fruit Crew uses your browser's local storage to keep you signed in and remember small
          preferences (like which store you last viewed) — not for tracking or advertising, and
          there's no third-party analytics or ad tracking on the app.
        </Section>

        <Section title="Children">
          Fruit Crew is a workplace scheduling tool for businesses and their employees, and isn't
          directed at or knowingly used to collect data from children.
        </Section>

        <Section title="Your rights">
          You can ask to see, correct, or delete the personal data associated with your account.
          Reach out using the contact info below and it'll be handled directly — there's no
          automated self-serve deletion flow yet, since this is a small, early-stage tool.
        </Section>

        <Section title="Changes">
          If what's collected or how it's used changes meaningfully, this page will be updated and
          the date at the top will change.
        </Section>

        <Section title="Contact">
          Questions about your data, or a deletion request:{' '}
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
      <div className="text-muted-ink">{children}</div>
    </section>
  )
}
