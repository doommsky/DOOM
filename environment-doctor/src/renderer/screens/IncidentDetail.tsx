/**
 * /incidents/:id — boards 05 (dev diagnosis), 09 (freeze/crash), 16 (partly fixed) and the resolved summary.
 * Loads incident.get + run.get and dispatches by status/type. Live run updates arrive on 'run.progress'.
 */
import { useParams } from 'react-router-dom';
import { useApi, useStream } from '../hooks/useApi';
import { Page } from '../components/Shell';
import { ErrorState, LinkButton, LoadingState } from '../components/ui';
import { CrashDiagnosis } from './incident/CrashDiagnosis';
import { DevDiagnosis } from './incident/DevDiagnosis';
import { PartlyFixed } from './incident/PartlyFixed';
import { ResolvedSummary } from './incident/ResolvedSummary';
import { incidentCrumbs, isTerminal } from './incident/shared';
import '../styles/diagnosis.css';

export default function IncidentDetail() {
  const { id = '' } = useParams();
  const inc = useApi('incident.get', { id }, [id]);
  const run = useApi('run.get', { incidentId: id }, [id]);

  useStream('run.progress', (r) => {
    if (r.incidentId !== id) return;
    run.set(r);
    if (isTerminal(r.state) || r.state === 'WAITING_FOR_REBOOT') void inc.reload();
  });

  const crumbs = incidentCrumbs(id);
  if (inc.error && !inc.data) {
    return (
      <Page crumbs={crumbs}>
        <ErrorState error={inc.error} onRetry={() => void inc.reload()} />
        <LinkButton to="/incidents" variant="ghost">Open the incident list</LinkButton>
      </Page>
    );
  }
  if (!inc.data || (run.loading && run.data === null && !run.error)) {
    return <Page crumbs={crumbs}><LoadingState label="Loading the incident…" /></Page>;
  }

  const i = inc.data;
  const props = { inc: i, run: run.data, reload: () => { void inc.reload(); } };
  if (i.status === 'partially_verified') return <PartlyFixed key={i.id} {...props} />;
  if (i.status === 'verified' || i.status === 'closed') return <ResolvedSummary key={i.id} {...props} />;
  if (i.type === 'pc' && i.timeline.length > 0) return <CrashDiagnosis key={i.id} {...props} />;
  return <DevDiagnosis key={i.id} {...props} />;
}
