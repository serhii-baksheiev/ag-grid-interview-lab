import { useState } from 'react';
import '../shared/grid/register';
import LiveTelemetry from '../features/live-telemetry/LiveTelemetry';
import HistoricalLogs from '../features/historical-logs/HistoricalLogs';
import Analytics from '../features/analytics/Analytics';
import DeviceConfiguration from '../features/device-configuration/DeviceConfiguration';
import { ErrorBoundary } from '../shared/ui/ErrorBoundary';
import './styles.css';
import './responsive.css';
const navigation = [
  {
    id: 'live',
    label: 'Live Telemetry',
    icon: '◉',
    detail: 'Streaming signals',
  },
  {
    id: 'history',
    label: 'Historical Logs',
    icon: '▤',
    detail: 'Explore the timeline',
  },
  {
    id: 'configuration',
    label: 'Device Configuration',
    icon: '▦',
    detail: 'Edit your fleet',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: '▥',
    detail: 'Understand the fleet',
  },
  {
    id: 'guide',
    label: 'Interview Guide',
    icon: '◇',
    detail: 'Learn the decisions',
  },
] as const;
type View = (typeof navigation)[number]['id'];
export function App() {
  const [view, setView] = useState<View>('live');
  const [configVisited, setConfigVisited] = useState(false);
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('iot-lab:v1:theme') === 'dark';
    } catch {
      return false;
    }
  });
  return (
    <div
      className={`app ag-theme-mode ${dark ? 'dark' : ''}`}
      data-ag-theme-mode={dark ? 'dark' : 'light'}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">▦</span>
          <div>
            GRID / LAB<small>IoT INTERVIEW CONSOLE</small>
          </div>
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              key={item.id}
              aria-current={view === item.id ? 'page' : undefined}
              aria-label={item.label}
              className={view === item.id ? 'nav-active' : ''}
              onClick={() => {
                setView(item.id);
                if (item.id === 'configuration') setConfigVisited(true);
              }}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>
                {item.label}
                <small>{item.detail}</small>
              </span>
              {view === item.id && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <i />
            LOCAL DEMO ENVIRONMENT
          </div>
          <p>
            Real grid patterns.
            <br />
            Reproducible experiments.
          </p>
          <span>AG Grid 36.1 · Community</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            Workspace <span>/</span>
            <strong>
              {navigation.find((item) => item.id === view)?.label}
            </strong>
          </div>
          <div>
            <span className="seed-badge">SEED 42</span>
            <button
              className="theme-button"
              aria-label={dark ? 'Use light theme' : 'Use dark theme'}
              onClick={() => {
                const next = !dark;
                setDark(next);
                try {
                  localStorage.setItem(
                    'iot-lab:v1:theme',
                    next ? 'dark' : 'light',
                  );
                } catch {
                  /* In-memory theme remains usable. */
                }
              }}
            >
              {dark ? '☀ Light' : '☾ Dark'}
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {view === 'live' && (
            <ErrorBoundary storageKey="iot-lab:v1:live">
              <LiveTelemetry />
            </ErrorBoundary>
          )}
          {view === 'history' && (
            <ErrorBoundary storageKey="iot-lab:v1:history">
              <HistoricalLogs />
            </ErrorBoundary>
          )}
          {view === 'analytics' && (
            <ErrorBoundary storageKey="iot-lab:v1:analytics">
              <Analytics />
            </ErrorBoundary>
          )}
          {configVisited && (
            <div hidden={view !== 'configuration'}>
              <ErrorBoundary storageKey="iot-lab:v1:configuration">
                <DeviceConfiguration />
              </ErrorBoundary>
            </div>
          )}
          {view === 'guide' && (
            <section>
              <div className="feature-heading">
                <div>
                  <p className="eyebrow">THE INTERVIEW TOOLKIT</p>
                  <h1>Explain the architecture.</h1>
                  <p>
                    Use the console to turn API knowledge into a working
                    demonstration.
                  </p>
                </div>
              </div>
              <div className="guide-cards">
                <article className="panel">
                  <span className="step-number">01</span>
                  <h2>Follow a live update</h2>
                  <p>
                    Open <code>features/live-telemetry/LiveTelemetry.tsx</code>.
                    Follow a seeded measurement through a stable row ID into an
                    async transaction. Why does the component avoid setting
                    rowData on each tick?
                  </p>
                </article>
                <article className="panel">
                  <span className="step-number">02</span>
                  <h2>Trace a historical query</h2>
                  <p>
                    Open the request inspector. Change a filter and watch block
                    loading. Explain why filtering must happen before pagination
                    and how cancelled requests differ from parallel requests.
                  </p>
                </article>
                <article className="panel">
                  <span className="step-number">03</span>
                  <h2>Make an edit safe</h2>
                  <p>
                    Edit a threshold, simulate a failed save, then revert.
                    Explain parser, validator, setter, draft and saved baseline
                    as separate responsibilities.
                  </p>
                </article>
              </div>
              <div className="panel guide-reading">
                <h2>Your study materials</h2>
                <p>
                  Read the local <code>docs/INTERVIEW_NOTES_RU.md</code> for
                  detailed Russian explanations,{' '}
                  <code>docs/INTERVIEW_PHRASES_EN.md</code> for spoken English,
                  and <code>docs/LIVE_CODING_TASKS.md</code> for ten exercises.
                </p>
                <p>
                  Keyboard: Tab into the grid, arrow keys to navigate, Enter or
                  F2 to edit, Escape to cancel. Native multi-cell clipboard and
                  pivot require Enterprise. This application uses no licence
                  key.
                </p>
              </div>
            </section>
          )}
        </main>
        <footer className="app-footer">
          <span>AG Grid IoT Interview Lab</span>
          <span>Synthetic data · No backend · No network at runtime</span>
        </footer>
      </div>
    </div>
  );
}
