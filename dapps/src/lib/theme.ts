/** EVE Frontier-inspired theme tokens shared across all pages */
export const theme = {
  bg: '#111318',
  panelBg: 'rgba(23, 27, 34, 0.85)',
  headerBg: 'rgba(26, 30, 38, 0.9)',
  border: '#252a33',
  orange: '#d4710a',
  orangeHover: '#e87b00',
  textPrimary: '#d0d0d0',
  textSecondary: '#808890',
  textMuted: '#505860',
  green: '#44b840',
  red: '#c83030',
  font: "'Segoe UI', 'Arial Narrow', Arial, sans-serif",
} as const

/** Reusable inline style objects */
export const S = {
  panel: { background: theme.panelBg, border: `1px solid ${theme.border}`, backdropFilter: 'blur(4px)' } as React.CSSProperties,
  header: { background: theme.headerBg, borderBottom: `1px solid ${theme.border}`, color: theme.orange, fontSize: '10px', letterSpacing: '0.12em', fontWeight: 700, textTransform: 'uppercase', padding: '6px 10px' } as React.CSSProperties,
  row: { borderBottom: `1px solid ${theme.border}`, padding: '5px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as React.CSSProperties,
  label: { color: theme.textSecondary, fontSize: '11px' } as React.CSSProperties,
  value: { color: theme.textPrimary, fontSize: '11px' } as React.CSSProperties,
  btn: { background: theme.orange, color: '#000', border: 'none', padding: '5px 14px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' } as React.CSSProperties,
  btnSmall: { background: theme.orange, color: '#000', border: 'none', padding: '3px 10px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' } as React.CSSProperties,
  btnDanger: { background: theme.red, color: '#fff', border: 'none', padding: '3px 10px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' } as React.CSSProperties,
  input: { background: '#1a1e26', border: `1px solid ${theme.border}`, color: theme.textPrimary, padding: '5px 10px', fontSize: '11px', outline: 'none', fontFamily: theme.font, width: '100%' } as React.CSSProperties,
  select: { background: '#1a1e26', border: `1px solid ${theme.border}`, color: theme.textPrimary, padding: '5px 10px', fontSize: '11px', outline: 'none', fontFamily: theme.font } as React.CSSProperties,
  page: { minHeight: '100vh', background: theme.bg, color: theme.textPrimary, fontFamily: theme.font, fontSize: '11px', position: 'relative' } as React.CSSProperties,
  muted: { color: theme.textMuted, fontSize: '10px' } as React.CSSProperties,
}
