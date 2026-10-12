import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { navigate } from '../../app/router'
import { applyScenario, resetMockBackend } from '../../mocks/browser'
import { DEFAULT_SCENARIO, getScenario, isScenarioId, SCENARIOS, type ScenarioId } from '../../mocks/scenarios'
import { MenuButton, Screen } from '../../ui/components'

const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[]

/** Lets anyone reproduce network conditions of the mocked APIs, including in the published build. */
export function NetworkLab() {
  const queryClient = useQueryClient()
  const [scenario, setScenario] = useState(getScenario)
  const [latency, setLatency] = useState(String(scenario.latencyMs))
  const [seed, setSeed] = useState(String(scenario.seed))
  const [status, setStatus] = useState('')

  const refreshQueries = () => {
    // Drop cached answers so the next visit to the tabs shows the selected scenario.
    queryClient.removeQueries({ queryKey: ['ranking'] })
    queryClient.removeQueries({ queryKey: ['history'] })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const latencyMs = Number(latency)
    const seedValue = Number(seed)
    const applied = applyScenario({
      id: scenario.id,
      latencyMs: Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : DEFAULT_SCENARIO.latencyMs,
      seed: Number.isFinite(seedValue) ? seedValue : DEFAULT_SCENARIO.seed,
    })
    setScenario(applied)
    setLatency(String(applied.latencyMs))
    setSeed(String(applied.seed))
    refreshQueries()
    setStatus(`Scenario "${SCENARIOS[applied.id].label}" is active.`)
  }

  const handleReset = () => {
    resetMockBackend()
    const fresh = getScenario()
    setScenario(fresh)
    setLatency(String(fresh.latencyMs))
    setSeed(String(fresh.seed))
    refreshQueries()
    setStatus('Mock server restored: default scenario, no registered matches.')
  }

  return (
    <Screen wide labelledBy="network-title">
      <h1 id="network-title" className="panel-title">
        Network Lab
      </h1>
      <p className="log-caption">Simulated conditions for the ranking and match history APIs</p>
      <form className="network-form" onSubmit={handleSubmit}>
        <fieldset className="scenario-list">
          <legend className="visually-hidden">Network scenario</legend>
          {SCENARIO_IDS.map((id) => (
            <label key={id} className="scenario">
              <input
                type="radio"
                name="scenario"
                value={id}
                checked={scenario.id === id}
                onChange={(event) => {
                  if (isScenarioId(event.target.value)) setScenario({ ...scenario, id: event.target.value })
                }}
              />
              <span>
                <strong>{SCENARIOS[id].label}</strong>
                <small>{SCENARIOS[id].description}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="network-fields">
          <label>
            Base latency (ms)
            <input
              type="number"
              min={0}
              max={10000}
              step={50}
              value={latency}
              onChange={(event) => setLatency(event.target.value)}
            />
          </label>
          <label>
            Latency seed
            <input type="number" step={1} value={seed} onChange={(event) => setSeed(event.target.value)} />
          </label>
        </div>
        <p className="form-status" role="status" data-testid="network-status">
          {status}
        </p>
        <div className="menu-actions menu-actions--row">
          <MenuButton type="submit">Apply</MenuButton>
          <MenuButton variant="secondary" onClick={handleReset}>
            Reset Mocks
          </MenuButton>
          <MenuButton variant="secondary" onClick={() => navigate('/')}>
            Main Menu
          </MenuButton>
        </div>
      </form>
    </Screen>
  )
}
