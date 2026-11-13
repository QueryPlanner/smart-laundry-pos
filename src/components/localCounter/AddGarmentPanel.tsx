import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { pictureSrc } from '@/lib/localFirst/garmentPictures';
import { PicturePicker } from './PicturePicker';

interface Props {
  open: boolean;
  /** Names already on the rate card; a duplicate is refused before a draft row is made. */
  existingNames: string[];
  onAdd: (garment: { name: string; picture: string | null }) => void;
  onClose: () => void;
}

const tidy = (name: string) => name.split(/\s+/).filter(Boolean).join(' ');

/**
 * The Add garment form as a side panel. It only holds the form: Cancel, Close and Escape throw the
 * typed name and picture away and leave every earlier rate card edit in the draft. Adding appends
 * one draft row for the administrator to price before the page-level Save.
 */
export const AddGarmentPanel = ({ open, existingNames, onAdd, onClose }: Props) => {
  const [name, setName] = useState('');
  const [picture, setPicture] = useState<string | null>(null);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  // Each opening starts a fresh form, and focus moves into the panel.
  useEffect(() => {
    if (!open) return;
    setName(''); setPicture(null); setError('');
    nameRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, onClose]);

  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleaned = tidy(name);
    if (!cleaned) { setError('Give the garment a name.'); return; }
    if (existingNames.some(existing => existing.toLowerCase() === cleaned.toLowerCase())) {
      setError(`A garment called ${cleaned} already exists.`);
      return;
    }
    onAdd({ name: cleaned, picture });
  };

  return <>
    <div className="counter-side-panel-backdrop" aria-hidden="true" onClick={onClose} />
    <aside className="counter-side-panel" role="dialog" aria-modal="true" aria-labelledby="add-garment-title">
      <form onSubmit={submit}>
        <header>
          <h2 id="add-garment-title">Add garment</h2>
          <Button type="button" variant="outline" size="sm" aria-label="Close panel" onClick={onClose}><X className="h-4 w-4" /></Button>
        </header>
        <Label>Name<Input ref={nameRef} value={name} maxLength={40} placeholder="For example, Leather jacket" onChange={event => { setName(event.target.value); setError(''); }} /></Label>
        <div className="counter-side-panel-preview" aria-hidden="true">
          {picture ? <img src={pictureSrc(picture)} alt="" /> : <span className="counter-picture-none" />}
          <span>{picture ? 'Picture chosen' : 'No picture chosen'}</span>
        </div>
        <PicturePicker name="new-garment-picture" value={picture} onChange={setPicture} />
        {error && <p role="alert" className="counter-side-panel-error">{error}</p>}
        <div className="counter-side-panel-actions">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit">Add to rate card</Button>
        </div>
      </form>
    </aside>
  </>;
};
