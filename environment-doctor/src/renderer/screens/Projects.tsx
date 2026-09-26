/** Board 13 · Projects — what each project needs, checked against this PC. Unknown is never counted as met (UI rule 9). */
import { Link, useParams } from 'react-router-dom';
import type { CheckStatus, Project } from '../../shared/contracts';
import { Icon } from '../components/Icon';
import { Page } from '../components/Shell';
import { Card, EmptyState, ErrorState, LinkButton, LoadingState, ProgressRing, StatusChip, timeAgo } from '../components/ui';
import { useApi } from '../hooks/useApi';
import '../styles/library.css';

const PROJECT_STATUS: Record<CheckStatus, string> = { ok: 'Ready', warn: 'Attention', fail: 'Blocked', unknown: 'Unknown' };
const REQ_STATUS: Record<CheckStatus, string> = { ok: 'Ready', warn: 'Check', fail: 'Blocking', unknown: 'Unknown' };
const RING_COLOR: Record<CheckStatus, string> = { ok: 'var(--ok)', warn: 'var(--warn)', fail: 'var(--danger)', unknown: 'var(--muted)' };

function tipFor(p: Project): string {
  const failing = p.requirements.filter((r) => r.status === 'fail');
  const unknown = p.requirements.filter((r) => r.status === 'unknown');
  const warn = p.requirements.filter((r) => r.status === 'warn');
  const incidents = [...new Set(failing.map((r) => r.incidentId).filter(Boolean))];
  if (failing.length && incidents.length) return `A fix is waiting in ${incidents.join(' and ')}. After it’s verified, this project is checked again automatically.`;
  if (failing.length) return `${failing.length} requirement${failing.length === 1 ? '' : 's'} block${failing.length === 1 ? 's' : ''} this project. Run a scan after changing anything to check again.`;
  if (unknown.length) return `${unknown.length} check${unknown.length === 1 ? '' : 's'} couldn’t run, so ${unknown.length === 1 ? 'it’s' : 'they’re'} unknown — not broken. Start what’s missing and scan again for a complete answer.`;
  if (warn.length) return `${warn.length} item${warn.length === 1 ? ' needs' : 's need'} attention but ${warn.length === 1 ? 'doesn’t' : 'don’t'} block the project.`;
  return 'Everything this project needs is here and working.';
}

function Detail({ p }: { p: Project }) {
  const total = p.requirements.length;
  const met = p.requirements.filter((r) => r.status === 'ok').length;
  const unknown = p.requirements.filter((r) => r.status === 'unknown').length;
  const incidentIds = [...new Set(p.requirements.filter((r) => r.status !== 'ok').map((r) => r.incidentId).filter((x): x is string => !!x))];
  return (
    <section className="lib-main" aria-live="polite" aria-labelledby="proj-title">
      <Card>
        <div className="row gap-5 start">
          <ProgressRing value={total ? (met / total) * 100 : 0} size={76} stroke={6} color={RING_COLOR[p.status]} label={`${met} of ${total} requirements met`}>
            <span style={{ fontSize: 17 }}>{met}/{total}</span>
          </ProgressRing>
          <div className="col grow" style={{ gap: 6 }}>
            <div className="row gap-3 wrap"><h2 className="t-h2" id="proj-title" style={{ fontSize: 22 }}>{p.name}</h2><StatusChip status={p.status} label={PROJECT_STATUS[p.status]} /></div>
            <span className="mono t-small c-subtle">{p.path}</span>
            <span className="c-text2" style={{ fontSize: 13.5 }}>{p.summary}</span>
            <span className="t-small c-subtle">{p.stack} · checked {timeAgo(p.lastChecked)}{unknown > 0 ? ` · ${unknown} unknown, not counted as met` : ''}</span>
          </div>
          <div className="col gap-1" style={{ flexShrink: 0 }}>
            {incidentIds.map((id) => <LinkButton key={id} to={`/incidents/${encodeURIComponent(id)}`} size="sm" icon="arrowRight">Open {id}</LinkButton>)}
            <LinkButton to="/scan" size="sm" variant="ghost" icon="pulse">Check again</LinkButton>
          </div>
        </div>
      </Card>

      <Card className="lib-flush">
        <table className="table lib-table">
          <caption className="sr-only">Requirements for {p.name}</caption>
          <thead><tr><th scope="col" style={{ paddingLeft: 20 }}>Needs</th><th scope="col">Project wants</th><th scope="col">This PC has</th><th scope="col">Result</th><th scope="col" style={{ paddingRight: 20 }}>Source</th></tr></thead>
          <tbody>
            {p.requirements.map((r) => (
              <tr key={r.id}>
                <th scope="row" style={{ paddingLeft: 20, fontSize: 14 }}>{r.name}</th>
                <td className="mono c-muted" style={{ fontSize: 12.5 }}>{r.needs}</td>
                <td className="mono" style={{ fontSize: 12.5 }}>{r.have}</td>
                <td>
                  <span className="col" style={{ gap: 4, alignItems: 'flex-start' }}>
                    <StatusChip status={r.status} label={REQ_STATUS[r.status]} />
                    {r.incidentId && r.status !== 'ok' && <Link to={`/incidents/${encodeURIComponent(r.incidentId)}`} className="t-small">{r.incidentId}</Link>}
                  </span>
                </td>
                <td className="t-small c-subtle" style={{ paddingRight: 20 }}>{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="lib-callout accent"><Icon name="sparkle" size={16} /><span style={{ fontSize: 13 }}>{tipFor(p)}</span></div>
    </section>
  );
}

export default function Projects() {
  const { id } = useParams();
  const list = useApi('projects.list', undefined);
  const projects = list.data ?? [];
  const selected = id ? projects.find((p) => p.id === id) : projects[0];

  return (
    <Page crumbs={id ? [{ label: 'Projects', to: '/projects' }, { label: selected?.name ?? id }] : [{ label: 'Projects' }]} actions={<LinkButton to="/settings/diagnostics" size="sm" icon="plus">Add project folder</LinkButton>}>
      {list.loading && !list.data && <LoadingState label="Loading projects…" />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data && projects.length === 0 && (
        <Card>
          <h1 className="sr-only">Projects</h1>
          <EmptyState
            icon="folder" title="No projects yet"
            body={<>Add a project folder in Settings › Diagnostics, then run a scan. We read requirement files like package.json — never your code.</>}
            action={<div className="row gap-3"><LinkButton to="/settings/diagnostics" variant="primary" size="sm">Open Settings › Diagnostics</LinkButton><LinkButton to="/scan" size="sm">Run a scan</LinkButton></div>}
          />
        </Card>
      )}
      {projects.length > 0 && (
        <div className="lib-two">
          <nav className="lib-list" aria-label="Projects">
            <h1 className="t-h1">Projects</h1>
            <p className="c-muted" style={{ fontSize: 13.5, marginBottom: 8 }}>What each project needs, checked against this PC.</p>
            {projects.map((p) => (
              <Link key={p.id} to={`/projects/${encodeURIComponent(p.id)}`} className="lib-pick" aria-current={selected?.id === p.id ? 'page' : undefined}>
                <span className="col grow" style={{ gap: 3 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span><span className="t-small c-subtle">{p.stack}</span></span>
                <StatusChip status={p.status} label={PROJECT_STATUS[p.status]} />
              </Link>
            ))}
          </nav>
          {selected
            ? <Detail p={selected} />
            : <Card className="lib-main"><EmptyState icon="folder" title="That project isn’t here" body="It may have been removed from your project folders." action={<LinkButton to="/projects" size="sm">Show all projects</LinkButton>} /></Card>}
        </div>
      )}
    </Page>
  );
}
