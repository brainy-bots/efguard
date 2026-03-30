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
            <h3 className="text-white font-semibold mb-1">Evaluation order</h3>
            <p>Rules are evaluated top-to-bottom. The first matching rule wins. Drag rules to reorder priority.</p>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-1">Effects by building type</h3>
            <ul className="space-y-1 ml-3 list-disc">
              <li><span className="text-white">Gates / SSUs:</span> Allow = can use, Deny = blocked</li>
              <li><span className="text-white">Turrets:</span> Allow = friendly (won't shoot), Deny = hostile (will shoot)</li>
            </ul>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-1">Blocklist</h3>
            <p>Characters on the blocklist are always denied, regardless of rules. Blocklist overrides all rules.</p>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-1">Conditions</h3>
            <p>
              Each rule references a condition object on-chain. Conditions are pluggable:
              tribe membership, specific character, everyone, and more (NFT, balance, etc.) in future updates.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
