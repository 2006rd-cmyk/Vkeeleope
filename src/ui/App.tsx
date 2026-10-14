import { Component, type ComponentChildren } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Model, type Outcome } from '../model';
import type { Store } from '../store';
import { Api, FlagIcon, type AppApi } from './common';
import { Lesson } from './Lesson';
import { FeedbackModal, Home, Notes, Onboarding, Progress, Result, SettingsPage, Words } from './screens';

type Screen = { s: 'home' } | { s: 'lesson' } | { s: 'result'; o: Outcome } | { s: 'notes'; unit: number };
type Tab = 'path' | 'progress' | 'words' | 'settings';

export function App({ initial, store, makeModel, session }: { initial: Model; store: Store; makeModel: () => Promise<Model>; session: { id: number; opened: number } | null }) {
  const [model, setModel] = useState(initial);
  const [, setTick] = useState(0);
  const [screen, setScreen] = useState<Screen>({ s: 'home' });
  const [tab, setTab] = useState<Tab>('path');
  const [flag, setFlag] = useState(false);
  const [toastMsg, setToast] = useState<string | null>(null);
  const where = useRef<{ screen: string; item?: string }>({ screen: 'home' });
  const firstExerciseLogged = useRef(false);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const toast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast((x) => (x === m ? null : x)), 2600);
  }, []);
  useEffect(() => {
    model.onError = (e) => {
      console.error(e);
      toast('Saving failed. Free some space on the phone, then try again.');
    };
  }, [model]);

  const api: AppApi = useMemo(
    () => ({
      model,
      store,
      refresh,
      toast,
      setWhere: (screen, item) => {
        where.current = { screen, item };
        if (screen === 'lesson' && !firstExerciseLogged.current && session) {
          firstExerciseLogged.current = true;
          void store.updateSession({ ...session, firstExercise: Date.now() }).catch(() => undefined);
        }
      },
      reload: async () => {
        const m = await makeModel();
        setModel(m);
        setScreen({ s: 'home' });
        setTab('path');
      },
    }),
    [model],
  );

  // Coming back to the app (maybe the next day): recount what is due.
  useEffect(() => {
    const h = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, []);

  // Android back button / swipe back: return to the path instead of leaving the app.
  useEffect(() => {
    if (screen.s !== 'home') {
      history.pushState({ vire: screen.s }, '');
      const pop = () => {
        void model.leave();
        setScreen({ s: 'home' });
      };
      window.addEventListener('popstate', pop);
      return () => window.removeEventListener('popstate', pop);
    }
    return undefined;
  }, [screen.s]);

  useEffect(() => {
    if (screen.s === 'home') where.current = { screen: tab };
    if (screen.s === 'notes') where.current = { screen: `notes:${screen.unit}` };
    if (screen.s === 'result') where.current = { screen: `result:${screen.o.key}` };
  }, [screen, tab]);

  const startKey = (key: string) => {
    if (model.run?.plan.key === key) {
      setScreen({ s: 'lesson' });
      return;
    }
    if (key === 'review') model.startReview();
    else if (key.startsWith('jump:')) model.startJump(Number(key.slice(5)));
    else if (key === 'practice') model.startReview();
    else model.startStep(key);
    setScreen({ s: 'lesson' });
  };

  if (!model.profile) {
    return (
      <Api.Provider value={api}>
        <div class="app">
          <Onboarding onDone={refresh} />
          {toastMsg ? <div class="toast">{toastMsg}</div> : null}
        </div>
      </Api.Provider>
    );
  }

  let body: ComponentChildren;
  if (screen.s === 'lesson' && model.run) {
    body = (
      <Lesson
        onExit={() => {
          void model.leave();
          setScreen({ s: 'home' });
        }}
        onDone={(o) => setScreen({ s: 'result', o })}
        onFlag={() => setFlag(true)}
      />
    );
  } else if (screen.s === 'result') {
    const o = screen.o;
    const next = model.currentStep();
    body = (
      <Result
        o={o}
        onNext={next ? () => startKey(next.key) : undefined}
        onAgain={() => startKey(o.key)}
        onHome={() => setScreen({ s: 'home' })}
      />
    );
  } else if (screen.s === 'notes') {
    body = <Notes unit={screen.unit} onBack={() => setScreen({ s: 'home' })} />;
  } else {
    body = (
      <>
        <header class="top">
          <div class="brand">
            <span class="logo" aria-hidden="true">В</span> Vire
          </div>
          <button type="button" class="icon-btn" aria-label="Send feedback" onClick={() => setFlag(true)}>
            <FlagIcon />
          </button>
        </header>
        <main class="main">
          {tab === 'path' ? (
            <Home
              onStart={startKey}
              onReview={() => startKey('review')}
              onNotes={(unit) => setScreen({ s: 'notes', unit })}
              onJump={(unit) => {
                model.startJump(unit);
                setScreen({ s: 'lesson' });
              }}
            />
          ) : tab === 'progress' ? (
            <Progress
              onPractise={(ids) => {
                model.startPractice(ids);
                setScreen({ s: 'lesson' });
              }}
            />
          ) : tab === 'words' ? (
            <Words />
          ) : (
            <SettingsPage />
          )}
        </main>
        <nav class="tabs" aria-label="Sections">
          {(
            [
              ['path', 'Path', '🗺️'],
              ['progress', 'Progress', '📈'],
              ['words', 'Words', '📖'],
              ['settings', 'Settings', '⚙️'],
            ] as [Tab, string, string][]
          ).map(([t, label, icon]) => (
            <button type="button" class={`tab${tab === t ? ' on' : ''}`} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
              <span class="tab-icon" aria-hidden="true">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </>
    );
  }

  return (
    <Api.Provider value={api}>
      <ErrorBoundary>
        <div class={`app${screen.s === 'lesson' ? ' in-lesson' : ''}`}>{body}</div>
      </ErrorBoundary>
      {flag ? <FeedbackModal screen={where.current.screen} item={where.current.item} onClose={() => setFlag(false)} /> : null}
      {toastMsg ? <div class="toast" role="status">{toastMsg}</div> : null}
    </Api.Provider>
  );
}

class ErrorBoundary extends Component<{ children: ComponentChildren }, { err: Error | null }> {
  state = { err: null as Error | null };
  componentDidCatch(err: Error) {
    console.error(err);
    this.setState({ err });
  }
  render() {
    if (this.state.err) {
      return (
        <div class="onboard">
          <h1>Something went wrong</h1>
          <p class="muted">Your progress is saved. Reload to continue.</p>
          <pre class="err">{String(this.state.err.message || this.state.err)}</pre>
          <button type="button" class="btn primary wide" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
