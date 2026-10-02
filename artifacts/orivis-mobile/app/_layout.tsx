import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ClerkLoaded, ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { StatusBar } from 'expo-status-bar';
import { DemoProvider } from '@/context/DemoContext';
import { ThemeProvider, useThemePreference } from '@/context/ThemeContext';
import { useColors } from '@/hooks/useColors';
import { setBaseUrl } from '@workspace/api-client-react';
import Constants from 'expo-constants';
import '@/lib/locationTask';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();
const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);
const publishableKey =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  Constants.expoConfig?.extra?.clerkPublishableKey;
if (!publishableKey) {
  throw new Error('Missing Clerk publishable key for PathPal live tracking.');
}
const proxyUrl =
  process.env.EXPO_PUBLIC_CLERK_PROXY_URL ||
  Constants.expoConfig?.extra?.clerkProxyUrl ||
  undefined;

function RootLayoutNav() {
  const { isDarkMode } = useThemePreference();
  const colors = useColors();

  useEffect(() => {
    if (Platform.OS === 'web') return;
    void SystemUI.setBackgroundColorAsync(colors.background).catch((error) => {
      console.warn('Could not update the system UI background color.', error);
    });
  }, [colors.background]);

  return (
    <>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      tokenCache={tokenCache}
      proxyUrl={proxyUrl}
    >
      <ClerkLoaded>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <ErrorBoundary>
                <GestureHandlerRootView>
                  <KeyboardProvider>
                    <DemoProvider>
                      <RootLayoutNav />
                    </DemoProvider>
                  </KeyboardProvider>
                </GestureHandlerRootView>
              </ErrorBoundary>
            </ThemeProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}
