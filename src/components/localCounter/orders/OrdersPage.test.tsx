// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { OrdersPage, type OrdersPageProps } from './OrdersPage';
import { countsOf, orderOf } from './listFixtures';

const SEARCH_LABEL = 'Search bill number, phone, name or tag ID';

const defaultProps = (): OrdersPageProps => ({
  query: '', onQuery: vi.fn(), segment: 'all', onSegment: vi.fn(), counts: countsOf(), results: [], loading: false,
  hasMore: false, onLoadMore: vi.fn(), onOpen: vi.fn(), onHandover: vi.fn(), busy: false,
});
const renderPage = (overrides: Partial<OrdersPageProps> = {}) => {
  const props = { ...defaultProps(), ...overrides };
  render(<OrdersPage {...props} />);
  return props;
};
const search = () => screen.getByLabelText(SEARCH_LABEL) as HTMLInputElement;
const pressEnter = () => fireEvent.keyDown(search(), { key: 'Enter' });
const segmentGroup = () => screen.queryByRole('group', { name: 'Order filters' });

afterEach(cleanup);

describe('OrdersPage', () => {
  describe('header and to-collect card', () => {
    it('shows the title and the money still to collect with its order count', () => {
      renderPage();
      expect(screen.getByRole('heading', { name: 'Orders / Pickup' })).toBeTruthy();
      expect(screen.getByText('To collect')).toBeTruthy();
      expect(screen.getByText('₹450.00')).toBeTruthy();
      expect(screen.getByText('4 orders')).toBeTruthy();
    });

    it('uses the singular for one order that owes money', () => {
      renderPage({ counts: countsOf({ balanceDue: 1 }) });
      expect(screen.getByText('1 order')).toBeTruthy();
    });

    it('warns only when money is owed', () => {
      const { unmount } = render(<OrdersPage {...defaultProps()} counts={countsOf({ balanceDue: 0, balanceDueMinor: 0 })} />);
      expect(screen.getByText('To collect').closest('.counter-stat')?.className).not.toContain('warn');
      unmount();
      renderPage();
      expect(screen.getByText('To collect').closest('.counter-stat')?.className).toContain('warn');
    });

    it('shows a dash while the counts are not known yet', () => {
      renderPage({ counts: null });
      expect(screen.getByText('—')).toBeTruthy();
      expect(screen.queryByText(/orders?$/)).toBeNull();
    });
  });

  describe('search box', () => {
    it('is focused on open, labelled and given an example placeholder', () => {
      renderPage();
      expect(document.activeElement).toBe(search());
      expect(search().getAttribute('placeholder')).toBe('Bill no., last 4 digits, phone or name');
    });

    it('passes every change to onQuery', () => {
      const props = renderPage();
      fireEvent.change(search(), { target: { value: 'RAH' } });
      expect(props.onQuery).toHaveBeenCalledWith('RAH');
    });

    it('replaces the segment bar with search mode, and Clear empties the search', () => {
      const props = renderPage({ query: 'RAH' });
      expect(segmentGroup()).toBeNull();
      expect(screen.getByText('Searching all orders')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      expect(props.onQuery).toHaveBeenCalledWith('');
    });

    it('brings the segment bar back when the search is empty', () => {
      renderPage();
      expect(segmentGroup()).toBeTruthy();
      expect(screen.queryByText('Searching all orders')).toBeNull();
    });

    it('asks for two characters and shows no results for a single character', () => {
      renderPage({ query: 'R', results: [orderOf()], hasMore: true });
      expect(screen.getByText('Type at least 2 characters.')).toBeTruthy();
      expect(screen.queryByRole('list', { name: 'Orders' })).toBeNull();
      expect(screen.queryByText('No order matches. Check the number or search by phone.')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });

    it('says when no order matches the search', () => {
      renderPage({ query: 'zzz', results: [] });
      expect(screen.getByText('No order matches. Check the number or search by phone.')).toBeTruthy();
    });
  });

  describe('Enter in the search box', () => {
    it('opens the hand-over screen when the one result is ready', () => {
      const props = renderPage({ query: '2610', results: [orderOf({ status: 'ready' })] });
      pressEnter();
      expect(props.onHandover).toHaveBeenCalledWith('o1');
      expect(props.onOpen).not.toHaveBeenCalled();
    });

    it('opens the order when the one result is not ready', () => {
      const props = renderPage({ query: '2610', results: [orderOf({ status: 'washing' })] });
      pressEnter();
      expect(props.onOpen).toHaveBeenCalledWith('o1');
      expect(props.onHandover).not.toHaveBeenCalled();
    });

    it('does nothing when there are no results', () => {
      const props = renderPage({ query: 'zzz', results: [] });
      pressEnter();
      expect(props.onOpen).not.toHaveBeenCalled();
      expect(props.onHandover).not.toHaveBeenCalled();
    });

    it('does nothing when several orders match', () => {
      const props = renderPage({ query: 'Rahul', results: [orderOf({ id: 'o1' }), orderOf({ id: 'o2', status: 'ready' })] });
      pressEnter();
      expect(props.onOpen).not.toHaveBeenCalled();
      expect(props.onHandover).not.toHaveBeenCalled();
    });

    it('does nothing for a single character, even if a result is passed in', () => {
      const props = renderPage({ query: 'R', results: [orderOf({ status: 'ready' })] });
      pressEnter();
      expect(props.onHandover).not.toHaveBeenCalled();
      expect(props.onOpen).not.toHaveBeenCalled();
    });

    it('does nothing while another action is busy', () => {
      const props = renderPage({ query: '2610', results: [orderOf()], busy: true });
      pressEnter();
      expect(props.onOpen).not.toHaveBeenCalled();
    });

    it('ignores keys other than Enter', () => {
      const props = renderPage({ query: '2610', results: [orderOf()] });
      fireEvent.keyDown(search(), { key: 'a' });
      expect(props.onOpen).not.toHaveBeenCalled();
    });
  });

  describe('segments', () => {
    it('reports the segment the operator picks', () => {
      const props = renderPage();
      fireEvent.click(within(segmentGroup() as HTMLElement).getByRole('button', { name: 'Overdue 1' }));
      expect(props.onSegment).toHaveBeenCalledWith('overdue');
    });

    it.each([
      ['ready', 'Nothing is ready for pickup.'],
      ['balance_due', 'No balances to collect.'],
      ['overdue', 'No overdue orders.'],
      ['in_process', 'Nothing is in process.'],
      ['today', 'No orders received today.'],
      ['all', 'No orders yet.'],
    ] as const)('explains an empty %s segment', (segment, message) => {
      renderPage({ segment });
      expect(screen.getByText(message)).toBeTruthy();
    });
  });

  describe('results', () => {
    it('lists each order', () => {
      renderPage({ results: [orderOf({ id: 'o1', customerName: 'Rahul Patil' }), orderOf({ id: 'o2', customerName: 'Priya Shah', orderNumber: '202610170002' })] });
      const list = screen.getByRole('list', { name: 'Orders' });
      expect(within(list).getAllByRole('listitem')).toHaveLength(2);
      expect(screen.getByText('Priya Shah')).toBeTruthy();
      expect(screen.queryByText('No orders yet.')).toBeNull();
    });

    it('disables the row buttons while busy', () => {
      renderPage({ results: [orderOf()], busy: true });
      expect((screen.getByRole('button', { name: 'Open' }) as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe('loading and paging', () => {
    it('shows a loading line instead of an empty message', () => {
      renderPage({ loading: true, segment: 'ready' });
      expect(screen.getByRole('status').textContent).toBe('Loading orders…');
      expect(screen.queryByText('Nothing is ready for pickup.')).toBeNull();
    });

    it('offers Load more when there are more results and calls onLoadMore', () => {
      const props = renderPage({ results: [orderOf()], hasMore: true });
      const button = screen.getByRole('button', { name: 'Load more' }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      expect(props.onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('hides Load more when there are no more results', () => {
      renderPage({ results: [orderOf()], hasMore: false });
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });

    it.each([
      { busy: true, loading: false },
      { busy: false, loading: true },
    ])('disables Load more while busy=$busy loading=$loading', ({ busy, loading }) => {
      renderPage({ results: [orderOf()], hasMore: true, busy, loading });
      expect((screen.getByRole('button', { name: 'Load more' }) as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
