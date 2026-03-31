import { useState, useCallback, createContext, useContext } from 'react'
import { theme } from '../lib/theme'

interface ToastMessage {
  id: number
  text: string
  type: 'success' | 'error'
}

interface ToastContextType {
  success: (msg: string) => void
  error: (msg: string) => void
}

const ToastContext = createContext<ToastContextType>({
  success: () => {},
  error: () => {},
})

export function useToast() {
  return useContext(ToastContext)
}

let nextId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const add = useCallback((text: string, type: 'success' | 'error') => {
    const id = nextId++
    setToasts((prev) => [...prev, { id, text, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4000)
  }, [])

  const success = useCallback((msg: string) => add(msg, 'success'), [add])
  const error = useCallback((msg: string) => add(msg, 'error'), [add])

  return (
    <ToastContext.Provider value={{ success, error }}>
      {children}
      <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background: t.type === 'success' ? 'rgba(68, 184, 64, 0.95)' : 'rgba(200, 48, 48, 0.95)',
              color: '#fff',
              padding: '10px 16px',
              fontSize: '12px',
              fontWeight: 600,
              maxWidth: '360px',
              wordBreak: 'break-word',
              border: `1px solid ${t.type === 'success' ? theme.green : theme.red}`,
              backdropFilter: 'blur(4px)',
              animation: 'fadeIn 0.2s ease-out',
            }}
          >
            {t.type === 'success' ? '\u2713 ' : '\u2717 '}{t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
