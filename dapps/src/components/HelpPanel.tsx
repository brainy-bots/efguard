import { useState } from 'react'

export function HelpPanel() {
  const [open, setOpen] = useState(false)

  return (
    <div className="bg-surface-1 border border-surface-3 rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs text-default hover:text-white transition-colors"
      >
        <span className="font-semibold uppercase tracking-wider">How rules work</span>
        <span className="text-[10px]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 text-xs text-default space-y-3 border-t border-surface-3 pt-3">
          <div>
            <h3 className="text-white font-semibold mb-1">How rules work</h3>
            <p>Rules are checked from top to bottom. The first matching rule decides. Drag to reorder.</p>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-1">Building types</h3>
            <ul className="space-y-1 ml-3 list-disc">
              <li><span className="text-white">Gates:</span> Controls who can jump through your gates</li>
              <li><span className="text-white">Turrets:</span> Controls who your turrets target &mdash; allowed players won't be shot</li>
              <li><span className="text-white">Smart Storage:</span> Controls who can deposit or withdraw items from your storage</li>
            </ul>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-1">Blocklist</h3>
            <p>Blocklisted players are always denied, regardless of rules.</p>
          </div>
        </div>
      )}
    </div>
  )
}
