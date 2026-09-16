import React, { useState } from 'react';
import { Smartphone, Settings, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PWAManualInstall } from '@/components/ui/PWAManualInstall';
import { PWADiagnostics } from '@/components/ui/PWADiagnostics';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePageMeta } from '@/hooks/usePageMeta';

interface PWAManagementPageProps {
  onBack?: () => void;
}

export const PWAManagementPage: React.FC<PWAManagementPageProps> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState('install');

  usePageMeta({
    title: 'How to Install Smart Laundry POS - Android, iOS, Desktop',
    description:
      'Guide to installing Smart Laundry POS as an app (PWA) on Android, iOS, Windows, and Mac. Access it offline with a native-app experience from your home screen.',
    path: '/install',
  });

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          {onBack && (
            <Button
              variant="ghost"
              onClick={onBack}
              className="mb-4"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          )}
          
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <Smartphone className="h-12 w-12 text-blue-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Install Smart Laundry POS
            </h1>
            <p className="text-gray-600">
              Install the app for a better experience and offline access
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="install" className="flex items-center gap-2">
              <Smartphone className="h-4 w-4" />
              Install App
            </TabsTrigger>
            <TabsTrigger value="diagnostics" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Diagnostics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="install" className="mt-6">
            <PWAManualInstall />
          </TabsContent>

          <TabsContent value="diagnostics" className="mt-6">
            <PWADiagnostics />
          </TabsContent>
        </Tabs>

        {/* Info Section */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>
            If you run into issues, contact support or use the Diagnostics tab
            to troubleshoot PWA problems.
          </p>
        </div>
      </div>
    </div>
  );
};
