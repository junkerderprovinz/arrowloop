import { useCallback, useEffect, useState } from 'react'

import { Card, Stack } from './components/Shell'
import { Selector } from './components/Selector'
import { History, Jobs } from './pages/Jobs'
import { Preview } from './pages/Preview'
import { api, type Job, type Run } from './lib/api'
import { ACCENTS, applyAccent, applyShape, cacheAppearance, type Shape } from './lib/appearance'
import { wireTooltips } from './lib/tooltip'

type Tab = 'jobs' | 'history' | 'look'
type Theme = 'system' | 'dark' | 'light'

const THEME_KEY = 'reeveroll.theme'

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // A browser with storage disabled simply forgets the choice on reload.
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>('jobs')
  const [jobs, setJobs] = useState<Job[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem(THEME_KEY) as Theme) ?? 'system'
    } catch {
      return 'system'
    }
  })
  const [shape, setShape] = useState<Shape>('round')
  const [accent, setAccent] = useState<string>(ACCENTS[0]?.hex ?? '#FCC419')

  const refresh = useCallback(() => {
    api
      .jobs()
      .then(setJobs)
      .catch((e: Error) => setError(e.message))
    api
      .history(undefined, 50)
      .then(setRuns)
      .catch(() => {
        // A missing history is not worth an error banner over the whole page:
        // the job list is still useful without it.
      })
  }, [])

  useEffect(() => {
    wireTooltips()
    refresh()
    // Live events replace polling. A job going from waiting to running is the
    // one thing a person watches for, and asking again every second to catch it
    // is both slower and noisier than being told.
    return api.watch(() => refresh())
  }, [refresh])

  useEffect(() => applyTheme(theme), [theme])
  useEffect(() => {
    applyShape(shape)
    applyAccent(accent)
    cacheAppearance(shape, accent)
  }, [shape, accent])

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-8">
      <header className="flex items-center justify-between gap-4">
        {/* One hero per page, and this is it: the wordmark. Everything else on
            the page is supporting detail at small type. */}
        <h1 className="text-[20px] font-semibold tracking-tight">
          Reeve<span className="text-accentInk">Roll</span>
        </h1>
        <Selector<Tab>
          scale="small"
          label="Section"
          value={previewing ? 'jobs' : tab}
          onChange={(next) => {
            setPreviewing(null)
            setTab(next)
          }}
          options={[
            { value: 'jobs', label: 'Jobs', icon: '⇄' },
            { value: 'history', label: 'History', icon: '☰' },
            { value: 'look', label: 'Look', icon: '◐' },
          ]}
        />
      </header>

      {error && (
        <Card title="Cannot reach the engine">
          <p className="text-[12px] text-statusFail">{error}</p>
        </Card>
      )}

      {previewing ? (
        <Preview
          job={previewing}
          onDone={() => {
            setPreviewing(null)
            refresh()
          }}
        />
      ) : tab === 'jobs' ? (
        <Jobs jobs={jobs} onPreview={setPreviewing} />
      ) : tab === 'history' ? (
        <History runs={runs} />
      ) : (
        <Stack>
          <Card title="Theme">
            <Selector<Theme>
              label="Theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'system', label: 'System' },
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
            />
          </Card>
          <Card title="Corners">
            <Selector<Shape>
              label="Corners"
              value={shape}
              onChange={setShape}
              options={[
                { value: 'round', label: 'Round' },
                { value: 'soft', label: 'Soft' },
                { value: 'square', label: 'Square' },
              ]}
            />
          </Card>
          <Card title="Accent">
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((p) => (
                <button
                  key={p.hex}
                  onClick={() => setAccent(p.hex)}
                  title={p.name}
                  data-tip={p.name}
                  aria-pressed={accent === p.hex}
                  className="h-8 w-8 transition"
                  style={{
                    background: p.hex,
                    borderRadius: 'var(--radius-pill)',
                    outline: accent === p.hex ? '2px solid var(--carbon-text)' : 'none',
                    outlineOffset: '2px',
                  }}
                />
              ))}
            </div>
          </Card>
        </Stack>
      )}
    </div>
  )
}
