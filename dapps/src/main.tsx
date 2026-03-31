import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { EveFrontierProvider } from '@evefrontier/dapp-kit'
import { App } from './App'
import { ToastProvider } from './components/Toast'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EveFrontierProvider queryClient={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </EveFrontierProvider>
  </StrictMode>,
)
