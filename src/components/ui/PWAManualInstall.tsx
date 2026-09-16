import React, { useState } from 'react';
import { Download, Smartphone, Info, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePWAInstall } from '@/hooks/usePWAInstall';

interface PWAManualInstallProps {
  onClose?: () => void;
}

export const PWAManualInstall: React.FC<PWAManualInstallProps> = ({ onClose }) => {
  const { isInstallable, isInstalled, installPWA, canInstall } = usePWAInstall();
  const [showInstructions, setShowInstructions] = useState(false);

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);

  if (isInstalled) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <Check className="h-12 w-12 text-green-600" />
          </div>
          <CardTitle className="text-green-600">App Already Installed</CardTitle>
          <CardDescription>
            Smart Laundry POS is already installed on your device
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2">
            <Smartphone className="h-6 w-6 text-blue-600" />
            <CardTitle>Install App</CardTitle>
          </div>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <CardDescription>
          Install Smart Laundry POS as a native app for a better experience
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Auto Install Button (for supported browsers) */}
        {canInstall && (
          <div className="space-y-2">
            <Button
              onClick={installPWA}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              size="lg"
            >
              <Download className="h-5 w-5 mr-2" />
              Install App Automatically
            </Button>
            <p className="text-sm text-gray-600 text-center">
              or follow the manual instructions below
            </p>
          </div>
        )}

        {/* Manual Instructions Toggle */}
        <Button
          variant="outline"
          onClick={() => setShowInstructions(!showInstructions)}
          className="w-full"
        >
          <Info className="h-4 w-4 mr-2" />
          Manual Installation Instructions
        </Button>

        {/* Manual Installation Instructions */}
        {showInstructions && (
          <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
            {isIOS && (
              <div>
                <h4 className="font-semibold text-sm mb-2 flex items-center">
                  <Smartphone className="h-4 w-4 mr-1" />
                  iPhone/iPad (Safari):
                </h4>
                <ol className="text-sm space-y-1 ml-4">
                  <li>1. Open this page in Safari</li>
                  <li>2. Tap the <strong>Share</strong> icon (the box with an upward arrow)</li>
                  <li>3. Scroll down and select <strong>"Add to Home Screen"</strong></li>
                  <li>4. Tap <strong>"Add"</strong> to confirm</li>
                </ol>
              </div>
            )}

            {isAndroid && (
              <div>
                <h4 className="font-semibold text-sm mb-2 flex items-center">
                  <Smartphone className="h-4 w-4 mr-1" />
                  Android:
                </h4>
                <ol className="text-sm space-y-1 ml-4">
                  <li>1. Open in Chrome or another PWA-compatible browser</li>
                  <li>2. Tap the <strong>⋮</strong> menu (three dots)</li>
                  <li>3. Select <strong>"Add to Home screen"</strong> or <strong>"Install app"</strong></li>
                  <li>4. Tap <strong>"Add"</strong> or <strong>"Install"</strong></li>
                </ol>
              </div>
            )}

            {!isIOS && !isAndroid && (
              <div>
                <h4 className="font-semibold text-sm mb-2 flex items-center">
                  <Download className="h-4 w-4 mr-1" />
                  Desktop (Chrome/Edge):
                </h4>
                <ol className="text-sm space-y-1 ml-4">
                  <li>1. Open in Chrome or Microsoft Edge</li>
                  <li>2. Find the <strong>Install</strong> icon in the address bar</li>
                  <li>3. Click the icon or open the ⋮ menu → "Install Smart Laundry POS"</li>
                  <li>4. Click <strong>"Install"</strong> to confirm</li>
                </ol>
              </div>
            )}

            <div className="border-t pt-3">
              <h4 className="font-semibold text-sm mb-2">Benefits of Installing the App:</h4>
              <ul className="text-sm space-y-1 ml-4">
                <li>• Faster access from the home screen</li>
                <li>• Works offline</li>
                <li>• Native-app experience</li>
                <li>• Push notifications (if supported)</li>
              </ul>
            </div>
          </div>
        )}

        {/* Browser Compatibility Notice */}
        <div className="text-xs text-gray-500 bg-yellow-50 p-3 rounded">
          <strong>Notes:</strong> Automatic installation is available in Chrome, Edge, and other modern browsers.
          For Safari on iOS, use the manual instructions above.
        </div>
      </CardContent>
    </Card>
  );
};
