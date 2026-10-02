import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '@clerk/expo';
import { AuthScreen } from '@/components/AuthScreen';
import { SecureWorkspace } from '@/components/SecureWorkspace';
import { useDemo } from '@/context/DemoContext';
import { useColors } from '@/hooks/useColors';
import { useEffect } from 'react';

export default function IndexScreen() {
  const colors = useColors();
  const demo = useDemo();
  const { isLoaded, isSignedIn } = useAuth();
  const demoSession = demo.demoSession;
  const demoExpiresAt = demoSession ? Date.parse(demoSession.expiresAt) : 0;
  const hasValidDemoSession = !!demoSession && Number.isFinite(demoExpiresAt) && demoExpiresAt > Date.now();

  useEffect(() => {
    if (!demoSession) return;
    const delay = demoExpiresAt - Date.now();
    const timer = setTimeout(() => {
      demo.clearDemoSession();
      demo.clearUserScopedState();
    }, Math.max(0, delay));
    return () => clearTimeout(timer);
  }, [demoSession, demoExpiresAt, demo.clearDemoSession, demo.clearUserScopedState]);

  if (!isLoaded && !hasValidDemoSession) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return isSignedIn || hasValidDemoSession ? <SecureWorkspace /> : <AuthScreen />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});