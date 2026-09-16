import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, XCircle, RefreshCw, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface PWADiagnosticsProps {
  onClose?: () => void;
}

export const PWADiagnostics: React.FC<PWADiagnosticsProps> = ({ onClose }) => {
  const [diagnostics, setDiagnostics] = useState<any>({});
  const [swStatus, setSwStatus] = useState<string>('checking');

  useEffect(() => {
    runDiagnostics();
  }, []);

  const runDiagnostics = async () => {
    const results: any = {};

    // Check HTTPS
    results.https = location.protocol === 'https:' || location.hostname === 'localhost';

    // Check Service Worker support
    results.swSupport = 'serviceWorker' in navigator;

    // Check Service Worker registration
    if (results.swSupport) {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        results.swRegistered = !!registration;
        results.swActive = !!registration?.active;
        setSwStatus(registration?.active ? 'active' : 'inactive');
      } catch (error) {
        results.swRegistered = false;
        results.swActive = false;
        setSwStatus('error');
      }
    }

    // Check manifest
    try {
      const manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement;
      results.manifestLinked = !!manifestLink;
      
      if (manifestLink) {
        const response = await fetch(manifestLink.href);
        const manifest = await response.json();
        results.manifestValid = !!(manifest.name && manifest.start_url && manifest.icons);
        results.manifestData = manifest;
      }
    } catch (error) {
      results.manifestValid = false;
    }

    // Check Install Prompt
    results.installPromptSupported = 'BeforeInstallPromptEvent' in window;

    // Check if already installed
    results.isInstalled = window.matchMedia('(display-mode: standalone)').matches ||
                         (window.navigator as any).standalone === true;

    // Browser info
    results.browser = {
      userAgent: navigator.userAgent,
      isChrome: /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor || ''),
      isSafari: /^((?!chrome|android).)*safari/i.test(navigator.userAgent),
      isFirefox: /Firefox/.test(navigator.userAgent),
      isEdge: /Edge/.test(navigator.userAgent),
      isMobile: /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    };

    setDiagnostics(results);
  };

  const StatusIcon = ({ status }: { status: boolean | undefined }) => {
    if (status === true) return <CheckCircle className="h-5 w-5 text-green-600" />;
    if (status === false) return <XCircle className="h-5 w-5 text-red-600" />;
    return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
  };

  const forceServiceWorkerUpdate = async () => {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          await registration.update();
          window.location.reload();
        }
      } catch (error) {
        console.error('Failed to update service worker:', error);
      }
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="h-5 w-5" />
          PWA Diagnostics
        </CardTitle>
        <CardDescription>
          Progressive Web App status and troubleshooting
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* PWA Requirements */}
        <div>
          <h4 className="font-semibold mb-3">PWA Requirements:</h4>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <StatusIcon status={diagnostics.https} />
              <span>HTTPS or localhost</span>
            </div>
            <div className="flex items-center gap-3">
              <StatusIcon status={diagnostics.swSupport} />
              <span>Service Worker support</span>
            </div>
            <div className="flex items-center gap-3">
              <StatusIcon status={diagnostics.swRegistered} />
              <span>Service Worker registered</span>
            </div>
            <div className="flex items-center gap-3">
              <StatusIcon status={diagnostics.swActive} />
              <span>Service Worker active</span>
            </div>
            <div className="flex items-center gap-3">
              <StatusIcon status={diagnostics.manifestLinked} />
              <span>Web App Manifest linked</span>
            </div>
            <div className="flex items-center gap-3">
              <StatusIcon status={diagnostics.manifestValid} />
              <span>Web App Manifest valid</span>
            </div>
          </div>
        </div>

        {/* Install Status */}
        <div>
          <h4 className="font-semibold mb-3">Installation Status:</h4>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <StatusIcon status={diagnostics.installPromptSupported} />
              <span>Install prompt supported</span>
            </div>
            <div className="flex items-center gap-3">
              <StatusIcon status={diagnostics.isInstalled} />
              <span>App is already installed</span>
            </div>
          </div>
        </div>

        {/* Browser Info */}
        {diagnostics.browser && (
          <div>
            <h4 className="font-semibold mb-3">Browser Information:</h4>
            <div className="text-sm space-y-1 bg-gray-50 p-3 rounded">
              <p><strong>Chrome:</strong> {diagnostics.browser.isChrome ? 'Yes' : 'No'}</p>
              <p><strong>Safari:</strong> {diagnostics.browser.isSafari ? 'Yes' : 'No'}</p>
              <p><strong>Firefox:</strong> {diagnostics.browser.isFirefox ? 'Yes' : 'No'}</p>
              <p><strong>Edge:</strong> {diagnostics.browser.isEdge ? 'Yes' : 'No'}</p>
              <p><strong>Mobile:</strong> {diagnostics.browser.isMobile ? 'Yes' : 'No'}</p>
            </div>
          </div>
        )}

        {/* Troubleshooting Actions */}
        <div>
          <h4 className="font-semibold mb-3">Troubleshooting:</h4>
          <div className="space-y-2">
            <Button
              onClick={forceServiceWorkerUpdate}
              variant="outline"
              className="w-full"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Update Service Worker
            </Button>
            
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
              className="w-full"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Reload Page
            </Button>
          </div>
        </div>

        {/* Common Issues */}
        <div>
          <h4 className="font-semibold mb-3">Common Solutions:</h4>
          <div className="text-sm space-y-2 bg-blue-50 p-3 rounded">
            <p><strong>Install button does not appear:</strong></p>
            <ul className="ml-4 space-y-1">
              <li>• Make sure you are using HTTPS or localhost</li>
              <li>• Try Chrome or Edge for the best results</li>
              <li>• Clear the browser cache and reload</li>
              <li>• Wait a few seconds after the page loads</li>
            </ul>
            
            <p className="mt-3"><strong>Safari iOS:</strong></p>
            <ul className="ml-4 space-y-1">
              <li>• Use the Share button → "Add to Home Screen"</li>
              <li>• Automatic installation is not supported in Safari</li>
            </ul>
          </div>
        </div>

        {/* Close Button */}
        {onClose && (
          <Button onClick={onClose} className="w-full">
            Close Diagnostics
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
