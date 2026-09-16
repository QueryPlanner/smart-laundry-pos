import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MessageCircle, CheckCircle2, XCircle, RefreshCw, QrCode, KeyRound, AlertTriangle } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { toast } from '@/hooks/use-toast';
import { useStore } from '@/contexts/StoreContext';
import { authService } from '@/services/authService';
import { useWhatsAppSenderRegistration } from '@/hooks/useWhatsAppSenderRegistration';

// Re-verify an already-linked sender at most this often on mount, so
// reopening Store Settings repeatedly doesn't spam WhatsPoints.
const VERIFY_STALE_MS = 5 * 60 * 1000;

export const WhatsAppSenderCard: React.FC = () => {
  const { currentStore, isOwner, refreshStores } = useStore();
  const storeId = currentStore?.store_id ?? '';

  const {
    phase,
    qrCode,
    pairingCode,
    error,
    verifying,
    startQR,
    startCode,
    verifySender,
    reset,
  } = useWhatsAppSenderRegistration(storeId);

  const [phoneInput, setPhoneInput] = useState(currentStore?.store_phone ?? '');
  const [method, setMethod] = useState<'code' | 'qr'>('code');
  const [togglingUseStoreNumber, setTogglingUseStoreNumber] = useState(false);
  const [editingSender, setEditingSender] = useState(false);
  const autoVerifiedRef = useRef(false);

  const waUseStoreNumber = !!currentStore?.wa_use_store_number;
  const waSenderId = currentStore?.wa_sender_id ?? null;
  const waLastVerified = currentStore?.wa_sender_last_verified ?? null;

  // Re-verify a linked sender once per mount if it's stale (or has never
  // been verified) - a sender can silently die (device unlinked in
  // WhatsApp) with nothing else in this app noticing.
  useEffect(() => {
    if (!waUseStoreNumber || !waSenderId || autoVerifiedRef.current) return;

    const isStale =
      !waLastVerified || Date.now() - new Date(waLastVerified).getTime() > VERIFY_STALE_MS;
    if (!isStale) return;

    autoVerifiedRef.current = true;
    verifySender(waSenderId).then(() => refreshStores());
    // Only re-run if the store or sender identity actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, waSenderId]);

  useEffect(() => {
    if (phase === 'connected' || phase === 'linked') {
      setEditingSender(false);
      refreshStores();
      toast({
        title: 'Sender Number Registered',
        description: 'WhatsApp notifications will be sent from this number.',
      });
    }
    if (phase === 'failed' && error) {
      toast({ title: 'Registration Failed', description: error, variant: 'destructive' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const handleStartChangeNumber = () => {
    if (verifying) return;
    reset();
    setPhoneInput(waSenderId ?? currentStore?.store_phone ?? '');
    setMethod('code');
    setEditingSender(true);
  };

  const handleCancelChangeNumber = () => {
    reset();
    setEditingSender(false);
  };

  const handleToggleUseStoreNumber = async (checked: boolean) => {
    if (!storeId) return;
    setTogglingUseStoreNumber(true);
    try {
      await authService.setStoreWaUseStoreNumber(storeId, checked);
      await refreshStores();
    } catch (err) {
      toast({
        title: 'Failed Saving',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'destructive',
      });
    } finally {
      setTogglingUseStoreNumber(false);
    }
  };

  const handleRegister = () => {
    if (!phoneInput.trim()) {
      toast({
        title: 'Phone Number Required',
        description: 'Enter the WhatsApp number you want to register.',
        variant: 'destructive',
      });
      return;
    }
    if (method === 'qr') {
      startQR(phoneInput);
    } else {
      startCode(phoneInput);
    }
  };

  const handleVerifyNow = async () => {
    if (!waSenderId) return;
    const result = await verifySender(waSenderId);
    await refreshStores();
    if (result.registered) {
      toast({ title: 'Verified', description: 'The sender number is still active in WhatsPoints.' });
    } else {
      toast({
        title: 'Not Registered',
        description: 'The sender number is no longer active. Please register again.',
        variant: 'destructive',
      });
    }
  };

  if (!currentStore) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <p className="text-muted-foreground">No store selected</p>
        </CardContent>
      </Card>
    );
  }

  if (!isOwner) {
    return null;
  }

  const isBusy = phase === 'checking' || togglingUseStoreNumber;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5" />
          WhatsApp Sender Number
        </CardTitle>
        <CardDescription>
          Send WhatsApp notifications to customers using your own store number instead of the default number.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border rounded-lg">
          <div className="space-y-1 flex-1">
            <Label htmlFor="wa-use-store-number" className="font-normal">
              Use Your Own Store Number
            </Label>
            <p className="text-sm text-muted-foreground">
              If disabled, notifications are sent from the default WhatsPoints number.
            </p>
          </div>
          <Switch
            id="wa-use-store-number"
            checked={waUseStoreNumber}
            onCheckedChange={handleToggleUseStoreNumber}
            disabled={togglingUseStoreNumber}
            className="self-start sm:self-center"
          />
        </div>

        {waUseStoreNumber && waSenderId && !editingSender && (
          <div className="space-y-3 p-4 border rounded-lg">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span className="font-medium">Registered</span>
                <Badge variant="outline">{waSenderId}</Badge>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleVerifyNow} disabled={verifying}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${verifying ? 'animate-spin' : ''}`} />
                  Verify Now
                </Button>
                <Button variant="outline" size="sm" onClick={handleStartChangeNumber} disabled={verifying}>
                  Switch Number
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {waLastVerified
                ? `Last verified: ${new Date(waLastVerified).toLocaleString('en-IN')}`
                : 'Not verified yet'}
            </p>
          </div>
        )}

        {waUseStoreNumber && !waSenderId && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              This store number is not registered. Notifications are temporarily sent from the default
              WhatsPoints number instead of this store number. Register the number below so customers
              receive messages from this store number.
            </AlertDescription>
          </Alert>
        )}

        {waUseStoreNumber && (!waSenderId || phase !== 'idle' || editingSender) && phase !== 'connected' && phase !== 'linked' && (
          <div className="space-y-4 p-4 border rounded-lg">
            <div className="space-y-2">
              <Label htmlFor="wa-sender-phone">WhatsApp Number</Label>
              <Input
                id="wa-sender-phone"
                placeholder="081234567890"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                disabled={isBusy || phase === 'awaiting_qr' || phase === 'awaiting_code'}
              />
            </div>

            {phase === 'idle' && (
              <div className="flex gap-2">
                <Button
                  variant={method === 'code' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMethod('code')}
                >
                  <KeyRound className="h-4 w-4 mr-2" />
                  Code Pairing
                </Button>
                <Button
                  variant={method === 'qr' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMethod('qr')}
                >
                  <QrCode className="h-4 w-4 mr-2" />
                  QR Code
                </Button>
              </div>
            )}

            {phase === 'idle' && (
              <div className="flex gap-2">
                <Button onClick={handleRegister} className="w-full sm:w-auto">
                  Register This Number
                </Button>
                {editingSender && waSenderId && (
                  <Button variant="ghost" onClick={handleCancelChangeNumber}>
                    Cancel
                  </Button>
                )}
              </div>
            )}

            {phase === 'checking' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoadingSpinner size="sm" variant="primary" />
                Checking number status...
              </div>
            )}

            {phase === 'awaiting_code' && pairingCode && (
              <div className="space-y-2 text-center">
                <p className="text-sm text-muted-foreground">
                  Open WhatsApp on the phone using this number &gt; Linked Devices &gt; Link
                  a Device &gt; Link with phone number, then enter the following code:
                </p>
                <p className="text-2xl font-mono font-bold tracking-widest">{pairingCode}</p>
                <Button variant="ghost" size="sm" onClick={handleCancelChangeNumber}>
                  Cancel
                </Button>
              </div>
            )}

            {phase === 'awaiting_qr' && qrCode && (
              <div className="space-y-2 text-center">
                <p className="text-sm text-muted-foreground">
                  Open WhatsApp on the phone using this number &gt; Linked Devices &gt; Link
                  a Device, then scan the following QR code:
                </p>
                <img
                  src={`data:image/png;base64,${qrCode}`}
                  alt="WhatsApp registration QR code"
                  className="mx-auto w-48 h-48"
                />
                <Button variant="ghost" size="sm" onClick={handleCancelChangeNumber}>
                  Cancel
                </Button>
              </div>
            )}

            {phase === 'failed' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <XCircle className="h-4 w-4" />
                  {error || 'Registration failed. Please try again.'}
                </div>
                <Button variant="outline" size="sm" onClick={reset}>
                  Try Again
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
