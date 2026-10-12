import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createQueryClient } from './api/queries'
import { App } from './app/App'
import { initRouter } from './app/router'
import { startMockBackend } from './mocks/browser'
import './styles/base.css'
import './styles/ui.css'
import './styles/match.css'

const queryClient = createQueryClient()

async function bootstrap(): Promise<void> {
  initRouter()
  // Ranking and history are served by MSW in every environment, including the published build.
  await startMockBackend()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void bootstrap()
