import type { ReactNode } from 'react'
import { Link, NavLink, useParams } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { AdmApplications } from './adminAmb/AdmApplications'
import { AdmLead } from './adminAmb/AdmLead'
import { AdmLeads } from './adminAmb/AdmLeads'
import { AdmOverview } from './adminAmb/AdmOverview'
import { AdmPayouts } from './adminAmb/AdmPayouts'
import { AdmPeople } from './adminAmb/AdmPeople'
import { AdmPerson } from './adminAmb/AdmPerson'
import { AdmReferrals } from './adminAmb/AdmReferrals'
import { AdmRewards } from './adminAmb/AdmRewards'
import { AdmSettings } from './adminAmb/AdmSettings'

// Admin › Student ambassadors — inside the platform admin console (AdminLayout,
// superadmins only), one tab per part of the program.
const TABS = ['overview', 'applications', 'people', 'leads', 'referrals', 'rewards', 'payouts', 'settings'] as const
type Tab = (typeof TABS)[number]

const PAGES: Record<Tab, () => ReactNode> = {
  overview: () => <AdmOverview />,
  applications: () => <AdmApplications />,
  people: () => <AdmPeople />,
  leads: () => <AdmLeads />,
  referrals: () => <AdmReferrals />,
  rewards: () => <AdmRewards />,
  payouts: () => <AdmPayouts />,
  settings: () => <AdmSettings />,
}

function Shell({ active, children }: { active: Tab; children: ReactNode }) {
  const t = useT()
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col p-4 pb-12 sm:p-8">
      <Link to="/admin" className="font-body text-xs font-bold text-sky-dark">
        ‹ {t('admin.title')}
      </Link>
      <h1 className="mt-1 font-heading text-lg font-bold text-ink">{t('ambAdmin.title')}</h1>
      <nav className="no-scrollbar -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {TABS.map((tab) => (
          <NavLink
            key={tab}
            to={`/admin/ambassadors/${tab}`}
            className={`shrink-0 rounded-full border-2 border-ink px-3 py-1 font-heading text-xs font-bold ${tab === active ? 'bg-ink text-white' : 'bg-paper text-ink'}`}
          >
            {t(`ambAdm.tab.${tab}`)}
          </NavLink>
        ))}
      </nav>
      <div className="mt-3 flex flex-col">{children}</div>
    </div>
  )
}

/** /admin/ambassadors and /admin/ambassadors/:tab */
export function AdminAmbassadors() {
  const { tab } = useParams()
  const active: Tab = (TABS as readonly string[]).includes(tab ?? '') ? (tab as Tab) : 'overview'
  return <Shell active={active}>{PAGES[active]()}</Shell>
}

/** /admin/ambassadors/people/:id */
export function AdminAmbassador() {
  return (
    <Shell active="people">
      <AdmPerson />
    </Shell>
  )
}

/** /admin/ambassadors/leads/:id */
export function AdminAmbassadorLead() {
  return (
    <Shell active="leads">
      <AdmLead />
    </Shell>
  )
}
