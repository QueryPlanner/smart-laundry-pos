import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import type { BillPreviewData } from '@/lib/localFirst/counter';

/** Text is positioned by its top edge in the layout; SVG positions it by its baseline. */
const BASELINE_FROM_TOP = 0.85;

export interface BillPreviewProps {
  title: string;
  preview: BillPreviewData;
  onClose(): void;
  /** Offered for a saved order: print this bill again, then close. */
  onPrint?(): void;
}

/** The bill on screen, as it will print. A window over the page: Close or Escape returns to it. */
export const BillPreview = ({ title, preview, onClose, onPrint }: BillPreviewProps) => {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButton.current?.focus(); }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') onClose();
  };
  return (
    <div className="counter-modal-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="counter-modal" onClick={event => event.stopPropagation()} onKeyDown={onKeyDown}>
        <header>
          <h2>{title}</h2>
          <p>This is how the bill will print. Spacing on paper can differ a little.</p>
        </header>
        <div className="counter-modal-body">
          {preview.pages.map((page, index) => (
            <svg key={index} className="counter-bill-page" viewBox={`0 0 ${preview.widthPt} ${preview.heightPt}`} role="group" aria-label={`Bill page ${index + 1} of ${preview.pages.length}`}>
              <rect width={preview.widthPt} height={preview.heightPt} fill="#ffffff" stroke="#c9d6cf" />
              {page.rules.map((rule, ruleIndex) => (
                <line key={ruleIndex} x1={rule.x1Pt} x2={rule.x2Pt} y1={rule.yPt} y2={rule.yPt} stroke="#222222" strokeWidth={0.5} />
              ))}
              {page.lines.map((line, lineIndex) => (
                <text key={lineIndex} x={line.xPt} y={line.yPt + line.sizePt * BASELINE_FROM_TOP} fontSize={line.sizePt} fontWeight={line.bold ? 700 : 400} fontFamily="'Segoe UI', Arial, sans-serif" fill="#111111">{line.text}</text>
              ))}
            </svg>
          ))}
        </div>
        <footer>
          {onPrint && <Button className="counter-touch" onClick={onPrint}>Print this bill</Button>}
          <Button ref={closeButton} variant="outline" className="counter-touch" onClick={onClose}>Close</Button>
        </footer>
      </div>
    </div>
  );
};
