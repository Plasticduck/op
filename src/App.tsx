import { RouterProvider } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth'
import { TopLoadingBar } from '@/components/feedback/TopLoadingBar'
import { router } from '@/routes'

export default function App() {
  return (
    <AuthProvider>
      <TopLoadingBar />
      <RouterProvider router={router} />
    </AuthProvider>
  )
}
