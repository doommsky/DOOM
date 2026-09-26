// @vitest-environment node
/** Pure parts of the live engine: version ranges, PATH analysis, redaction (spec §11). */
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { analysePath, redact, satisfies, secretEnvNames } from '../../src/engine/live/collectors';

describe('live collectors', () => {
  it('satisfies common version ranges and returns undefined when unsure', () => {
    expect(satisfies('v20.17.0', '>=20')).toBe(true);
    expect(satisfies('18.20.4', '>=20')).toBe(false);
    expect(satisfies('22.1.0', '^22')).toBe(true);
    expect(satisfies('23.0.0', '^22')).toBe(false);
    expect(satisfies('3.12.7', '>=3.12')).toBe(true);
    expect(satisfies('3.11.2', '3.12')).toBe(false);
    expect(satisfies('20.1.0', 'lts/*')).toBeUndefined();
    expect(satisfies(undefined, '>=20')).toBeUndefined();
  });

  it('finds missing and duplicate PATH folders', () => {
    const tmp = os.tmpdir();
    const r = analysePath([{ dir: tmp, scope: 'user' }, { dir: '/definitely/not/here-ed', scope: 'user' }, { dir: tmp + '/', scope: 'user' }]);
    expect(r[0]).toMatchObject({ exists: true, dup: false });
    expect(r[1]).toMatchObject({ exists: false });
    expect(r[2]).toMatchObject({ dup: true });
  });

  it('redacts home folder, user name, host name and token-shaped strings', () => {
    const s = redact(`${os.homedir()}/x token ghp_abcdefghijklmnop1234 on ${os.hostname()}`);
    expect(s).not.toContain(os.homedir());
    expect(s).toContain('[secret removed]');
    if (os.hostname().length > 2) expect(s).not.toContain(os.hostname());
  });

  it('reports secret-looking env var names only', () => {
    process.env.ED_TEST_API_KEY = 'sk-should-never-appear-1234567890';
    const names = secretEnvNames();
    expect(names).toContain('ED_TEST_API_KEY');
    expect(JSON.stringify(names)).not.toContain('sk-should-never-appear');
    delete process.env.ED_TEST_API_KEY;
  });
});
