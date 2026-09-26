/** Board 04 · Command palette (Ctrl K): search, run, or turn free text into a diagnosis. Combobox + listbox pattern. */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CommandEntry } from '../../shared/contracts';
import { useApp } from '../AppContext';
import { useApi } from '../hooks/useApi';
import { Icon, type IconName } from './Icon';
import { Dialog, Kbd } from './ui';
import '../styles/start.css';

type Group = CommandEntry['group'];
const GROUP_ORDER: Group[] = ['Run', 'Incidents', 'Go to', 'Diagnose'];
const GROUP_ICON: Record<Group, { icon: IconName; tone: string }> = {
  Run: { icon: 'bolt', tone: 'accent' }, Incidents: { icon: 'alert', tone: 'danger' }, 'Go to': { icon: 'arrowRight', tone: '' }, Diagnose: { icon: 'sparkle', tone: 'accent' },
};

/** Extra words people type for a command (matched, never shown). */
const KEYWORDS: Record<string, string> = {
  'run-scan': 'scan check health read-only',
  'run-describe': 'diagnose problem ask broken error issue help',
  'run-setup': 'setup install provision blueprint dry run',
  'go-home': 'home overview dashboard health pillars',
  'go-incidents': 'incidents problems issues list',
  'go-evidence': 'evidence vault logs',
  'go-projects': 'projects requirements',
  'go-actions': 'safe actions catalog',
  'go-history': 'history audit log timeline',
  'go-settings': 'settings preferences options',
  'go-privacy': 'privacy ai cloud redaction',
};

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

function isSubsequence(t: string, w: string) {
  let i = 0;
  for (const ch of w) if (ch === t[i]) i++;
  return i === t.length;
}

/** Fuzzy-ish: every typed word must hit the label, the hint/keywords, or be an abbreviation of one word (“sttngs”). */
function score(c: CommandEntry, tokens: string[]): number | null {
  const label = norm(c.label);
  const hay = norm([c.label, c.hint, c.group, KEYWORDS[c.id] ?? ''].join(' '));
  const words = hay.split(/[^a-z0-9]+/).filter(Boolean);
  let s = 0;
  for (const t of tokens) {
    if (label.startsWith(t)) s += 4;
    else if (label.includes(t)) s += 3;
    else if (hay.includes(t)) s += 2;
    else if (t.length >= 3 && words.some((w) => w[0] === t[0] && isSubsequence(t, w))) s += 1;
    else return null;
  }
  return s;
}

interface Option { key: string; label: string; hint: string; group: Group; route: string; diagnose?: boolean }

export function CommandPalette() {
  const { paletteOpen } = useApp();
  return paletteOpen ? <Palette /> : null;
}

function Palette() {
  const { closePalette } = useApp();
  const closeRef = useRef(closePalette);
  closeRef.current = closePalette;
  const onClose = useCallback(() => closeRef.current(), []);
  const nav = useNavigate();
  const cmds = useApi('palette.commands', undefined);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const base = useId();
  const listId = `${base}-list`;
  const inputId = `${base}-input`;
  const optId = (i: number) => `${base}-opt-${i}`;

  const { groups, flat } = useMemo(() => {
    const query = q.trim();
    const tokens = norm(query).split(/\s+/).filter(Boolean);
    const scored = (cmds.data ?? [])
      .map((c, i) => ({ c, i, s: tokens.length ? score(c, tokens) : 0 }))
      .filter((x): x is { c: CommandEntry; i: number; s: number } => x.s !== null);
    const grouped = GROUP_ORDER.map((g) => ({
      name: g,
      items: scored.filter((x) => x.c.group === g).sort((a, b) => b.s - a.s || a.i - b.i)
        .map(({ c }): Option => ({ key: c.id, label: c.label, hint: c.hint, group: c.group, route: c.route })),
    })).filter((g) => g.items.length > 0);
    const anyHit = grouped.length > 0;
    // Free text always has a way forward: offer it as a diagnosis, last (Handoff nav rule, AC-04).
    if (query) {
      grouped.push({ name: 'Diagnose', items: [{
        key: 'diagnose', diagnose: true, group: 'Diagnose', label: `Diagnose: “${query}”`,
        hint: anyHit ? 'Start a diagnosis with this description' : 'No direct match — start a diagnosis with this description',
        route: `/diagnose?q=${encodeURIComponent(query)}`,
      }] });
    }
    return { groups: grouped, flat: grouped.flatMap((g) => g.items) };
  }, [cmds.data, q]);

  const current = Math.min(active, Math.max(0, flat.length - 1));

  useEffect(() => {
    if (flat.length) document.getElementById(optId(current))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, flat.length]);

  const choose = (o: Option | undefined) => {
    if (!o) return;
    closeRef.current();
    nav(o.route);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!flat.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((current + 1) % flat.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((current - 1 + flat.length) % flat.length); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(flat[current]); }
  };

  let idx = -1;
  return (
    <Dialog label="Search or run" onClose={onClose} width={700}>
      <div className="pal-input-row">
        <Icon name="search" size={18} />
        <label htmlFor={inputId} className="sr-only">Search or run a command</label>
        <input
          id={inputId} className="pal-input" type="text" role="combobox" autoComplete="off" spellCheck={false}
          aria-expanded={flat.length > 0} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={flat.length ? optId(current) : undefined}
          placeholder="Search, or describe a problem…" value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKeyDown}
        />
        <Kbd>Esc</Kbd>
      </div>
      <ul className="pal-list" role="listbox" id={listId} aria-label="Results">
        {cmds.loading && !cmds.data && <li role="presentation" className="t-small c-subtle" style={{ padding: 12 }}>Loading commands…</li>}
        {cmds.error && <li role="presentation" className="t-small c-warn" style={{ padding: 12 }}>Commands couldn’t load. You can still describe a problem.</li>}
        {!q.trim() && !cmds.loading && flat.length === 0 && <li role="presentation" className="t-small c-subtle" style={{ padding: 12 }}>Type to search, or describe what’s wrong.</li>}
        {groups.map((g) => {
          const gid = `${base}-g-${g.name.replace(/\s+/g, '')}`;
          const gi = GROUP_ICON[g.name];
          return (
            <li key={g.name} role="presentation">
              <div id={gid} role="presentation" className="t-overline pal-group-label">{g.name}</div>
              <ul role="group" aria-labelledby={gid} className="pal-group">
                {g.items.map((o) => {
                  idx++;
                  const i = idx;
                  const sel = i === current;
                  return (
                    <li
                      key={o.key} id={optId(i)} role="option" aria-selected={sel} className={`pal-option ${o.diagnose ? 'diagnose' : ''}`}
                      onMouseMove={() => { if (!sel) setActive(i); }} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}
                    >
                      <span className={`pal-dot ${gi.tone}`} aria-hidden="true"><Icon name={gi.icon} size={14} /></span>
                      {o.diagnose
                        ? <span className="col grow" style={{ gap: 2 }}><span style={{ fontSize: 14 }}>{o.label}</span><span className="hint">{o.hint}</span></span>
                        : <><span className="grow" style={{ fontSize: 14 }}>{o.label}</span><span className="hint">{o.hint}</span></>}
                      {sel && <Kbd>Enter</Kbd>}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
      <div className="pal-foot">
        <span><Kbd>↑↓</Kbd>move</span>
        <span><Kbd>Enter</Kbd>open</span>
        <span className="grow" />
        <span>Nothing here changes your PC without an approval</span>
      </div>
    </Dialog>
  );
}
