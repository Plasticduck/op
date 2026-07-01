import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '@/lib/auth'
import { getCompany, type CompanySettings, type CorporateInfo } from '@/lib/queries/companySettings'

type CompanyState = {
  name: string
  corporate: CorporateInfo
  settings: CompanySettings
  loading: boolean
  reload: () => Promise<void>
}

const CompanyContext = createContext<CompanyState | undefined>(undefined)

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [name, setName] = useState('')
  const [settings, setSettings] = useState<CompanySettings>({})
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!profile) return
    const { name: n, settings: s } = await getCompany(profile.account_id)
    setName(n)
    setSettings(s)
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.account_id])

  const value: CompanyState = {
    name,
    corporate: settings.corporate ?? {},
    settings,
    loading,
    reload: load,
  }

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCompany(): CompanyState {
  const ctx = useContext(CompanyContext)
  if (!ctx) throw new Error('useCompany must be used within <CompanyProvider>')
  return ctx
}
