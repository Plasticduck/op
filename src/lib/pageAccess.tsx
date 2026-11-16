import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '@/lib/auth'
import { permRole } from '@/lib/rbac'
import { pageAccess, type PageAccessRow } from '@/lib/queries/pageAccess'
import { pageOverride } from '@/lib/pageAccessLogic'

type PageAccessState = {
  rows: PageAccessRow[]
  loading: boolean
  reload: () => Promise<void>
  // The signed-in person's explicit grant (true) or block (false) for a page.
  mine: (page: string) => boolean | undefined
}

const PageAccessContext = createContext<PageAccessState | undefined>(undefined)

export function PageAccessProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [rows, setRows] = useState<PageAccessRow[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!profile) return
    try {
      setRows(await pageAccess.list())
    } catch {
      // Without the rows everyone keeps their usual pages, which is safe.
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => {
    void reload()
  }, [reload])

  const value = useMemo<PageAccessState>(() => ({
    rows,
    loading,
    reload,
    mine: (page) =>
      profile ? pageOverride(rows, profile, permRole(profile.role, profile.role_category), page) : undefined,
  }), [rows, loading, reload, profile])

  return <PageAccessContext.Provider value={value}>{children}</PageAccessContext.Provider>
}

// Outside the provider (public pages) nobody has overrides.
const NONE: PageAccessState = { rows: [], loading: false, reload: async () => {}, mine: () => undefined }

// eslint-disable-next-line react-refresh/only-export-components
export function usePageAccess(): PageAccessState {
  return useContext(PageAccessContext) ?? NONE
}
