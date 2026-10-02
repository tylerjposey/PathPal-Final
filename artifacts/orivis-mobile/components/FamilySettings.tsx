import { Feather } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useGetMyFamily } from '@workspace/api-client-react';
import { Button, Card, ScreenHeader } from '@/components/OrivisUI';
import { useColors } from '@/hooks/useColors';

export function FamilySettings() {
  const colors = useColors();
  const family = useGetMyFamily();

  if (family.isPending) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} /></View>;
  }

  if (family.isError) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 14, backgroundColor: colors.background }}>
        <ScreenHeader eyebrow="FAMILY" title="Family details are unavailable." subtitle="Your access is verified by the PathPal service." />
        <Button label="Try again" icon="refresh-cw" onPress={() => { void family.refetch(); }} />
      </View>
    );
  }

  const members = family.data?.members ?? [];
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 20, gap: 12 }}>
      <ScreenHeader eyebrow="FAMILY SPACE" title={family.data?.familyName ?? 'Your family'} subtitle="Details are shared only with approved family members." />
      {members.length ? members.map((member) => (
        <Card key={member.membershipId} style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
          <View style={{ width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondary }}>
            <Feather name="user" size={19} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 14 }}>{member.displayName}</Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_500Medium', fontSize: 12 }}>{member.role === 'parent' ? 'Parent / guardian' : member.status}</Text>
          </View>
        </Card>
      )) : (
        <Card tone="soft" style={{ gap: 8 }}>
          <Feather name="users" size={20} color={colors.primary} />
          <Text style={{ color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 14 }}>No members to show</Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 13 }}>Approved family members will appear here.</Text>
        </Card>
      )}
      {family.data?.invitationCode ? (
        <Card style={{ gap: 7 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold', fontSize: 11, textTransform: 'uppercase' }}>Family invitation code</Text>
          <Text selectable style={{ color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 22, letterSpacing: 1.2 }}>{family.data.invitationCode}</Text>
        </Card>
      ) : null}
      {family.data?.pendingRequests?.length ? (
        <Card tone="soft" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Feather name="clock" size={17} color={colors.primary} />
          <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 13, flex: 1 }}>{family.data.pendingRequests.length} join request{family.data.pendingRequests.length === 1 ? '' : 's'} awaiting review.</Text>
        </Card>
      ) : null}
      <Pressable accessibilityRole="button" onPress={() => { void family.refetch(); }} style={{ alignSelf: 'flex-start', minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Feather name="refresh-cw" size={14} color={colors.primary} />
        <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>Refresh family</Text>
      </Pressable>
    </ScrollView>
  );
}