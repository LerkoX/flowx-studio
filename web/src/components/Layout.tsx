import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div className="h-screen w-screen overflow-hidden">
      <Sidebar />
      <main className="h-full overflow-hidden md:ml-12">
        <Outlet />
      </main>
    </div>
  )
}
