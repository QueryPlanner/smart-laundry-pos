import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getCounterBackupSettings, runCounterBackup, setCounterBackupMirror, type CounterBackupSettings } from '@/lib/localFirst/counter';

interface Props { onError: (error: unknown) => void; onNotice: (message: string) => void }

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const when = (iso: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

/** Admin-only backup status, a "back up now" action and the optional second backup folder (for example a USB drive). */
export const CounterBackups = ({ onError, onNotice }: Props) => {
  const [settings, setSettings] = useState<CounterBackupSettings | null>(null);
  const [mirror, setMirror] = useState('');
  const [busy, setBusy] = useState(false);

  const show = useCallback((next: CounterBackupSettings) => { setSettings(next); setMirror(next.mirrorDir ?? ''); }, []);
  useEffect(() => { void getCounterBackupSettings().then(show).catch(onError); }, [show, onError]);

  const backupNow = async () => {
    setBusy(true);
    try { show(await runCounterBackup()); onNotice('Backup saved.'); } catch (error) { onError(error); } finally { setBusy(false); }
  };
  const saveMirror = async () => {
    setBusy(true);
    try {
      await setCounterBackupMirror(mirror.trim() === '' ? null : mirror);
      show(await getCounterBackupSettings());
      onNotice(mirror.trim() === '' ? 'Second backup folder cleared.' : 'Second backup folder saved. It receives every new backup.');
    } catch (error) { onError(error); } finally { setBusy(false); }
  };

  const last = settings?.lastBackupAt ?? null;
  const stale = last === null || Date.now() - new Date(last).getTime() > STALE_AFTER_MS;
  const mirrorFailed = settings?.mirrorStatus?.startsWith('failed') ?? false;
  return (
    <div className="counter-backups">
      <p>A backup is saved every time the app starts and every few hours while it is open. Keeping a second copy on a USB drive protects against a failed computer.</p>
      {settings && <>
        <p>Backups on this computer: <code>{settings.folder}</code></p>
        <p role={stale ? 'alert' : undefined}>{last ? `Last backup: ${when(last)}${stale ? ' — more than a day ago. Press "Back up now" and check for errors.' : ''}` : 'No backup has been recorded yet. Press "Back up now".'}</p>
      </>}
      <Button disabled={busy} onClick={() => void backupNow()}>Back up now</Button>
      <Label htmlFor="backup-mirror">Second backup folder (optional)
        <Input id="backup-mirror" value={mirror} onChange={event => setMirror(event.target.value)} placeholder="E:\Laundry backups" />
      </Label>
      <Button variant="outline" disabled={busy} onClick={() => void saveMirror()}>Save second backup folder</Button>
      {settings?.mirrorDir && <p role={mirrorFailed ? 'alert' : undefined}>{mirrorFailed ? `The last copy to the second folder failed: ${settings.mirrorStatus?.replace(/^failed:\s*/, '')}` : settings.mirrorStatus === 'ok' ? 'The last backup was copied to the second folder.' : 'The second folder will receive the next backup.'}</p>}
    </div>
  );
};
