import { lazy, Suspense } from 'react'
import { usePendingMatchSync } from '../api/queries'
import { CaptainsLog } from '../features/log/CaptainsLog'
import { MainMenu } from '../features/menu/MainMenu'
import { NetworkLab } from '../features/network/NetworkLab'
import { OptionsScreen } from '../features/options/OptionsScreen'
import { ResultScreen } from '../features/result/ResultScreen'
import { useRoute } from './router'

// PixiJS and the game code are only downloaded when a match is opened.
const MatchScreen = lazy(() =>
  import('../features/match/MatchScreen').then((module) => ({ default: module.MatchScreen })),
)

export function App() {
  const route = useRoute()
  // Registration of finished matches keeps running whatever screen is shown.
  usePendingMatchSync()

  switch (route) {
    case '/play':
      return (
        <Suspense
          fallback={
            <div className="match-stage" role="status">
              <p className="match-fallback">Loading battle…</p>
            </div>
          }
        >
          <MatchScreen />
        </Suspense>
      )
    case '/options':
      return <OptionsScreen />
    case '/result':
      return <ResultScreen />
    case '/log/ranking':
      return <CaptainsLog tab="ranking" />
    case '/log/history':
      return <CaptainsLog tab="history" />
    case '/network':
      return <NetworkLab />
    default:
      return <MainMenu />
  }
}
