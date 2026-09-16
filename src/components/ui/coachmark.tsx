import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { 
  Plus, 
  Users, 
  ShoppingCart,
  BarChart3,
  Home,
  ChevronLeft,
  ChevronRight,
  X
} from 'lucide-react';

interface CoachmarkStep {
  title: string;
  description: string;
  icon: React.ElementType;
  iconColor: string;
  iconBgColor: string;
}

interface CoachmarkProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user finishes the tour via the final action CTA. */
  onStart?: () => void;
}

const coachmarkSteps: CoachmarkStep[] = [
  {
    title: 'Welcome to Smart Laundry POS! 🎉',
    description: 'We will guide you through the key features. Use the "Quick Start" checklist to set up your store step by step. Let us begin!',
    icon: Home,
    iconColor: 'text-rose-500',
    iconBgColor: 'bg-rose-100'
  },
  {
    title: 'Create New Order',
    description: 'Click "Create Order" to create a new laundry order. You can add services, select a customer, and calculate the payment total with ease.',
    icon: Plus,
    iconColor: 'text-blue-500',
    iconBgColor: 'bg-blue-100'
  },
  {
    title: 'Manage Customers',
    description: 'Use the "Customers" menu to add, edit, or view your customer list. Customer data is saved to make future orders faster.',
    icon: Users,
    iconColor: 'text-green-500',
    iconBgColor: 'bg-green-100'
  },
  {
    title: 'Track Order History',
    description: 'Open "Reports" to view all orders, payment statuses, and transaction history. You can also print receipts and manage order statuses.',
    icon: ShoppingCart,
    iconColor: 'text-purple-500',
    iconBgColor: 'bg-purple-100'
  },
  {
    title: 'Analyze Revenue',
    description: 'Monitor daily revenue from the home page. Revenue cards show today\'s total and the change from the previous day.',
    icon: BarChart3,
    iconColor: 'text-orange-500',
    iconBgColor: 'bg-orange-100'
  },
  {
    title: 'Ready to Get Started? 🚀',
    description: 'Follow the "Quick Start" checklist to set up your store, or create your first order now.',
    icon: Plus,
    iconColor: 'text-rose-500',
    iconBgColor: 'bg-rose-100'
  }
];

const COACHMARK_STORAGE_KEY = 'smart-laundry-coachmark-shown';

export const Coachmark: React.FC<CoachmarkProps> = ({ open, onClose, onStart }) => {
  const [currentStep, setCurrentStep] = useState(0);

  const isLastStep = currentStep === coachmarkSteps.length - 1;
  const isFirstStep = currentStep === 0;
  const step = coachmarkSteps[currentStep];

  const handleNext = () => {
    if (isLastStep) {
      handleComplete();
    } else {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (!isFirstStep) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleComplete = () => {
    localStorage.setItem(COACHMARK_STORAGE_KEY, 'true');
    onClose();
    setCurrentStep(0);
    // Drive the user straight into their first task instead of dead-ending.
    onStart?.();
  };

  const handleSkip = () => {
    localStorage.setItem(COACHMARK_STORAGE_KEY, 'true');
    onClose();
    setCurrentStep(0);
  };

  return (
    <Dialog open={open} onOpenChange={handleSkip}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className={`w-12 h-12 ${step.iconBgColor} rounded-xl flex items-center justify-center`}>
                <step.icon className={`h-6 w-6 ${step.iconColor}`} />
              </div>
              <span className="text-sm text-gray-500">
                {currentStep + 1} of {coachmarkSteps.length}
              </span>
            </div>
          </div>
          <DialogTitle className="text-xl">{step.title}</DialogTitle>
          <DialogDescription className="text-base leading-relaxed pt-2">
            {step.description}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator dots */}
        <div className="flex justify-center gap-2 py-4">
          {coachmarkSteps.map((_, index) => (
            <div
              key={index}
              className={`h-2 rounded-full transition-all ${
                index === currentStep
                  ? 'w-8 bg-rose-500'
                  : index < currentStep
                  ? 'w-2 bg-rose-300'
                  : 'w-2 bg-gray-300'
              }`}
            />
          ))}
        </div>

        <DialogFooter className="flex-row gap-2 sm:gap-2">
          <div className="flex w-full gap-2">
            {!isFirstStep && (
              <Button
                type="button"
                variant="outline"
                onClick={handleBack}
                className="flex-1"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
            {isFirstStep && (
              <Button
                type="button"
                variant="outline"
                onClick={handleSkip}
                className="flex-1"
              >
                <X className="h-4 w-4 mr-1" />
                Skip
              </Button>
            )}
            <Button
              type="button"
              onClick={handleNext}
              className="flex-1 bg-rose-500 hover:bg-rose-600"
            >
              {isLastStep && <Plus className="h-4 w-4 mr-1" />}
              {isLastStep ? 'Create Your First Order' : 'Continue'}
              {!isLastStep && <ChevronRight className="h-4 w-4 ml-1" />}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Hook to check if coachmark should be shown
export const useCoachmark = () => {
  const [shouldShowCoachmark, setShouldShowCoachmark] = useState(false);

  useEffect(() => {
    const hasSeenCoachmark = localStorage.getItem(COACHMARK_STORAGE_KEY);
    if (!hasSeenCoachmark) {
      // Delay showing coachmark slightly to ensure page has loaded
      const timer = setTimeout(() => {
        setShouldShowCoachmark(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const hideCoachmark = () => {
    setShouldShowCoachmark(false);
  };

  const resetCoachmark = () => {
    localStorage.removeItem(COACHMARK_STORAGE_KEY);
    setShouldShowCoachmark(true);
  };

  return {
    shouldShowCoachmark,
    hideCoachmark,
    resetCoachmark
  };
};
