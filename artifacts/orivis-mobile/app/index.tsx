import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '@clerk/expo';
import { AuthScreen } from '@/components/AuthScreen';
import { SecureWorkspace } from '@/components/SecureWorkspace';
import { useColors } from '@/hooks/useColors';

export default function IndexScreen() {
  const colors = useColors();
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return isSignedIn ? <SecureWorkspace /> : <AuthScreen />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});