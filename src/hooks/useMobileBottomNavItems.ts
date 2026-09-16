import { useNavigate, useLocation } from 'react-router-dom';
import { Home as HomeIcon, Plus, TrendingUp, History, Building2 } from 'lucide-react';
import { BottomNavItem } from '@/components/layout/MobileBottomNav';
import { useStore } from '@/contexts/StoreContext';

/**
 * Builds the shared bottom-nav item set used across every screen: Home, New Order,
 * Reports (owner) / History (staff), and Store (owner-only).
 */
export const useMobileBottomNavItems = (): BottomNavItem[] => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isOwner } = useStore();

  const items: Array<BottomNavItem | null> = [
    {
      id: 'home',
      title: 'Home',
      icon: HomeIcon,
      active: location.pathname === '/home',
      onClick: () => navigate('/home'),
    },
    {
      id: 'orders',
      title: 'New Order',
      icon: Plus,
      active: location.pathname === '/pos',
      onClick: () => navigate('/pos'),
      primary: true,
    },
    isOwner
      ? {
          id: 'reports',
          title: 'Reports',
          icon: TrendingUp,
          active: location.pathname === '/revenue-report',
          onClick: () => navigate('/revenue-report'),
        }
      : {
          id: 'reports',
          title: 'History',
          icon: History,
          active: location.pathname === '/order-history',
          onClick: () => navigate('/order-history'),
        },
    isOwner
      ? {
          id: 'stores',
          title: 'Store',
          icon: Building2,
          active: location.pathname === '/stores',
          onClick: () => navigate('/stores'),
        }
      : null,
  ];

  return items.filter((item): item is BottomNavItem => item !== null);
};
