import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { BrandMark, Button, Card, Chip, Field } from '@/components/OrivisUI';
import { ROLE_LABELS, type DemoUser, type Role, useDemo } from '@/context/DemoContext';
import { useColors } from '@/hooks/useColors';
import { createReportSession } from '@workspace/api-client-react';
import { clearReportSession, reportError, saveReportSession } from '@/lib/reportApi';

type AuthMode = 'signin' | 'family' | 'join';

export function AuthScreen({ onVerified }: { onVerified: (account: DemoUser) => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { authenticate, createFamily, joinFamily } = useDemo();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [role, setRole] = useState<Role | null>(null);
  const [rolePickerVisible, setRolePickerVisible] = useState(false);
  const [username, setUsername] = useState('AI4SG');
  const [password, setPassword] = useState('1234');
  const [familyName, setFamilyName] = useState('The Chen family');
  const [childName, setChildName] = useState('Maya Chen');
  const [invite, setInvite] = useState('1234');
  const [newUsername, setNewUsername] = useState('maya');
  const [newPassword, setNewPassword] = useState('1234');
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const signIn = async () => {
    if (signingIn) return;
    if (!role) {
      setError('Select an account type first.');
      return;
    }
    const account = authenticate(username, password, role);
    if (!account) {
      setError('Use AI4SG and 1234 for this prototype.');
      return;
    }
    setSigningIn(true);
    try {
      const session = await createReportSession({
        username: role === 'parent' || role === 'child' || role === 'citizen' ? 'AI4SG' : username,
        password: role === 'parent' || role === 'child' || role === 'citizen' ? '1234' : password,
        role,
      });
      await saveReportSession(session);
      setError('');
      onVerified(account);
    } catch (error) {
      const detail = reportError(error);
      if (role === 'parent' || role === 'child') {
        await clearReportSession().catch(() => undefined);
        const serviceMessage = `Report service unavailable: ${detail}. You can continue using the local family journey, check-ins, and simulated SOS; reports require a server connection.`;
        setError(serviceMessage);
        onVerified({ ...account, reportServiceUnavailable: true, reportServiceError: serviceMessage });
      } else {
        setError(detail);
      }
    } finally {
      setSigningIn(false);
    }
  };

  const registerFamily = () => {
    if (!familyName.trim() || !childName.trim() || !invite.trim()) {
      setError('Complete each family field.');
      return;
    }
    createFamily(familyName, childName, invite);
    setMode('signin');
    setRole('parent');
    setError('');
  };

  const join = () => {
    const joined = joinFamily(invite, childName, newUsername, newPassword);
    if (!joined) {
      setError('Use invitation code 1234 and complete every field.');
      return;
    }
    setUsername(newUsername);
    setPassword(newPassword);
    setRole('child');
    setMode('signin');
    setError('');
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + (Platform.OS === 'web' ? 72 : 24),
          paddingBottom: insets.bottom + 28,
        },
      ]}
      bottomOffset={60}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.brandRow}>
        <BrandMark size={48} />
        <View>
          <Text style={[styles.brand, { color: colors.foreground }]}>PathPal</Text>
          <Text style={[styles.brandSub, { color: colors.mutedForeground }]}>Move with confidence</Text>
        </View>
      </View>

      <View style={[styles.heroOrb, { backgroundColor: colors.accent }]}>
        <View style={[styles.orbit, { borderColor: colors.primary }]}>
          <View style={[styles.busIcon, { backgroundColor: colors.card }]}>
            <Feather name="navigation" size={27} color={colors.primary} />
          </View>
          <View style={[styles.familyIcon, { backgroundColor: colors.primary }]}>
            <Feather name="users" size={22} color={colors.primaryForeground} />
          </View>
        </View>
      </View>

      <Text style={[styles.heading, { color: colors.foreground }]}>
        {mode === 'signin' ? 'A safer way to get there.' : mode === 'family' ? 'Create your family circle.' : 'Join your family circle.'}
      </Text>
      <Text style={[styles.lead, { color: colors.mutedForeground }]}>
        {mode === 'signin'
          ? 'Coordinate bus journeys, improve your neighborhood, and practice family safety in one calm place.'
          : mode === 'family'
            ? 'A parent starts the family and creates an invitation code for their child.'
            : 'Use a valid invitation code, then create the child’s own demo sign-in.'}
      </Text>

      <Card style={styles.formCard}>
        <Text style={[styles.formTitle, { color: colors.foreground }]}>Select Account Type</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={role ? `Account type: ${ROLE_LABELS[role]}` : 'Select an account type'}
          testID="select-account-type"
          onPress={() => setRolePickerVisible(true)}
          style={({ pressed }) => [
            styles.roleSelect,
            {
              backgroundColor: colors.card,
              borderColor: role ? colors.primary : colors.border,
              opacity: pressed ? 0.78 : 1,
            },
          ]}
        >
          <Feather name={role ? 'user-check' : 'users'} size={19} color={role ? colors.primary : colors.mutedForeground} />
          <Text style={[styles.roleSelectText, { color: role ? colors.foreground : colors.mutedForeground }]}>
            {role ? ROLE_LABELS[role] : 'Choose an account type'}
          </Text>
          {role ? <Feather name="check-circle" size={17} color={colors.primary} /> : null}
          <Feather name="chevron-down" size={17} color={colors.mutedForeground} />
        </Pressable>
        {role ? (
          <View style={[styles.roleHint, { backgroundColor: colors.muted }]}>
            <Feather name="info" size={14} color={colors.primary} />
            <Text style={[styles.roleHintText, { color: colors.mutedForeground }]}>
              {role === 'parent'
                ? 'Parents can sign in or create a family account.'
                : role === 'child'
                  ? 'Children can sign in or join a family with an invitation code.'
                  : 'This account type uses the existing city or community sign-in flow.'}
            </Text>
          </View>
        ) : null}
        {role ? (
          <View style={styles.modeRow}>
            <Chip label="Sign in" active={mode === 'signin'} onPress={() => { setMode('signin'); setError(''); }} />
            {role === 'parent' ? (
              <Chip label="Create family" active={mode === 'family'} onPress={() => { setMode('family'); setError(''); }} />
            ) : null}
            {role === 'child' ? (
              <Chip label="Join family" active={mode === 'join'} onPress={() => { setMode('join'); setError(''); }} />
            ) : null}
          </View>
        ) : null}

        {mode === 'signin' ? (
          <>
            <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" testID="username" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry testID="password" />
            {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
            <Button label="Continue securely" icon="arrow-right" onPress={() => { void signIn(); }} loading={signingIn} testID="continue-signin" />
            <View style={[styles.demoNote, { backgroundColor: colors.muted }]}>
              <Feather name="info" size={15} color={colors.primary} />
              <Text style={[styles.demoText, { color: colors.mutedForeground }]}>
                Shared prototype identities: AI4SG · 1234 · verification 1234. Demo accounts are not securely isolated.
              </Text>
            </View>
          </>
        ) : mode === 'family' ? (
          <>
            <Text style={[styles.formTitle, { color: colors.foreground }]}>Parent registration</Text>
            <Field label="Family name" value={familyName} onChangeText={setFamilyName} />
            <Field label="Child’s name" value={childName} onChangeText={setChildName} />
            <Field label="Child invitation code" value={invite} onChangeText={setInvite} keyboardType="number-pad" />
            {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
            <Button label="Create family account" icon="users" onPress={registerFamily} />
          </>
        ) : (
          <>
            <Text style={[styles.formTitle, { color: colors.foreground }]}>Child invitation</Text>
            <Field label="Invitation code" value={invite} onChangeText={setInvite} keyboardType="number-pad" />
            <Field label="Your name" value={childName} onChangeText={setChildName} />
            <Field label="Create username" value={newUsername} onChangeText={setNewUsername} autoCapitalize="none" />
            <Field label="Create password" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
            {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
            <Button label="Join family" icon="user-check" onPress={join} />
          </>
        )}
      </Card>

      <View style={styles.disclaimer}>
        <Feather name="shield" size={15} color={colors.mutedForeground} />
        <Text style={[styles.disclaimerText, { color: colors.mutedForeground }]}>
          Prototype simulation. Not an emergency service or a replacement for trusted adults and local emergency resources.
        </Text>
      </View>
      <Modal
        visible={rolePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRolePickerVisible(false)}
      >
        <View style={styles.roleModalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close account type selection"
            onPress={() => setRolePickerVisible(false)}
            style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10, 25, 34, 0.48)' }]}
          />
          <View style={[styles.roleSheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 18 }]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.formTitle, { color: colors.foreground }]}>Select Account Type</Text>
            <Text style={[styles.roleSheetSubtitle, { color: colors.mutedForeground }]}>
              Choose the account flow you want to use.
            </Text>
            {(Object.keys(ROLE_LABELS) as Role[]).map((item) => {
              const selected = role === item;
              const icon = item === 'parent'
                ? 'users'
                : item === 'child'
                  ? 'smile'
                  : item === 'citizen'
                    ? 'user'
                    : item === 'manager'
                      ? 'clipboard'
                      : 'tool';
              return (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  testID={`role-${item}`}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setRole(item);
                    setMode('signin');
                    setRolePickerVisible(false);
                    setError('');
                  }}
                  style={[
                    styles.roleOption,
                    {
                      backgroundColor: selected ? colors.secondary : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Feather name={icon} size={18} color={selected ? colors.primary : colors.mutedForeground} />
                  <Text style={[styles.roleOptionText, { color: colors.foreground }]}>{ROLE_LABELS[item]}</Text>
                  {selected ? <Feather name="check-circle" size={17} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, alignItems: 'stretch' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brand: { fontFamily: 'Inter_700Bold', fontSize: 24, letterSpacing: -0.6 },
  brandSub: { fontFamily: 'Inter_500Medium', fontSize: 11, marginTop: 1 },
  heroOrb: { alignSelf: 'center', width: 174, height: 174, borderRadius: 87, marginTop: 32, marginBottom: 25, alignItems: 'center', justifyContent: 'center' },
  orbit: { width: 122, height: 122, borderRadius: 61, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-10deg' }] },
  busIcon: { width: 64, height: 64, borderRadius: 24, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '10deg' }] },
  familyIcon: { position: 'absolute', right: -10, bottom: 12, width: 45, height: 45, borderRadius: 18, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '10deg' }] },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 32, lineHeight: 38, letterSpacing: -1.1, maxWidth: 330 },
  lead: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 23, marginTop: 10, marginBottom: 22, maxWidth: 350 },
  formCard: { gap: 15 },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  formTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, marginTop: 2 },
  roleSelect: { minHeight: 54, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  roleSelectText: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  roleHint: { borderRadius: 14, padding: 11, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  roleHintText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 16 },
  roleModalRoot: { flex: 1, justifyContent: 'flex-end' },
  roleSheet: { borderTopLeftRadius: 25, borderTopRightRadius: 25, borderWidth: 1, paddingHorizontal: 20, paddingTop: 12, gap: 9 },
  sheetHandle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginBottom: 5 },
  roleSheetSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, marginBottom: 3 },
  roleOption: { minHeight: 51, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  roleOptionText: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  error: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  demoNote: { borderRadius: 14, padding: 12, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  demoText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 16 },
  disclaimer: { flexDirection: 'row', gap: 8, marginTop: 20, paddingHorizontal: 8 },
  disclaimerText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 17 },
});