import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { 
  Bluetooth, 
  Printer, 
  Smartphone, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Loader2,
  Settings
} from 'lucide-react';
import { toast } from 'sonner';
import {
  isBluetoothSupported,
  isThermerAppAvailable,
  printToThermalPrinter,
  printToThermerApp,
  fetchReceiptDataForThermal,
  type LocalReceiptData
} from '@/lib/printUtils';
import { useThermalPrinter } from '@/contexts/ThermalPrinterContext';

interface ThermalPrinterManagerProps {
  orderId?: string;
  // When set, printing uses this in-memory receipt directly instead of
  // fetching via the get_receipt_data RPC - for orders not yet synced to
  // Supabase (offline order creation).
  localReceiptData?: LocalReceiptData;
  onPrintSuccess?: () => void;
  onPrintError?: (error: string) => void;
}

export const ThermalPrinterManager: React.FC<ThermalPrinterManagerProps> = ({
  orderId,
  localReceiptData,
  onPrintSuccess,
  onPrintError
}) => {
  const canPrint = Boolean(orderId || localReceiptData);
  const [isPrinting, setIsPrinting] = useState(false);
  
  // Use thermal printer context for global connection management
  const { 
    printerConnection, 
    connectionStatus, 
    isConnecting, 
    lastError, 
    connect: connectPrinter, 
    disconnect: disconnectPrinter, 
    clearError 
  } = useThermalPrinter();

  const handleConnect = useCallback(async () => {
    clearError();
    await connectPrinter();
  }, [clearError, connectPrinter]);

  const handleDisconnect = useCallback(() => {
    disconnectPrinter();
  }, [disconnectPrinter]);

  const handlePrintBluetooth = useCallback(async () => {
    if (!printerConnection || !canPrint) {
      return;
    }

    setIsPrinting(true);
    clearError();

    try {
      // Fetch receipt data, unless we already have it in memory (an
      // offline order that hasn't synced to Supabase yet).
      const receiptData = localReceiptData ?? await fetchReceiptDataForThermal(orderId!);

      // Print to thermal printer
      await printToThermalPrinter(receiptData, printerConnection, {
        paperWidth: 32,
        cutPaper: true,
        feedLines: 3
      });

      toast.success('🖨️ Receipt printed successfully!');
      if (onPrintSuccess) {
        onPrintSuccess();
      }
    } catch (error) {
      console.error('❌ Print failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Printing failed';
      toast.error(`❌ Printing failed: ${errorMessage}`);
      if (onPrintError) {
        onPrintError(errorMessage);
      }
    } finally {
      setIsPrinting(false);
    }
  }, [printerConnection, canPrint, orderId, localReceiptData, onPrintSuccess, onPrintError, clearError]);

  const handlePrintThermer = useCallback(async () => {
    if (!canPrint) return;

    setIsPrinting(true);
    clearError();

    try {
      // Fetch receipt data, unless we already have it in memory (an
      // offline order that hasn't synced to Supabase yet).
      const receiptData = localReceiptData ?? await fetchReceiptDataForThermal(orderId!);

      // Print via Thermer app
      await printToThermerApp(receiptData);

      toast.success('📱 Receipt sent to the Thermer app successfully!');
      if (onPrintSuccess) {
        onPrintSuccess();
      }
    } catch (error) {
      console.error('Thermer print failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Thermer printing failed';
      toast.error(`❌ Thermer printing failed: ${errorMessage}`);
      if (onPrintError) {
        onPrintError(errorMessage);
      }
    } finally {
      setIsPrinting(false);
    }
  }, [canPrint, orderId, localReceiptData, onPrintSuccess, onPrintError, clearError]);

  const bluetoothSupported = isBluetoothSupported();
  const thermerAvailable = isThermerAppAvailable();

  if (!bluetoothSupported && !thermerAvailable) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Thermal printing is not supported on this device. Use browser printing or export a PDF instead.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center space-x-2">
          <Printer className="h-5 w-5" />
          <span>Thermal Printer</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Bluetooth Printing Section */}
        {bluetoothSupported && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Bluetooth className="h-4 w-4" />
                <span className="font-medium">Bluetooth Direct</span>
              </div>
              <Badge 
                variant={connectionStatus === 'connected' ? 'default' : 
                        connectionStatus === 'error' ? 'destructive' : 'secondary'}
                className="flex items-center space-x-1"
              >
                {connectionStatus === 'connected' && <CheckCircle className="h-3 w-3" />}
                {connectionStatus === 'error' && <XCircle className="h-3 w-3" />}
                <span>
                  {connectionStatus === 'connected' ? 'Connected' :
                   connectionStatus === 'error' ? 'Error' : 'Disconnected'}
                </span>
              </Badge>
            </div>

            <div className="flex space-x-2">
              {connectionStatus === 'disconnected' && (
                <Button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="flex items-center space-x-2"
                  size="sm"
                >
                  {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bluetooth className="h-4 w-4" />}
                  <span>{isConnecting ? 'Connecting...' : 'Connect Printer'}</span>
                </Button>
              )}

              {connectionStatus === 'connected' && (
                <>
                  <Button
                    onClick={handlePrintBluetooth}
                    disabled={isPrinting || !canPrint}
                    className="flex items-center space-x-2"
                    size="sm"
                  >
                    {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                    <span>{isPrinting ? 'Printing...' : 'Print Receipt'}</span>
                  </Button>

                  <Button
                    onClick={handleDisconnect}
                    variant="outline"
                    size="sm"
                    className="flex items-center space-x-2"
                  >
                    <XCircle className="h-4 w-4" />
                    <span>Disconnect</span>
                  </Button>
                </>
              )}

              {connectionStatus === 'error' && (
                <Button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  variant="outline"
                  size="sm"
                  className="flex items-center space-x-2"
                >
                  {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />}
                  <span>{isConnecting ? 'Retrying...' : 'Try Again'}</span>
                </Button>
              )}
            </div>

            {printerConnection && (
              <div className="text-sm text-muted-foreground">
                <p>Connected to: {printerConnection.deviceName || printerConnection.deviceId}</p>
              </div>
            )}
          </div>
        )}

        {/* Separator if both options are available */}
        {bluetoothSupported && thermerAvailable && (
          <Separator />
        )}

        {/* Thermer App Section */}
        {thermerAvailable && (
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Smartphone className="h-4 w-4" />
              <span className="font-medium">Thermer App Integration</span>
              <Badge variant="outline">Recommended</Badge>
            </div>

            <p className="text-sm text-muted-foreground">
              Use the Thermer app as a bridge to print to a wide range of Bluetooth thermal printers.
            </p>

            <Button
              onClick={handlePrintThermer}
              disabled={isPrinting || !canPrint}
              variant="outline"
              size="sm"
              className="flex items-center space-x-2 w-full"
            >
              {isPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
              <span>{isPrinting ? 'Sending to Thermer...' : 'Print via Thermer App'}</span>
            </Button>
          </div>
        )}

        {/* Error Display */}
        {lastError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {lastError}
            </AlertDescription>
          </Alert>
        )}

        {/* Instructions */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>• Make sure your thermal printer is powered on and in pairing mode</p>
          <p>• For best results, use 58mm thermal paper</p>
          <p>• The Thermer app supports more printer models and is easier to set up</p>
        </div>
      </CardContent>
    </Card>
  );
};
