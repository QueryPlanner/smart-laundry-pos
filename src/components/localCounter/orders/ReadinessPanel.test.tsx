// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReadinessPanel } from './ReadinessPanel';

afterEach(cleanup);

describe('ReadinessPanel', () => {
  it('lists each blocker as an unchecked item and does not claim readiness', () => {
    render(<ReadinessPanel ready={false} blockers={['₹700.00 still to receive', '2 garments not checked']} />);
    const items = screen.getAllByRole('listitem').map(item => item.textContent);
    expect(items).toEqual(['₹700.00 still to receive', '2 garments not checked']);
    expect(screen.queryByText('Everything is ready')).toBeNull();
  });

  it('confirms that everything is ready and lists nothing', () => {
    render(<ReadinessPanel ready blockers={[]} />);
    expect(screen.getByRole('status').textContent).toBe('Everything is ready');
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});
