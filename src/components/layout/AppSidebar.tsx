import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/contexts/StoreContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import {
  LogOut,
  History,
  Home,
  Settings,
  UserPlus,
  Building2,
  Wrench,
  Plus,
  Smartphone,
  Users,
  MessageSquare,
  TrendingUp,
  KeyRound,
  Wallet,
  ChevronDown,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AddCustomerDialog } from '@/components/pos/AddCustomerDialog';
import { ChangePasswordDialog } from '@/components/auth/ChangePasswordDialog';

// Constants for display truncation
const USER_INITIALS_MAX_LENGTH = 2;
const STORE_NAME_MAX_LENGTH = 10;

export const AppSidebar: React.FC = () => {
  const { user, signOut } = useAuth();
  const { currentStore, isOwner } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { setOpenMobile, isMobile } = useSidebar();

  const handleSignOut = async () => {
    await signOut();
  };

  const handleNavigation = (path: string) => {
    if (location.pathname !== path) {
      navigate(path);
    }
    // Close mobile sidebar after navigation
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  if (!user) return null;

  // Safely extract user initials, filtering out empty strings from split
  const userInitials = user.full_name
    ? user.full_name
        .split(' ')
        .filter((n) => n.length > 0)
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .substring(0, USER_INITIALS_MAX_LENGTH)
    : user.email?.substring(0, USER_INITIALS_MAX_LENGTH).toUpperCase() || 'U';

  // Main navigation items
  const mainMenuItems = [
    {
      title: 'Home',
      icon: Home,
      path: '/home',
    },
    {
      title: 'New Order',
      icon: Plus,
      path: '/pos',
    },
    {
      title: 'Order History',
      icon: History,
      path: '/order-history',
    },
    {
      title: 'Customers',
      icon: Users,
      path: '/customers',
    },
    {
      title: 'Expenses',
      icon: Wallet,
      path: '/expenses',
    },
  ];

  // Owner-only menu items
  const ownerMenuItems = [
    {
      title: 'Services',
      icon: Wrench,
      path: '/services',
    },
    {
      title: 'Store Management',
      icon: Building2,
      path: '/stores',
    },
    {
      title: 'WhatsApp Broadcast',
      icon: MessageSquare,
      path: '/whatsapp-broadcast',
    },
    {
      title: 'Revenue Reports',
      icon: TrendingUp,
      path: '/revenue-report',
    },
  ];

  return (
    <Sidebar collapsible="offcanvas">
      {/* Header with Logo */}
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">SL</span>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-gray-900 truncate">Smart Laundry</h1>
            <p className="text-xs text-muted-foreground truncate">Point of Sale</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* Main Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>Main Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainMenuItems.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    onClick={() => handleNavigation(item.path)}
                    isActive={location.pathname === item.path}
                    tooltip={item.title}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Quick Actions */}
        <SidebarGroup>
          <SidebarGroupLabel>Quick Actions</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <AddCustomerDialog
                  trigger={
                    <SidebarMenuButton tooltip="Add Customers">
                      <UserPlus className="h-4 w-4" />
                      <span>Add Customers</span>
                    </SidebarMenuButton>
                  }
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        {/* Owner-only Management Section */}
        {isOwner && (
          <SidebarGroup>
            <Collapsible defaultOpen className="group/collapsible">
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="flex w-full items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Manage
                  </span>
                  <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {ownerMenuItems.map((item) => (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          onClick={() => handleNavigation(item.path)}
                          isActive={location.pathname === item.path}
                          tooltip={item.title}
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
        )}

        {/* Settings Section */}
        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {!Capacitor.isNativePlatform() && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => handleNavigation('/install')}
                    isActive={location.pathname === '/install'}
                    tooltip="Install App"
                  >
                    <Smartphone className="h-4 w-4" />
                    <span>Install App</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <ChangePasswordDialog
                  trigger={
                    <SidebarMenuButton tooltip="Change Password">
                      <KeyRound className="h-4 w-4" />
                      <span>Change Password</span>
                    </SidebarMenuButton>
                  }
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer with User Profile */}
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="w-full">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-blue-600 text-white text-sm font-semibold">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col items-start flex-1 min-w-0">
                    <span className="text-sm font-medium truncate w-full">
                      {user.full_name || user.email?.split('@')[0] || 'User'}
                    </span>
                    <span className="text-xs text-muted-foreground truncate w-full">
                      {user.role === 'laundry_owner' ? 'Owner' : 'Staff'}
                    </span>
                  </div>
                  {currentStore && (
                    <Badge variant="secondary" className="text-xs ml-auto flex-shrink-0">
                      {currentStore.store_name.substring(0, STORE_NAME_MAX_LENGTH)}
                      {currentStore.store_name.length > STORE_NAME_MAX_LENGTH ? '...' : ''}
                    </Badge>
                  )}
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
              >
                <div className="px-3 py-2">
                  <p className="text-sm font-medium">{user.full_name || user.email?.split('@')[0]}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                  {currentStore && (
                    <Badge variant="secondary" className="mt-2 text-xs">
                      {currentStore.store_name}
                    </Badge>
                  )}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};
