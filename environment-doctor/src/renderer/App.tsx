import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppProvider, useApp } from './AppContext';
import { Shell } from './components/Shell';
import { LoadingState } from './components/ui';
import { CommandPalette } from './components/CommandPalette';

const Welcome = lazy(() => import('./screens/Welcome'));
const Home = lazy(() => import('./screens/Home'));
const Scan = lazy(() => import('./screens/Scan'));
const Incidents = lazy(() => import('./screens/Incidents'));
const IncidentDetail = lazy(() => import('./screens/IncidentDetail'));
const Plan = lazy(() => import('./screens/Plan'));
const Run = lazy(() => import('./screens/Run'));
const Describe = lazy(() => import('./screens/Describe'));
const Guided = lazy(() => import('./screens/Guided'));
const Resume = lazy(() => import('./screens/Resume'));
const Setup = lazy(() => import('./screens/Setup'));
const Projects = lazy(() => import('./screens/Projects'));
const Evidence = lazy(() => import('./screens/Evidence'));
const AIPreview = lazy(() => import('./screens/AIPreview'));
const History = lazy(() => import('./screens/History'));
const Actions = lazy(() => import('./screens/Actions'));
const Settings = lazy(() => import('./screens/Settings'));
const DesignSystem = lazy(() => import('./screens/DesignSystem'));

/** Start-up routing rules (Handoff “Navigation rules”): an open recovery journal always wins; first launch goes to First run. */
function Guards() {
  const { booted, recovery, health } = useApp();
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    if (!booted) return;
    if (recovery && loc.pathname !== '/recovery') nav('/recovery', { replace: true });
    else if (!recovery && health && !health.lastScanAt && loc.pathname === '/') nav('/welcome', { replace: true });
  }, [booted, recovery, health, loc.pathname, nav]);
  return null;
}

function Routed() {
  const { booted } = useApp();
  if (!booted) return <div className="fullbleed"><LoadingState label="Starting Environment Doctor…" /></div>;
  return (
    <>
      <Guards />
      <Suspense fallback={<div className="fullbleed"><LoadingState /></div>}>
        <Routes>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/recovery" element={<Resume />} />
          <Route element={<Shell />}>
            <Route path="/" element={<Home />} />
            <Route path="/scan" element={<Scan />} />
            <Route path="/diagnose" element={<Describe />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/incidents/:id" element={<IncidentDetail />} />
            <Route path="/incidents/:id/plan" element={<Plan />} />
            <Route path="/incidents/:id/run" element={<Run />} />
            <Route path="/incidents/:id/guided" element={<Guided />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<Projects />} />
            <Route path="/evidence" element={<Evidence />} />
            <Route path="/evidence/preview/:incident" element={<AIPreview />} />
            <Route path="/evidence/:id" element={<Evidence />} />
            <Route path="/history" element={<History />} />
            <Route path="/actions" element={<Actions />} />
            <Route path="/actions/:id" element={<Actions />} />
            <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
            <Route path="/settings/:section" element={<Settings />} />
            <Route path="/design" element={<DesignSystem />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
      <CommandPalette />
    </>
  );
}

export function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Routed />
      </HashRouter>
    </AppProvider>
  );
}
