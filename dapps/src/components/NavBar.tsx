import { NavLink } from 'react-router-dom'
import { ConnectButton } from './ConnectButton'
import { theme } from '../lib/theme'

const links = [
  { to: '/',          label: 'Policies' },
  { to: '/buildings', label: 'Buildings' },
  { to: '/debug',     label: 'Debug' },
]

export function NavBar() {
  return (
    <nav
      className="px-4 py-2 flex items-center gap-6"
      style={{ background: theme.headerBg, borderBottom: `1px solid ${theme.border}`, position: 'relative', zIndex: 1 }}
    >
      <div className="flex items-center gap-2">
        <img src="./logo.png" alt="ef guard" style={{ height: '28px' }} />
        <span style={{ color: theme.textPrimary, fontWeight: 700, fontSize: '14px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>EF GUARD</span>
      </div>
      <div className="flex items-center gap-1 flex-1">
        {links.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className="px-3 py-1.5 text-sm transition-colors"
            style={({ isActive }) => ({
              color: isActive ? theme.orange : theme.textSecondary,
            })}
          >
            {label}
          </NavLink>
        ))}
      </div>
      <ConnectButton />
    </nav>
  )
}
