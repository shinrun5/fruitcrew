import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

const LAST_UPDATED = 'October 9, 2026'

/** Plain-language privacy notice reflecting what Fruit Crew actually collects
 * and where it goes — see the Terms page for the same caveat about legal review. */
export function Privacy() {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))]">
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
              name and phone number. If you sign in with Google or Apple instead, we receive only
              your name and email address from them, never your Google/Apple password.
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
              pass-down notes. For a refund, complaint, or a remake owed to a customer, that note
              can optionally include the customer's name, phone number, and what they ordered —
              entered by an employee, not collected from the customer directly.
            </li>
            <li>
              <b>Billing info:</b> for a business on a paid plan, its subscription status and how
              many stores and add-ons it pays for. Card details are entered directly with Stripe, our
              payment processor — Fruit Crew never sees or stores card numbers.
            </li>
            <li>
              <b>Your calendar link:</b> if you add your shifts to your calendar, you get a private
              link that your calendar app reads your shifts from. Anyone who has that link can see
              your shifts, so keep it to yourself — you can reset it any time from My Shifts ›
              Calendar, which stops the old one working.
            </li>
            <li>
              <b>Push notification token:</b> if you allow notifications in the iPhone or Android
              app, your phone gives the app a token that lets notifications reach it. It's tied to
              your account only so your notifications go to your phone, and it's deleted when you
              log out or delete your account.
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
          <br />
          <br />
          Keeping chat safe: if you report a message or note, it's emailed to us along with who
          wrote it and who reported it, and the business's managers are told a report was made, so
          it can be dealt with. If you block someone, we're told who blocked whom. The person you
          report or block isn't told it was you.
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
            <li>
              <b>Apple Push Notification service</b> and <b>Firebase Cloud Messaging</b> (Google) —
              deliver notifications to the iPhone and Android apps, only if you allow notifications.
            </li>
            <li>
              <b>Stripe</b> — processes subscription payments for businesses on a paid plan.
            </li>
          </ul>
          Within a business's own account, an owner or manager can see their workers' info and
          schedules — that's the point of the tool. A coworker sees only what the app normally shows
          them (shared shifts, chat, who's on a shift with them), not other employees' contact
          details beyond what's already shown in the app.
        </Section>

        <Section title="How long it's kept">
          Data is kept while the account or business is active, and old data nobody needs any more
          is cleared automatically: read notifications after 90 days (any notification after a
          year), weekly availability after 4 weeks, resolved shift notes and closing-duty records
          after a year, and schedule history, time off and the edit log after 3 years — long enough
          for payroll records. If a business stops using Fruit Crew, its data can be deleted on
          request — see Contact below.
        </Section>

        <Section title="Cookies and local storage">
          Fruit Crew uses your browser's local storage — or, in the iPhone and Android apps, the
          same kind of storage on your device — to keep you signed in and remember small
          preferences (like which store you last viewed) — not for tracking or advertising, and
          there's no third-party analytics or ad tracking on the app.
        </Section>

        <Section title="Children">
          Fruit Crew is a workplace scheduling tool for businesses and their employees, and isn't
          directed at or knowingly used to collect data from children.
        </Section>

        <Section title="Your rights">
          You can see or correct the personal data on your account from Profile in the app. To
          delete your account and its personal data, use Profile → Delete my account while logged
          in, or{' '}
          <Link to="/delete-account" className="underline">
            this page
          </Link>{' '}
          if you'd rather not log in. Deleting your account removes your login and personal
          details; a business's own schedule/shift records stay with the business, the same way
          they would if you'd left the job, with your name kept only where it's already shown on
          past shifts and messages. If you're the only owner of a business, deleting your account
          also closes the business: its subscription is cancelled and nobody on it can sign in to
          it any more.
        </Section>

        <Section title="Changes">
          If what's collected or how it's used changes meaningfully, this page will be updated and
          the date at the top will change.
        </Section>

        <Section title="Contact">
          Questions about your data:{' '}
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
