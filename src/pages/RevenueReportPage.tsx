import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRevenueSummary } from '@/hooks/useRevenue';
import { CalendarIcon, Download, TrendingUp, TrendingDown } from 'lucide-react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { enUS as localeEn } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { SectionLoading } from '@/components/ui/loading-spinner';

type DateRangePreset = 'today' | '7days' | '1month' | '6months' | 'custom';

const dateRangePresets = [
  { value: 'today' as DateRangePreset, label: 'Today' },
  { value: '7days' as DateRangePreset, label: '7 days' },
  { value: '1month' as DateRangePreset, label: '1 month' },
  { value: '6months' as DateRangePreset, label: '6 months' },
  { value: 'custom' as DateRangePreset, label: 'Select date' },
];

const categoryLabels: Record<string, string> = {
  detergent: 'Detergent',
  gas: 'Gas',
  electricity: 'Electricity Credit',
  promo: 'Promotion',
  maintenance: 'Maintenance',
  other: 'Other',
};

const paymentMethodLabels: Record<string, string> = {
  cash: 'Cash',
  qris: 'QRIS',
  transfer: 'Bank Transfer',
};

const getDateRange = (preset: DateRangePreset, customStart?: Date, customEnd?: Date) => {
  const now = new Date();
  
  switch (preset) {
    case 'today':
      return {
        start: startOfDay(now).toISOString(),
        end: endOfDay(now).toISOString(),
      };
    case '7days':
      return {
        start: startOfDay(subDays(now, 6)).toISOString(),
        end: endOfDay(now).toISOString(),
      };
    case '1month':
      return {
        start: startOfDay(subDays(now, 29)).toISOString(),
        end: endOfDay(now).toISOString(),
      };
    case '6months':
      return {
        start: startOfDay(subDays(now, 179)).toISOString(),
        end: endOfDay(now).toISOString(),
      };
    case 'custom':
      if (customStart && customEnd) {
        return {
          start: startOfDay(customStart).toISOString(),
          end: endOfDay(customEnd).toISOString(),
        };
      }
      return {
        start: startOfDay(now).toISOString(),
        end: endOfDay(now).toISOString(),
      };
    default:
      return {
        start: startOfDay(now).toISOString(),
        end: endOfDay(now).toISOString(),
      };
  }
};

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export const RevenueReportPage = () => {
  usePageTitle('Business Revenue');

  const [selectedPreset, setSelectedPreset] = useState<DateRangePreset>('today');
  const [customStartDate, setCustomStartDate] = useState<Date | undefined>(undefined);
  const [customEndDate, setCustomEndDate] = useState<Date | undefined>(undefined);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);

  const dateRange = getDateRange(selectedPreset, customStartDate, customEndDate);
  const { data: revenueSummary, isLoading } = useRevenueSummary(dateRange.start, dateRange.end);

  const handlePresetChange = (preset: DateRangePreset) => {
    setSelectedPreset(preset);
    if (preset !== 'custom') {
      setCustomStartDate(undefined);
      setCustomEndDate(undefined);
    }
  };

  const handleExportCSV = () => {
    if (!revenueSummary) return;

    const csvContent = [
      ['Business Revenue Report'],
      [`Period: ${format(new Date(dateRange.start), 'dd/MM/yyyy', { locale: localeEn })} - ${format(new Date(dateRange.end), 'dd/MM/yyyy', { locale: localeEn })}`],
      [],
      ['Gross Revenue', formatCurrency(revenueSummary.grossProfit)],
      [],
      ['QRIS Payments', formatCurrency(revenueSummary.paymentMethods.qris)],
      ['Cash Payments', formatCurrency(revenueSummary.paymentMethods.cash)],
      ['Bank Transfer Payments', formatCurrency(revenueSummary.paymentMethods.transfer)],
      [],
      ['Deductions'],
      ['Detergent', formatCurrency(revenueSummary.deductions.detergent)],
      ['Gas', formatCurrency(revenueSummary.deductions.gas)],
      ['Electricity Credit', formatCurrency(revenueSummary.deductions.electricity)],
      ['Promotion', formatCurrency(revenueSummary.deductions.promo)],
      ['Maintenance', formatCurrency(revenueSummary.deductions.maintenance)],
      ['Other', formatCurrency(revenueSummary.deductions.other)],
      [],
      ['Net Revenue', formatCurrency(revenueSummary.netProfit)],
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `revenue-report-${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const displayDateRange = () => {
    if (selectedPreset === 'custom' && customStartDate && customEndDate) {
      return `${format(customStartDate, 'dd/MM/yyyy', { locale: localeEn })} - ${format(customEndDate, 'dd/MM/yyyy', { locale: localeEn })}`;
    }
    return `${format(new Date(dateRange.start), 'dd/MM/yyyy', { locale: localeEn })} - ${format(new Date(dateRange.end), 'dd/MM/yyyy', { locale: localeEn })}`;
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Business revenue</h1>
          <p className="text-gray-500 mt-1">Summary of business revenue and deductions.</p>
        </div>

        {/* Date Range Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {dateRangePresets.map((preset) => (
            <Button
              key={preset.value}
              variant={selectedPreset === preset.value ? 'default' : 'outline'}
              onClick={() => handlePresetChange(preset.value)}
              className={cn(
                'rounded-full',
                selectedPreset === preset.value
                  ? 'bg-green-500 hover:bg-green-600 text-white border-green-500'
                  : 'bg-white hover:bg-gray-50'
              )}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        {/* Custom Date Pickers */}
        {selectedPreset === 'custom' && (
          <div className="flex flex-wrap items-center gap-3">
            <Popover open={showStartDatePicker} onOpenChange={setShowStartDatePicker}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'justify-start text-left font-normal',
                    !customStartDate && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {customStartDate ? format(customStartDate, 'dd/MM/yyyy', { locale: localeEn }) : 'Select start date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={customStartDate}
                  onSelect={(date) => {
                    setCustomStartDate(date);
                    setShowStartDatePicker(false);
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>

            <span className="text-gray-500">-</span>

            <Popover open={showEndDatePicker} onOpenChange={setShowEndDatePicker}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'justify-start text-left font-normal',
                    !customEndDate && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {customEndDate ? format(customEndDate, 'dd/MM/yyyy', { locale: localeEn }) : 'Select end date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={customEndDate}
                  onSelect={(date) => {
                    setCustomEndDate(date);
                    setShowEndDatePicker(false);
                  }}
                  disabled={(date) => customStartDate ? date < customStartDate : false}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Date Range Display */}
        <div className="text-center py-2">
          <p className="text-sm text-gray-500">Selected period</p>
          <p className="text-lg font-medium text-gray-700">{displayDateRange()}</p>
        </div>
      </div>

      {isLoading ? (
        <SectionLoading text="Loading data..." />
      ) : (
        <>
          {/* Gross Profit Section */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="bg-green-50 rounded-t-lg">
              <CardTitle className="flex items-center gap-2 text-green-700">
                <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-white" />
                </div>
                Gross Revenue
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-4">
                {Object.entries(revenueSummary?.paymentMethods || {}).map(([method, amount]) => (
                  <div key={method} className="flex justify-between items-center">
                    <span className="text-gray-600">{paymentMethodLabels[method]} payments</span>
                    <span className="font-semibold text-gray-900">{formatCurrency(amount)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Deductions Section */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="bg-red-50 rounded-t-lg">
              <CardTitle className="flex items-center gap-2 text-red-700">
                <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center">
                  <TrendingDown className="h-5 w-5 text-white" />
                </div>
                Deductions
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-4">
                {Object.entries(revenueSummary?.deductions || {}).map(([category, amount]) => (
                  <div key={category} className="flex justify-between items-center">
                    <span className="text-gray-600">{categoryLabels[category]}</span>
                    <span className="font-semibold text-gray-900">{formatCurrency(amount)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Net Profit Section */}
          <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-50 to-indigo-50">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center">
                <span className="text-xl font-bold text-gray-900">Net Revenue</span>
                <span className="text-2xl font-bold text-blue-600">
                  {formatCurrency(revenueSummary?.netProfit || 0)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Export Button */}
          <div className="flex justify-center">
            <Button
              onClick={handleExportCSV}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
