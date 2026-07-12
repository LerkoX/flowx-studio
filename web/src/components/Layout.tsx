import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-br from-[#0a0e27] via-[#1a1f3a] to-[#0f172a]">
      <Sidebar />
      <main className="h-full overflow-hidden md:ml-12">
        <Outlet />
      </main>
    </div>
  )
}
