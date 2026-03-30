import { useState } from 'react'
import { theme, S } from '../lib/theme'

export function HelpPanel() {
  const [open, setOpen] = useState(false)

  return (
    <div style={S.panel}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs transition-colors"
        style={{ color: theme.textSecondary }}
        onMouseEnter={(e) => { e.currentTarget.style.color = theme.textPrimary }}
        onMouseLeave={(e) => { e.currentTarget.style.color = theme.textSecondary }}
      >
        <span className="font-semibold uppercase tracking-wider">How rules work</span>
        <span className="text-[10px]">{open ? '\u25B2' : '\u25BC'}</span>
      </button>

      {open && (
        <div
          className="px-4 pb-4 text-xs space-y-3 pt-3"
          style={{ color: theme.textSecondary, borderTop: `1px solid ${theme.border}` }}
        >
          <div>
            <h3 className="font-semibold mb-1" style={{ color: theme.textPrimary }}>How rules work</h3>
            <p>Rules are checked from top to bottom. The first matching rule decides. Drag to reorder.</p>
          </div>

          <div>
            <h3 className="font-semibold mb-1" style={{ color: theme.textPrimary }}>Building types</h3>
            <ul className="space-y-1 ml-3 list-disc">
              <li><span style={{ color: theme.textPrimary }}>Gates:</span> Controls who can jump through your gates</li>
              <li><span style={{ color: theme.textPrimary }}>Turrets:</span> Controls who your turrets target &mdash; allowed players won't be shot</li>
              <li><span style={{ color: theme.textPrimary }}>Smart Storage:</span> Controls who can deposit or withdraw items from your storage</li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-1" style={{ color: theme.textPrimary }}>Blocklist</h3>
            <p>Blocklisted players are always denied, regardless of rules.</p>
          </div>
        </div>
      )}
    </div>
  )
}
