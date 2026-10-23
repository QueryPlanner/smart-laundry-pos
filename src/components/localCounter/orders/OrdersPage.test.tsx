// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { OrdersPage, type OrdersPageProps } from './OrdersPage';
import { countsOf, orderOf } from './listFixtures';

const props = (over: Partial<OrdersPageProps> = {}): OrdersPageProps => ({
  query: '', onQuery: vi.fn(), segment: 'open', onSegment: vi.fn(), today: '2026-10-18', counts: countsOf(),
  results: [orderOf()], loading: false, hasMore: false, onLoadMore: vi.fn(), isAdmin: true,
  onOpen: vi.fn(), onCustomer: vi.fn(), onPreviewBill: vi.fn(), onTrash: vi.fn(), onRequestTrash: vi.fn(), busy: false, ...over,
});
const search = () => screen.getByLabelText('Search bill number, phone, name or tag ID') as HTMLInputElement;
const tabs = () => within(screen.getByRole('group', { name: 'Which orders' }));
afterEach(cleanup);

describe('OrdersPage', () => {
  it('lists the orders newest first under a heading for each day', () => {
    render(<OrdersPage {...props({ results: [orderOf({ id: 'a', receivedAt: '2026-10-18T05:00:00Z' }), orderOf({ id: 'b', receivedAt: '2026-10-17T05:00:00Z' }), orderOf({ id: 'c', receivedAt: '2026-10-10T05:00:00Z' })] })} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)).toEqual(['Today', 'Yesterday', '10 Oct 2026']);
  });

  it('shows the three tabs with their counts and reports the one picked', () => {
    const p = props();
    render(<OrdersPage {...p} />);
    expect(tabs().getAllByRole('button').map(button => button.textContent)).toEqual(['Not collected7', 'Collected5', 'All12']);
    expect(tabs().getByRole('button', { name: /Not collected/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(tabs().getByRole('button', { name: /^Collected/ }));
    expect(p.onSegment).toHaveBeenCalledWith('collected');
  });

  it('shows the tabs without counts until they arrive', () => {
    render(<OrdersPage {...props({ counts: null })} />);
    expect(tabs().getAllByRole('button').map(button => button.textContent)).toEqual(['Not collected', 'Collected', 'All']);
  });

  it.each([
    ['open', 'Every order has been collected.'],
    ['collected', 'No order has been collected yet.'],
    ['all', 'No orders yet.'],
  ] as const)('says when the %s tab is empty', (segment, words) => {
    render(<OrdersPage {...props({ segment, results: [] })} />);
    expect(screen.getByText(words)).toBeTruthy();
  });

  it('passes the row actions through', () => {
    const p = props();
    render(<OrdersPage {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open bill 202610170001' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rahul Patil' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm move to trash' }));
    expect(p.onOpen).toHaveBeenCalledWith('o1');
    expect(p.onCustomer).toHaveBeenCalledWith('9876543210');
    expect(p.onPreviewBill).toHaveBeenCalledWith('o1', '202610170001');
    expect(p.onTrash).toHaveBeenCalledWith('o1', '202610170001');
  });

  describe('searching', () => {
    it('passes every change on, and replaces the tabs with a Clear button', () => {
      const p = props({ query: 'rah' });
      render(<OrdersPage {...p} />);
      fireEvent.change(search(), { target: { value: 'rahu' } });
      expect(p.onQuery).toHaveBeenCalledWith('rahu');
      expect(screen.queryByRole('group', { name: 'Which orders' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      expect(p.onQuery).toHaveBeenLastCalledWith('');
    });

    it('asks for two characters and shows nothing for one', () => {
      render(<OrdersPage {...props({ query: 'r', hasMore: true })} />);
      expect(screen.getByText('Type at least 2 characters.')).toBeTruthy();
      expect(screen.queryByRole('list', { name: 'Orders' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });

    it('says when nothing matches', () => {
      render(<OrdersPage {...props({ query: '1234', results: [] })} />);
      expect(screen.getByText('No order matches. Check the number or search by phone.')).toBeTruthy();
    });

    it('opens the one order found with Enter, and nothing otherwise', () => {
      const p = props({ query: '0001' });
      const view = render(<OrdersPage {...p} />);
      fireEvent.keyDown(search(), { key: 'a' });
      expect(p.onOpen).not.toHaveBeenCalled();
      fireEvent.keyDown(search(), { key: 'Enter' });
      expect(p.onOpen).toHaveBeenCalledWith('o1');
      for (const over of [{ results: [] }, { results: [orderOf(), orderOf({ id: 'o2' })] }, { busy: true }]) {
        p.onOpen = vi.fn();
        view.rerender(<OrdersPage {...p} {...over} />);
        fireEvent.keyDown(search(), { key: 'Enter' });
        expect(p.onOpen).not.toHaveBeenCalled();
      }
    });
  });

  it('shows loading, and a Load more button that is locked while busy', () => {
    const p = props({ loading: true, hasMore: true });
    const view = render(<OrdersPage {...p} />);
    expect(screen.getByRole('status').textContent).toBe('Loading orders…');
    expect((screen.getByRole('button', { name: 'Load more' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<OrdersPage {...p} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(p.onLoadMore).toHaveBeenCalledOnce();
  });
});
