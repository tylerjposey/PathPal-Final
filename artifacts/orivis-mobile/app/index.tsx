import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useClerk, useUser } from '@clerk/expo';
import { useGetReportAccess } from '@workspace/api-client-react';
import { AuthScreen } from '@/components/AuthScreen';
import { MainScreen } from '@/components/MainScreen';
import { type Role, useDemo } from '@/context/DemoContext';
import { useColors } from '@/hooks/useColors';
import { reportError } from '@/lib/reportApi';
import { Button, Card } from '@/components/OrivisUI';

export default function IndexScreen() {
  const colors = useColors();
  const { state, hydrated, setAccount } = useDemo();
  const { isLoaded, isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const accessQuery = useGetReportAccess({
    query: {
      queryKey: ['report-access', user?.id ?? 'signed-out'],
      enabled: isLoaded && Boolean(isSignedIn && user?.id),
    },
  });

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user || !accessQuery.data) {
      if (isLoaded && !isSignedIn) setAccount(null);
      return;
    }
    const role: Role = accessQuery.data.role === 'manager'
      ? 'manager'
      : accessQuery.data.role === 'worker'
        ? 'worker'
        : 'parent';
    const email = user.primaryEmailAddress?.emailAddress;
    setAccount({
      role,
      username: email ?? user.id,
      name: user.fullName ?? user.firstName ?? email ?? 'Orivis member',
    });
  }, [accessQuery.data, isLoaded, isSignedIn, setAccount, user]);

  if (!isLoaded || !hydrated) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!isSignedIn) {
    return <AuthScreen />;
  }

  if (accessQuery.isError) {
    return (
      <View style={[styles.accessError, { backgroundColor: colors.background }]}>
        <Card style={styles.errorCard}>
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>Report access unavailable</Text>
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>{reportError(accessQuery.error)}</Text>
          <Button label="Try again" icon="refresh-cw" onPress={() => { void accessQuery.refetch(); }} />
          <Button label="Sign out" icon="log-out" onPress={() => { void signOut(); }} />
        </Card>
      </View>
    );
  }

  if (!accessQuery.data || !state.account) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <MainScreen
      verificationAccount={null}
      onVerified={() => undefined}
    />
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  accessError: { flex: 1, justifyContent: 'center', padding: 20 },
  errorCard: { gap: 14 },
  errorTitle: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
});