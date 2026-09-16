import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit2, Trash2, DollarSign, Settings, AlertCircle, ChevronRight, Scale, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useIsMobile } from '@/hooks/use-mobile';
import { useServices, useCreateService, useUpdateService, useDeleteService, useSeedDefaultServices, ServiceFormData as ServiceFormType, ServiceData } from '@/hooks/useServices';
import { SectionLoading } from '@/components/ui/loading-spinner';
import { MobilePageHeader } from '@/components/layout/MobilePageHeader';
import { cn } from '@/lib/utils';

interface ServiceFormData {
  name: string;
  description: string;
  category: 'wash' | 'dry' | 'special' | 'ironing' | 'folding' | 'detergent' | 'perfume' | 'softener' | 'other_goods';
  item_type?: 'service' | 'product';
  unit_price: number;
  kilo_price: number;
  supports_unit: boolean;
  supports_kilo: boolean;
  duration_value: number;
  duration_unit: 'hours' | 'days';
}

const initialFormData: ServiceFormData = {
  name: '',
  description: '',
  category: 'wash',
  item_type: 'service',
  unit_price: 0,
  kilo_price: 0,
  supports_unit: true,
  supports_kilo: false,
  duration_value: 1,
  duration_unit: 'days',
};

const ServiceManagement = () => {
  usePageTitle('Service Management');

  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const FormDialog = isMobile ? Drawer : Dialog;
  const FormDialogContent = isMobile ? DrawerContent : DialogContent;
  const FormDialogHeader = isMobile ? DrawerHeader : DialogHeader;
  const FormDialogTitle = isMobile ? DrawerTitle : DialogTitle;
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingService, setEditingService] = useState<any>(null);
  const [formData, setFormData] = useState<ServiceFormData>(initialFormData);
  const { toast } = useToast();

  // Use hooks to fetch and manage services
  const { data: services = [], isLoading: loading, error } = useServices();
  const createServiceMutation = useCreateService();
  const updateServiceMutation = useUpdateService();
  const deleteServiceMutation = useDeleteService();
  const seedDefaultServices = useSeedDefaultServices();

  const isProcessing = createServiceMutation.isPending || updateServiceMutation.isPending || deleteServiceMutation.isPending || seedDefaultServices.isPending;

  // Seed the shared default starter services (see DEFAULT_SERVICES in useServices).
  const seedInitialServices = () => seedDefaultServices.mutate();

  const getCategoryColor = (category: string) => {
    switch (category) {
      // Service categories
      case 'wash': return 'bg-blue-100 text-blue-800';
      case 'dry': return 'bg-green-100 text-green-800';
      case 'special': return 'bg-purple-100 text-purple-800';
      case 'ironing': return 'bg-orange-100 text-orange-800';
      case 'folding': return 'bg-gray-100 text-gray-800';
      // Product categories
      case 'detergent': return 'bg-cyan-100 text-cyan-800';
      case 'perfume': return 'bg-pink-100 text-pink-800';
      case 'softener': return 'bg-indigo-100 text-indigo-800';
      case 'other_goods': return 'bg-teal-100 text-teal-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'wash': return 'Wash';
      case 'dry': return 'Dry Clean';
      case 'special': return 'Special';
      case 'ironing': return 'Ironing';
      case 'folding': return 'Folding';
      case 'detergent': return 'Detergent';
      case 'perfume': return 'Perfume';
      case 'softener': return 'Softener';
      case 'other_goods': return 'Other Product';
      default: return category;
    }
  };

  const PRICE_STYLES = {
    kilo: { icon: Scale, className: 'text-blue-600' },
    unit: { icon: Package, className: 'text-purple-600' },
  } as const;

  const getPriceEntries = (service: ServiceData) => {
    const entries: { type: keyof typeof PRICE_STYLES; label: string }[] = [];
    if (service.supports_kilo) {
      entries.push({ type: 'kilo', label: `Rp${service.kilo_price?.toLocaleString('en-IN') || '0'}/kg` });
    }
    if (service.supports_unit) {
      entries.push({ type: 'unit', label: `Rp${service.unit_price?.toLocaleString('en-IN') || '0'}/unit` });
    }
    return entries;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!formData.name.trim()) {
      toast({
        title: "Error",
        description: "Service name is required",
        variant: "destructive",
      });
      return;
    }

    if (!formData.supports_unit && !formData.supports_kilo) {
      toast({
        title: "Error",
        description: "Services must support at least one pricing method",
        variant: "destructive",
      });
      return;
    }

    if (formData.supports_unit && formData.unit_price <= 0) {
      toast({
        title: "Error",
        description: "Price per unit must be greater than 0",
        variant: "destructive",
      });
      return;
    }

    if (formData.supports_kilo && formData.kilo_price <= 0) {
      toast({
        title: "Error",
        description: "Price per kilogram must be greater than 0",
        variant: "destructive",
      });
      return;
    }

    try {
      if (editingService) {
        // Update existing service
        await updateServiceMutation.mutateAsync({
          id: editingService.id,
          data: formData
        });
      } else {
        // Create new service
        await createServiceMutation.mutateAsync(formData);
      }

      setFormData(initialFormData);
      setEditingService(null);
      setShowCreateDialog(false);
    } catch (error) {
      // Error handling is done in the mutation hooks
      console.error('Error saving service:', error);
    }
  };

  const handleEdit = (service: any) => {
    setFormData({
      name: service.name,
      description: service.description || '',
      category: service.category,
      unit_price: service.unit_price || 0,
      kilo_price: service.kilo_price || 0,
      supports_unit: service.supports_unit,
      supports_kilo: service.supports_kilo,
      duration_value: service.duration_value,
      duration_unit: service.duration_unit,
    });
    setEditingService(service);
    setShowCreateDialog(true);
  };

  const handleDelete = async (serviceId: string): Promise<boolean> => {
    if (!confirm('Are you sure you want to delete this service?')) {
      return false;
    }

    try {
      await deleteServiceMutation.mutateAsync(serviceId);
      return true;
    } catch (error) {
      // Error handling is done in the mutation hook
      console.error('Error deleting service:', error);
      return false;
    }
  };

  const openCreateDialog = () => {
    setFormData(initialFormData);
    setEditingService(null);
    setShowCreateDialog(true);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      {isMobile ? (
        <MobilePageHeader title="Service Management" onBack={() => navigate('/home')} />
      ) : (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Service Management</h1>
            <p className="text-muted-foreground">Manage your laundry services and prices</p>
          </div>
          <Button
            onClick={openCreateDialog}
            className="flex items-center space-x-2"
            disabled={isProcessing}
          >
            <Plus className="h-4 w-4" />
            <span>Add Service</span>
          </Button>
        </div>
      )}

      {/* Mobile FAB */}
      {isMobile && (
        <Button
          onClick={openCreateDialog}
          disabled={isProcessing}
          size="icon"
          aria-label="Add Service"
          className="fixed right-4 z-40 h-14 w-14 rounded-full shadow-medium"
          style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
        >
          <Plus className="h-6 w-6" />
        </Button>
      )}

      {/* Loading State */}
      {loading && <SectionLoading text="Loading services..." />}

      {/* Error State */}
      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <div>
                <h3 className="font-medium text-destructive">Error loading services</h3>
                <p className="text-sm text-destructive/80">
                  Please refresh the page or contact support if the problem continues.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Services Grid */}
      {!loading && !error && (
        <>
          {services.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Settings className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-medium mb-2">No services</h3>
                <p className="text-muted-foreground mb-4">
                  Start by creating your first laundry service or load sample services.
                </p>
                <div className="flex justify-center gap-2">
                  <Button onClick={openCreateDialog}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Service
                  </Button>
                  <Button
                    variant="outline"
                    onClick={seedInitialServices}
                    disabled={isProcessing}
                  >
                    {isProcessing ? 'Loading...' : 'Load Sample Services'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : isMobile ? (
            <div className="divide-y rounded-lg border bg-card">
              {services.map((service) => (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => handleEdit(service)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{service.name}</span>
                      <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
                        {getPriceEntries(service).map(({ type, label }) => {
                          const { icon: PriceIcon, className } = PRICE_STYLES[type];
                          return (
                            <span
                              key={type}
                              className={cn('flex items-center gap-1 text-sm font-semibold', className)}
                            >
                              <PriceIcon className="h-3.5 w-3.5" />
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div className="truncate text-sm text-muted-foreground">
                      {getCategoryLabel(service.category)}
                      {service.duration_value > 0 &&
                        ` · ${service.duration_value} ${service.duration_unit === 'hours' ? 'hours' : 'days'}`}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {services.map((service) => (
          <Card key={service.id} className="hover:shadow-medium transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="min-w-0 truncate text-lg">{service.name}</CardTitle>
                <Badge className={cn('flex-shrink-0', getCategoryColor(service.category))}>
                  {getCategoryLabel(service.category)}
                </Badge>
              </div>
              {service.description && (
                <p className="text-sm text-muted-foreground">{service.description}</p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Pricing Information */}
              <div className="space-y-2">
                <h4 className="font-medium flex items-center">
                  <DollarSign className="h-4 w-4 mr-1" />
                  Pricing Options
                </h4>
                {service.supports_unit && (
                  <div className="flex justify-between text-sm">
                    <span>Per Unit:</span>
                    <span className="font-semibold">Rp{service.unit_price?.toLocaleString('en-IN') || '0'}</span>
                  </div>
                )}
                {service.supports_kilo && (
                  <div className="flex justify-between text-sm">
                    <span>Per Kg:</span>
                    <span className="font-semibold">Rp{service.kilo_price?.toLocaleString('en-IN') || '0'}</span>
                  </div>
                )}
              </div>

              {/* Duration */}
              <div className="flex justify-between text-sm">
                <span>Duration:</span>
                <span>{service.duration_value} {service.duration_unit === 'hours' ? 'hours' : 'days'}</span>
              </div>

              {/* Actions */}
              <div className="flex space-x-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEdit(service)}
                  className="flex-1"
                >
                  <Edit2 className="h-4 w-4 mr-1" />
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(service.id)}
                  className="flex-1"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
            </div>
          )}
        </>
      )}

      {/* Create/Edit Service Dialog */}
      <FormDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} {...(isMobile ? { shouldScaleBackground: false } : {})}>
        <FormDialogContent className={isMobile ? 'max-h-[85vh] flex flex-col' : 'max-w-2xl'}>
          <FormDialogHeader>
            <FormDialogTitle>
              {editingService ? 'Edit Service' : 'Create New Service'}
            </FormDialogTitle>
          </FormDialogHeader>

          <form
            onSubmit={handleSubmit}
            className={cn(
              'space-y-6',
              isMobile && 'min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]'
            )}
          >
            {/* Basic Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Service Name*</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Example: Regular Wash"
                  required
                />
              </div>
              <div>
                <Label htmlFor="category">Category*</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value: any) => {
                    const isProduct = ['detergent', 'perfume', 'softener', 'other_goods'].includes(value);
                    setFormData({ 
                      ...formData, 
                      category: value,
                      item_type: isProduct ? 'product' : 'service',
                      // Products typically don't have duration
                      duration_value: isProduct ? 0 : formData.duration_value || 1,
                      supports_kilo: isProduct ? false : formData.supports_kilo
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wash">Wash</SelectItem>
                    <SelectItem value="dry">Dry Clean</SelectItem>
                    <SelectItem value="ironing">Ironing</SelectItem>
                    <SelectItem value="folding">Folding</SelectItem>
                    <SelectItem value="special">Special</SelectItem>
                    <SelectItem value="detergent">Detergent (Product)</SelectItem>
                    <SelectItem value="perfume">Perfume (Product)</SelectItem>
                    <SelectItem value="softener">Softener (Product)</SelectItem>
                    <SelectItem value="other_goods">Other Product</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Short service description"
                rows={3}
              />
            </div>

            {/* Pricing Options */}
            <div className="space-y-4">
              <h3 className="font-medium">Pricing Options</h3>

              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="supports_unit"
                    checked={formData.supports_unit}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, supports_unit: checked as boolean })
                    }
                  />
                  <Label htmlFor="supports_unit">Supports per-item pricing</Label>
                </div>

                {formData.supports_unit && (
                  <div>
                    <Label htmlFor="unit_price">Price per unit (IDR)</Label>
                    <Input
                      id="unit_price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.unit_price || ''}
                      onChange={(e) => setFormData({ ...formData, unit_price: parseFloat(e.target.value) || 0 })}
                      placeholder="0"
                    />
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="supports_kilo"
                    checked={formData.supports_kilo}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, supports_kilo: checked as boolean })
                    }
                  />
                  <Label htmlFor="supports_kilo">Supports by-weight pricing</Label>
                </div>

                {formData.supports_kilo && (
                  <div>
                    <Label htmlFor="kilo_price">Price per kilogram (IDR)</Label>
                    <Input
                      id="kilo_price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.kilo_price || ''}
                      onChange={(e) => setFormData({ ...formData, kilo_price: parseFloat(e.target.value) || 0 })}
                      placeholder="0"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Duration */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="duration_value">Duration</Label>
                <Input
                  id="duration_value"
                  type="number"
                  min="1"
                  value={formData.duration_value}
                  onChange={(e) => setFormData({ ...formData, duration_value: parseInt(e.target.value) || 1 })}
                />
              </div>
              <div>
                <Label htmlFor="duration_unit">Duration Unit</Label>
                <Select
                  value={formData.duration_unit}
                  onValueChange={(value: any) => setFormData({ ...formData, duration_unit: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hours">Hours</SelectItem>
                    <SelectItem value="days">Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Delete (mobile edit mode only - desktop keeps the per-card delete button) */}
            {isMobile && editingService && (
              <Button
                type="button"
                variant="outline"
                className="w-full text-destructive hover:text-destructive"
                onClick={async () => {
                  if (await handleDelete(editingService.id)) {
                    setShowCreateDialog(false);
                  }
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Service
              </Button>
            )}

            {/* Form Actions */}
            <div className="flex justify-end space-x-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Saving...' : editingService ? 'Update Service' : 'Create Service'}
              </Button>
            </div>
          </form>
        </FormDialogContent>
      </FormDialog>
    </div>
  );
};

export default ServiceManagement;
