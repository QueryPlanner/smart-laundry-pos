// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { BillPreview, type BillPreviewProps } from './BillPreview';
import type { BillPreviewData } from '@/lib/localFirst/counter';

const data = (pages = 1): BillPreviewData => ({
  widthPt: 595.28, heightPt: 419.53,
  pages: Array.from({ length: pages }, (_, index) => ({
    rules: [{ x1Pt: 24, x2Pt: 570, yPt: 100 + index }],
    lines: [
      { text: `SMART LAUNDRY ${index + 1}`, sizePt: 14, bold: true, xPt: 24, yPt: 30 },
      { text: 'Fixture Customer', sizePt: 10, bold: false, xPt: 24, yPt: 60 },
    ],
  })),
});
const renderPreview = (over: Partial<BillPreviewProps> = {}) => {
  const props: BillPreviewProps = { title: 'Bill preview', preview: data(), onClose: vi.fn(), ...over };
  render(<BillPreview {...props} />);
  return props;
};

afterEach(cleanup);

describe('BillPreview', () => {
  it('is a modal window titled for what it shows, with a note that paper can differ', () => {
    renderPreview({ title: 'Preview of bill 202610160003' });
    const dialog = screen.getByRole('dialog', { name: 'Preview of bill 202610160003' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByText(/Spacing on paper can differ a little/)).toBeTruthy();
  });

  it('draws every line and rule of every page at its position and size', () => {
    renderPreview({ preview: data(2) });
    const pages = screen.getAllByRole('group', { name: /Bill page/ });
    expect(pages.map(page => page.getAttribute('aria-label'))).toEqual(['Bill page 1 of 2', 'Bill page 2 of 2']);
    expect(pages[0].getAttribute('viewBox')).toBe('0 0 595.28 419.53');
    const title = within(pages[0]).getByText('SMART LAUNDRY 1');
    expect(title.getAttribute('font-size')).toBe('14');
    expect(title.getAttribute('font-weight')).toBe('700');
    expect(title.getAttribute('x')).toBe('24');
    // The layout gives the top of the text; SVG wants the baseline below it.
    expect(Number(title.getAttribute('y'))).toBeCloseTo(30 + 14 * 0.85);
    expect(within(pages[0]).getByText('Fixture Customer').getAttribute('font-weight')).toBe('400');
    expect(pages[1].querySelector('line')?.getAttribute('y1')).toBe('101');
    expect(within(pages[1]).getByText('SMART LAUNDRY 2')).toBeTruthy();
  });

  it('puts the focus on Close so Enter or Space closes it', () => {
    renderPreview();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('closes from the button, from Escape and from the backdrop, but not from a click inside', () => {
    const props = renderPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'a' });
    expect(props.onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('dialog'));
    expect(props.onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(props.onClose).toHaveBeenCalledTimes(3);
  });

  it('offers Print this bill only when it is given a way to print', () => {
    renderPreview();
    expect(screen.queryByRole('button', { name: 'Print this bill' })).toBeNull();
    cleanup();
    const onPrint = vi.fn();
    renderPreview({ onPrint });
    fireEvent.click(screen.getByRole('button', { name: 'Print this bill' }));
    expect(onPrint).toHaveBeenCalledTimes(1);
  });
});
