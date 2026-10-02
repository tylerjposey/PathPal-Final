import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AuthScreen } from '@/components/AuthScreen';
import { MainScreen } from '@/components/MainScreen';
import { type DemoUser, useDemo } from '@/context/DemoContext';
import { useColors } from '@/hooks/useColors';

export default function IndexScreen() {
  const colors = useColors();
  const { state, hydrated } = useDemo();
  const [pendingAccount, setPendingAccount] = useState<DemoUser | null>(null);

  if (!hydrated) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!state.account && !pendingAccount) {
    return <AuthScreen onVerified={setPendingAccount} />;
  }

  return (
    <MainScreen
      verificationAccount={pendingAccount}
      onVerified={() => setPendingAccount(null)}
    />
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});