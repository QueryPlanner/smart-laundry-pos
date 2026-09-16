import React, { useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, Eye, EyeOff, ChevronDown } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { usePageTitle } from '@/hooks/usePageTitle';
import { usePageMeta } from '@/hooks/usePageMeta';
import { PageLoading } from '@/components/ui/loading-spinner';
import { GoogleLoginButton } from '@/components/auth/GoogleLoginButton';

interface LoginForm {
  email: string;
  password: string;
}

interface SignUpForm extends LoginForm {
  fullName: string;
  phone: string;
  storeName: string;
  storeAddress: string;
  storePhone: string;
}

export const Login: React.FC = () => {
  const { user, loading, signIn, signUp } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get('tab') === 'signup' ? 'signup' : 'login';
  const [isLoading, setIsLoading] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showStoreDetails, setShowStoreDetails] = useState(false);

  usePageTitle('Login');
  usePageMeta({
    description:
      'Sign in or sign up as a laundry store owner with Smart Laundry POS. Free to use, no credit card required, and ready in 5 minutes.',
    path: '/login',
  });

  const loginForm = useForm<LoginForm>();
  const signUpForm = useForm<SignUpForm>();

  // Redirect if already authenticated
  if (user) {
    const from = location.state?.from?.pathname || '/home';
    return <Navigate to={from} replace />;
  }

  const handleLogin = async (data: LoginForm) => {
    try {
      setIsLoading(true);
      await signIn(data.email, data.password);
    } catch (error) {
      // Error is handled in the auth context
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (data: SignUpForm) => {
    try {
      setIsLoading(true);
      const role = 'laundry_owner';
      const storeData = {
        name: data.storeName,
        address: data.storeAddress || undefined,
        phone: data.storePhone || undefined
      };
      await signUp(data.email, data.password, data.fullName, data.phone, role, storeData);
    } catch (error) {
      // Error is handled in the auth context
    } finally {
      setIsLoading(false);
    }
  };

  if (loading) {
    return <PageLoading text="Loading..." />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Smart Laundry POS</CardTitle>
          <CardDescription>Sign in to your account or sign up as a store owner</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={defaultTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            
            <TabsContent value="login">
              <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="Enter your email"
                    {...loginForm.register('email', {
                      required: 'Email is required',
                      pattern: {
                        value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                        message: 'Invalid email address'
                      }
                    })}
                  />
                  {loginForm.formState.errors.email && (
                    <p className="text-sm text-destructive">{loginForm.formState.errors.email.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showLoginPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      className="pr-10"
                      {...loginForm.register('password', {
                        required: 'Password is required',
                        minLength: {
                          value: 6,
                          message: 'Password must be at least 6 characters'
                        }
                      })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowLoginPassword(!showLoginPassword)}
                    >
                      {showLoginPassword ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                  {loginForm.formState.errors.password && (
                    <p className="text-sm text-destructive">{loginForm.formState.errors.password.message}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading}
                >
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sign In
                </Button>
              </form>
            </TabsContent>
            
            <TabsContent value="signup">
              <form onSubmit={signUpForm.handleSubmit(handleSignUp)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-fullname">Full Name</Label>
                  <Input
                    id="signup-fullname"
                    type="text"
                    placeholder="Enter your full name"
                    {...signUpForm.register('fullName', {
                      required: 'Full name is required'
                    })}
                  />
                  {signUpForm.formState.errors.fullName && (
                    <p className="text-sm text-destructive">{signUpForm.formState.errors.fullName.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="Enter your email"
                    {...signUpForm.register('email', {
                      required: 'Email is required',
                      pattern: {
                        value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                        message: 'Invalid email address'
                      }
                    })}
                  />
                  {signUpForm.formState.errors.email && (
                    <p className="text-sm text-destructive">{signUpForm.formState.errors.email.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-phone">Phone Number</Label>
                  <Input
                    id="signup-phone"
                    type="tel"
                    placeholder="Enter your phone number"
                    {...signUpForm.register('phone', {
                      required: 'Phone number is required'
                    })}
                  />
                  {signUpForm.formState.errors.phone && (
                    <p className="text-sm text-destructive">{signUpForm.formState.errors.phone.message}</p>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="signup-password"
                      type={showSignupPassword ? "text" : "password"}
                      placeholder="Create a password"
                      className="pr-10"
                      {...signUpForm.register('password', {
                        required: 'Password is required',
                        minLength: {
                          value: 6,
                          message: 'Password must be at least 6 characters'
                        }
                      })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowSignupPassword(!showSignupPassword)}
                    >
                      {showSignupPassword ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                  {signUpForm.formState.errors.password && (
                    <p className="text-sm text-destructive">{signUpForm.formState.errors.password.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-store-name">Store Name</Label>
                  <Input
                    id="signup-store-name"
                    type="text"
                    placeholder="Enter your store name"
                    {...signUpForm.register('storeName', {
                      required: 'Store name is required'
                    })}
                  />
                  {signUpForm.formState.errors.storeName && (
                    <p className="text-sm text-destructive">{signUpForm.formState.errors.storeName.message}</p>
                  )}
                </div>

                <Collapsible open={showStoreDetails} onOpenChange={setShowStoreDetails}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-md py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                    >
                      <span>Store details (optional)</span>
                      <ChevronDown
                        className={`h-4 w-4 transition-transform duration-200 ${showStoreDetails ? 'rotate-180' : ''}`}
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <Label htmlFor="signup-store-address">Store Address</Label>
                      <Input
                        id="signup-store-address"
                        type="text"
                        placeholder="Enter your store address (optional)"
                        {...signUpForm.register('storeAddress')}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-store-phone">Store Phone Number</Label>
                      <Input
                        id="signup-store-phone"
                        type="tel"
                        placeholder="Enter your store phone number (optional)"
                        {...signUpForm.register('storePhone')}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      You can complete these details later in Store Settings.
                    </p>
                  </CollapsibleContent>
                </Collapsible>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading}
                >
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sign Up Free
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          {/* Google sign-in (shared by both tabs; hidden when not configured) */}
          <GoogleLoginButton />
        </CardContent>
        <CardFooter className="text-center">
          <p className="text-sm text-muted-foreground">
            Secure access to your laundry management system
          </p>
        </CardFooter>
      </Card>
    </div>
  );
};
