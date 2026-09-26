/** Component library (board 24) + design-system gallery accessibility (WCAG 2.2 AA via axe-core). */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import axe from 'axe-core';
import type { Confidence } from '../../src/shared/contracts';
import { AppProvider } from '../../src/renderer/AppContext';
import DesignSystem from '../../src/renderer/screens/DesignSystem';
import { ConfidenceMeter, SegmentedControl, Toggle } from '../../src/renderer/components/ui';

describe('Design system gallery', () => {
  it('renders every component and state with no axe violations', async () => {
    const { container } = render(
      <AppProvider>
        <MemoryRouter initialEntries={['/design']}>
          <DesignSystem />
        </MemoryRouter>
      </AppProvider>,
    );
    await screen.findByRole('heading', { name: 'Design system', level: 1 });
    expect(screen.getByRole('heading', { name: 'Design tokens' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Component library' })).toBeInTheDocument();
    expect(screen.getByText('This approval ran out · Nothing ran')).toBeInTheDocument();
    expect(screen.getByText('Queued behind INC-0043')).toBeInTheDocument();
    // jsdom has no layout, so colour contrast is checked in the real app instead.
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    const report = res.violations.map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    expect(report).toEqual([]);
  });
});

describe('ConfidenceMeter', () => {
  it('shows a label and never a percentage', () => {
    const values: Confidence[] = ['confirmed', 'high', 'medium', 'low', 'unknown'];
    const { container } = render(<div>{values.map((v) => <ConfidenceMeter key={v} value={v} />)}{values.map((v) => <ConfidenceMeter key={'h' + v} value={v} showLabel={false} />)}</div>);
    expect(container.textContent).not.toContain('%');
    expect(container.innerHTML).not.toMatch(/\d+\s*%/);
    for (const label of ['Confirmed', 'High', 'Medium', 'Low', 'Unknown']) expect(screen.getAllByText(label).length).toBe(2);
  });
});

describe('Toggle', () => {
  it('a locked toggle never calls onChange — by click or keyboard', async () => {
    const onChange = vi.fn();
    render(<Toggle checked locked lockedReason="Always on" label="Never collect secrets" onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Never collect secrets' });
    expect(sw).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(sw);
    const user = userEvent.setup();
    sw.focus();
    await user.keyboard(' ');
    await user.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('a normal toggle flips with the keyboard', async () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} label="Scan on start" onChange={onChange} />);
    screen.getByRole('switch', { name: 'Scan on start' }).focus();
    await userEvent.setup().keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('SegmentedControl', () => {
  function Harness({ role }: { role?: 'tablist' | 'radiogroup' }) {
    const [v, setV] = useState<'a' | 'b' | 'c'>('a');
    return <SegmentedControl role={role} label="Example" value={v} onChange={setV} options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma' }]} />;
  }

  it('arrow keys move selection and focus, wrapping at the ends (tabs)', () => {
    render(<Harness />);
    const tab = (name: string) => screen.getByRole('tab', { name });
    expect(tab('Alpha')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Alpha')).toHaveAttribute('tabindex', '0');
    expect(tab('Beta')).toHaveAttribute('tabindex', '-1');
    tab('Alpha').focus();
    fireEvent.keyDown(tab('Alpha'), { key: 'ArrowRight' });
    expect(tab('Beta')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Beta')).toHaveFocus();
    fireEvent.keyDown(tab('Beta'), { key: 'ArrowRight' });
    fireEvent.keyDown(tab('Gamma'), { key: 'ArrowRight' });
    expect(tab('Alpha')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Alpha')).toHaveFocus();
    fireEvent.keyDown(tab('Alpha'), { key: 'ArrowLeft' });
    expect(tab('Gamma')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Gamma')).toHaveFocus();
  });

  it('radiogroup variant uses aria-checked', () => {
    render(<Harness role="radiogroup" />);
    const r = (name: string) => screen.getByRole('radio', { name });
    expect(screen.getByRole('radiogroup', { name: 'Example' })).toBeInTheDocument();
    fireEvent.keyDown(r('Alpha'), { key: 'ArrowLeft' });
    expect(r('Gamma')).toHaveAttribute('aria-checked', 'true');
    expect(r('Alpha')).toHaveAttribute('aria-checked', 'false');
  });
});
