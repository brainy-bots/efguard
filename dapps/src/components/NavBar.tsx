import { NavLink } from 'react-router-dom'
import { ConnectButton } from './ConnectButton'

const links = [
  { to: '/',          label: 'Policies' },
  { to: '/buildings', label: 'Buildings' },
  { to: '/debug',     label: 'Debug' },
]

export function NavBar() {
  return (
    <nav className="bg-surface-1 border-b border-surface-3 px-4 py-2 flex items-center gap-6">
      <span className="text-accent font-bold tracking-wider text-sm uppercase">efguard</span>
      <div className="flex items-center gap-1 flex-1">
        {links.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `px-3 py-1.5 text-sm rounded transition-colors ${
                isActive
                  ? 'text-accent bg-surface-2'
                  : 'text-default hover:text-white hover:bg-surface-2'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>
      <ConnectButton />
    </nav>
  )
}
