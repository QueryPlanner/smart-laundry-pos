import { Fragment, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PicturePicker } from './PicturePicker';
import { saveCounterRateCard, type CounterCatalogue } from '@/lib/localFirst/counter';
import { pictureSrc } from '@/lib/localFirst/garmentPictures';
import { cellKey, draftFromCatalogue, isLocked, newRef, planRateCard, type DraftGarment, type DraftService, type RateCardDraft } from '@/lib/localFirst/rateCard';

interface Props {
  catalogue: CounterCatalogue;
  onCatalogue: (catalogue: CounterCatalogue) => void;
  onError: (error: unknown) => void;
  onNotice: (message: string) => void;
}

const changesText = (count: number) => `${count} ${count === 1 ? 'change' : 'changes'} not saved`;

/**
 * The whole rate card as one table: garments down, services (the sections of the New order screen)
 * across. The administrator types prices, renames, changes pictures, removes and adds garments and
 * services, and one Save button saves all of it together.
 */
export const RateCard = ({ catalogue, onCatalogue, onError, onNotice }: Props) => {
  const [draft, setDraft] = useState<RateCardDraft>(() => draftFromCatalogue(catalogue));
  const [picking, setPicking] = useState<string | null>(null);
  const [garmentName, setGarmentName] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [busy, setBusy] = useState(false);
  // A saved catalogue (or one reloaded elsewhere) starts a fresh draft.
  useEffect(() => { setDraft(draftFromCatalogue(catalogue)); setPicking(null); }, [catalogue]);

  const plan = planRateCard(catalogue, draft);
  const services = draft.services;
  const garment = (id: string, change: Partial<DraftGarment>) =>
    setDraft(d => ({ ...d, garments: d.garments.map(row => (row.id === id ? { ...row, ...change } : row)) }));
  const service = (id: string, change: Partial<DraftService>) =>
    setDraft(d => ({ ...d, services: d.services.map(row => (row.id === id ? { ...row, ...change } : row)) }));
  const setPrice = (key: string, text: string) => setDraft(d => ({ ...d, prices: { ...d.prices, [key]: text } }));

  const addGarment = () => {
    const id = newRef();
    setDraft(d => ({ ...d, garments: [...d.garments, { id, name: garmentName.trim(), nameMr: '', picture: null, pair: false, isNew: true, removed: false }] }));
    setGarmentName('');
    setPicking(id);
  };
  const addService = () => {
    setDraft(d => ({ ...d, services: [...d.services, { id: newRef(), key: '', name: serviceName.trim(), isNew: true, removed: false }] }));
    setServiceName('');
  };
  const save = async () => {
    setBusy(true);
    try {
      onCatalogue(await saveCounterRateCard(plan.changes));
      onNotice('Rate card saved. New orders use it now.');
    } catch (error) { onError(error); } finally { setBusy(false); }
  };
  const removedEarlier = [...catalogue.garments.filter(g => !g.active).map(g => g.nameEn), ...catalogue.services.filter(s => !s.active).map(s => s.name)];

  return <div className="counter-rates">
    <p className="counter-rate-warning">The starting prices are estimates. Check every price before using the app with customers.</p>
    <p>Type a price to sell a garment for a service. Leave the box empty or type 0 and it does not show on New order. Every name, including the built-in ones, can be changed here, with its Marathi name and picture. Nothing changes until you press <strong>Save</strong>.</p>
    <div className="counter-rate-table-wrap">
      <table className="counter-rate-table">
        <thead>
          <tr>
            <th scope="col">Garment</th>
            {services.map(s => <th scope="col" key={s.id} className={s.removed ? 'removed' : ''}>
              <div className="counter-rate-service">
                <Input aria-label={`Name of service ${s.name || 'new'}`} value={s.name} maxLength={30} disabled={s.removed} onChange={e => service(s.id, { name: e.target.value })} />
                <Button type="button" variant="outline" size="sm" onClick={() => service(s.id, { removed: !s.removed })}>{s.removed ? 'Keep' : 'Remove'}</Button>
              </div>
            </th>)}
            <th scope="col"><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {draft.garments.map(g => <Fragment key={g.id}>
            <tr className={g.removed ? 'removed' : ''}>
              <th scope="row">
                <div className="counter-rate-garment">
                  <button type="button" className="counter-rate-picture" aria-label={`Picture of ${g.name || 'new garment'}`} aria-expanded={picking === g.id} disabled={g.removed} onClick={() => setPicking(picking === g.id ? null : g.id)}>
                    {g.picture ? <img src={pictureSrc(g.picture)} alt="" /> : <span aria-hidden="true">{g.name.trim().charAt(0).toUpperCase()}</span>}
                  </button>
                  <div className="counter-rate-names">
                    <Input aria-label={`Name of garment ${g.name || 'new'}`} value={g.name} maxLength={40} disabled={g.removed} onChange={e => garment(g.id, { name: e.target.value })} />
                    <Input aria-label={`Marathi name of ${g.name || 'new garment'}`} lang="mr" placeholder="मराठी नाव" value={g.nameMr} maxLength={60} disabled={g.removed} onChange={e => garment(g.id, { nameMr: e.target.value })} />
                  </div>
                </div>
              </th>
              {services.map(s => {
                const key = cellKey(g.id, s.id);
                const locked = isLocked(g, s);
                return <td key={s.id}>
                  <Input aria-label={`${g.name} ${s.name} price`} type="text" inputMode="decimal" placeholder={locked ? 'No' : '—'} title={locked ? 'Shoes are not ironed' : undefined}
                    disabled={locked || g.removed || s.removed} value={locked ? '' : draft.prices[key] ?? ''} onChange={e => setPrice(key, e.target.value)} />
                </td>;
              })}
              <td><Button type="button" variant="outline" size="sm" onClick={() => { garment(g.id, { removed: !g.removed }); setPicking(null); }}>{g.removed ? 'Keep' : 'Remove'}</Button></td>
            </tr>
            {picking === g.id && <tr className="counter-rate-picking">
              <td colSpan={services.length + 2}>
                <PicturePicker value={g.picture} onChange={picture => garment(g.id, { picture })} />
                <Button type="button" variant="outline" size="sm" onClick={() => setPicking(null)}>Done</Button>
              </td>
            </tr>}
          </Fragment>)}
        </tbody>
      </table>
    </div>
    <div className="counter-rate-add">
      <form onSubmit={e => { e.preventDefault(); addGarment(); }}>
        <Label>New garment<Input value={garmentName} maxLength={40} placeholder="For example, Leather jacket" onChange={e => setGarmentName(e.target.value)} /></Label>
        <Button type="submit" variant="outline" disabled={!garmentName.trim()}>Add garment</Button>
      </form>
      <form onSubmit={e => { e.preventDefault(); addService(); }}>
        <Label>New service<Input value={serviceName} maxLength={30} placeholder="For example, Steam press" onChange={e => setServiceName(e.target.value)} /></Label>
        <Button type="submit" variant="outline" disabled={!serviceName.trim()}>Add service</Button>
      </form>
    </div>
    {removedEarlier.length > 0 && <p className="counter-summary-note">Removed earlier: {removedEarlier.join(', ')}. Add one again with the same name to bring it back with its prices.</p>}
    <div className="counter-rate-save">
      {plan.problem ? <span role="alert">{plan.problem}</span> : <span>{plan.count > 0 ? changesText(plan.count) : 'No changes'}</span>}
      <Button type="button" variant="outline" disabled={busy || (plan.count === 0 && !plan.problem)} onClick={() => { setDraft(draftFromCatalogue(catalogue)); setPicking(null); }}>Undo changes</Button>
      <Button type="button" disabled={busy || plan.count === 0 || plan.problem !== ''} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
    </div>
  </div>;
};
