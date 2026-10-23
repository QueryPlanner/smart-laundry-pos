// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PicturePicker } from './PicturePicker';
import { GARMENT_PICTURES } from '@/lib/localFirst/garmentPictures';

afterEach(cleanup);

describe('PicturePicker', () => {
  it('offers no picture and every bundled picture, with the current one chosen', () => {
    render(<PicturePicker value="saree" onChange={vi.fn()} />);
    expect(screen.getAllByRole('radio')).toHaveLength(GARMENT_PICTURES.length + 1);
    expect((screen.getByLabelText('Saree') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText('Saree').closest('label')?.className).toBe('selected');
    expect(screen.getByLabelText('No picture').closest('label')?.className).toBe('');
    expect(screen.getByLabelText('Saree').closest('label')?.querySelector('img')?.getAttribute('src')).toBe('/garments/saree-transparent.png');
  });

  it('reports a picture, or none, when chosen', () => {
    const onChange = vi.fn();
    const view = render(<PicturePicker value={null} onChange={onChange} />);
    expect(screen.getByLabelText('No picture').closest('label')?.className).toBe('selected');
    fireEvent.click(screen.getByLabelText('Quilt / razai'));
    expect(onChange).toHaveBeenLastCalledWith('quilt');
    view.rerender(<PicturePicker value="quilt" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('No picture'));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
