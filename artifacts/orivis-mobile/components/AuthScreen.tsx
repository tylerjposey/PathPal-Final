import { Feather } from '@expo/vector-icons';
import { useSignIn, useSignUp, useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createReportSession } from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { BrandMark, Button, Card } from '@/components/OrivisUI';
import { useDemo, type Role } from '@/context/DemoContext';
import { useColors } from '@/hooks/useColors';

WebBrowser.maybeCompleteAuthSession();

type AuthMode = 'signin' | 'signup';
type SignInMethod = 'demo' | 'email';
type SignUpRole = 'parent' | 'child';

const DEMO_ROLES: { value: Role; label: string }[] = [
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
  { value: 'manager', label: 'Case Manager' },
  { value: 'worker', label: 'Worker' },
];

export function AuthScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const demo = useDemo();
  const { signIn, errors: signInErrors, fetchStatus: signInFetchStatus } = useSignIn();
  const { signUp, errors: signUpErrors, fetchStatus: signUpFetchStatus } = useSignUp();
  const { startSSOFlow } = useSSO();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [signInMethod, setSignInMethod] = useState<SignInMethod>(__DEV__ ? 'demo' : 'email');
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [demoUsername, setDemoUsername] = useState('AI4SG');
  const [demoPassword, setDemoPassword] = useState('1234');
  const [demoCode, setDemoCode] = useState('1234');
  const [demoBusy, setDemoBusy] = useState(false);
  const [signupRole, setSignupRole] = useState<SignUpRole>('parent');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [familyCode, setFamilyCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [verificationPending, setVerificationPending] = useState(false);
  const [busyGoogle, setBusyGoogle] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);

  const demoEnabled = __DEV__;
  const busy = signInFetchStatus === 'fetching' || signUpFetchStatus === 'fetching' || busyGoogle || demoBusy;
  const clerkError = mode === 'signin' && signInMethod === 'demo'
    ? ''
    : mode === 'signin'
      ? signInErrors.fields.identifier?.message ?? signInErrors.fields.password?.message
      : signUpErrors.fields.emailAddress?.message ?? signUpErrors.fields.password?.message ?? signUpErrors.fields.code?.message;

  const submitEmail = async () => {
    setError('');
    try {
      if (mode === 'signin') {
        const result = await signIn.password({ emailAddress: email.trim(), password });
        if (result.error) { setError(result.error.message); return; }
        if (signIn.status === 'complete') {
          await signIn.finalize({ navigate: () => undefined });
        } else if (signIn.status === 'needs_client_trust') {
          const factor = signIn.supportedSecondFactors.find((item) => item.strategy === 'email_code');
          if (factor) await signIn.mfa.sendEmailCode();
          setVerificationPending(true);
        } else if (signIn.status === 'needs_second_factor') {
          setError('This account needs another verification method. Contact your administrator for access.');
        } else {
          setError('Sign-in needs another step. Please try again or use Google sign-in.');
        }
      } else {
        const result = await signUp.password({
          emailAddress: email.trim(),
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        });
        if (result.error) { setError(result.error.message); return; }
        demo.setPendingSignUp({
          role: signupRole,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phoneNumber: signupRole === 'child' ? phoneNumber.trim() : '',
          familyCode: signupRole === 'child' ? familyCode.trim().toUpperCase() : '',
        });
        const sent = await signUp.verifications.sendEmailCode();
        if (sent.error) { setError(sent.error.message); return; }
        setVerificationPending(true);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Authentication could not be completed.');
    }
  };

  const submitDemo = async () => {
    setError('');
    if (!selectedRole) {
      setError('Choose a role to continue.');
      return;
    }
    setDemoBusy(true);
    try {
      const session = await createReportSession({
        username: demoUsername.trim(),
        password: demoPassword,
        role: selectedRole,
        verificationCode: demoCode.trim(),
      });
      demo.setDemoSession(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Demo sign-in could not be completed.');
    } finally {
      setDemoBusy(false);
    }
  };

  const verify = async () => {
    setError('');
    try {
      if (mode === 'signin') {
        const result = await signIn.mfa.verifyEmailCode({ code: code.trim() });
        if (result.error) { setError(result.error.message); return; }
        if (signIn.status === 'complete') await signIn.finalize({ navigate: () => undefined });
        else setError('The verification code did not complete sign-in.');
      } else {
        const result = await signUp.verifications.verifyEmailCode({ code: code.trim() });
        if (result.error) { setError(result.error.message); return; }
        if (signUp.status === 'complete') await signUp.finalize({ navigate: () => undefined });
        else setError('The verification code did not complete account setup.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The verification code could not be checked.');
    }
  };

  const google = async () => {
    setError('');
    setBusyGoogle(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId, navigate: () => undefined });
      } else {
        setError('Google sign-in needs an additional step that is not available here.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Google sign-in could not be completed.');
    } finally {
      setBusyGoogle(false);
    }
  };

  const selectedRoleLabel = DEMO_ROLES.find((option) => option.value === selectedRole)?.label ?? 'Select a role';

  return (
    <KeyboardAwareScrollViewCompat
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 24), paddingBottom: insets.bottom + 24 }]}
      bottomOffset={64}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.brandRow}>
        <BrandMark size={46} />
        <View>
          <Text style={[styles.brand, { color: colors.foreground }]}>PathPal</Text>
          <Text style={[styles.brandSub, { color: colors.mutedForeground }]}>Safer trips. Stronger neighborhoods.</Text>
        </View>
      </View>
      <View style={[styles.heroMark, { backgroundColor: colors.accent }]}>
        <View style={[styles.heroInner, { borderColor: colors.primary }]}>
          <Feather name="map-pin" size={34} color={colors.primary} />
          <View style={[styles.heroDot, { backgroundColor: colors.success, borderColor: colors.accent }]} />
        </View>
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>
        {verificationPending ? 'Check your inbox.' : mode === 'signup' ? 'Create your PathPal account.' : signInMethod === 'demo' && demoEnabled ? 'Choose your PathPal role.' : 'Your family’s safe route starts here.'}
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        {verificationPending
          ? `Enter the verification code sent to ${email}.`
          : mode === 'signin' && signInMethod === 'demo' && demoEnabled
            ? 'Use the shared preview account to open the Parent, Child, Case Manager, or Worker workspace.'
            : 'A trusted space for family travel, local reports, and the people working to make things better.'}
      </Text>
      <Card style={styles.form}>
        {!verificationPending ? (
          <>
            <View style={styles.switchRow}>
              {(['signin', 'signup'] as AuthMode[]).map((item) => (
                <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: mode === item }} onPress={() => { setMode(item); setError(''); setRoleMenuOpen(false); }} style={[styles.modeButton, { backgroundColor: mode === item ? colors.primary : colors.muted }]}>
                  <Text style={[styles.modeText, { color: mode === item ? colors.primaryForeground : colors.mutedForeground }]}>{item === 'signin' ? 'Sign in' : 'Create account'}</Text>
                </Pressable>
              ))}
            </View>
            {mode === 'signin' && demoEnabled ? (
              <View style={styles.methodRow}>
                {(['demo', 'email'] as SignInMethod[]).map((method) => (
                  <Pressable
                    key={method}
                    accessibilityRole="button"
                    accessibilityState={{ selected: signInMethod === method }}
                    onPress={() => { setSignInMethod(method); setError(''); setRoleMenuOpen(false); }}
                    style={[styles.methodButton, { backgroundColor: signInMethod === method ? colors.secondary : colors.card, borderColor: colors.border }]}
                  >
                    <Text style={[styles.modeText, { color: signInMethod === method ? colors.primary : colors.mutedForeground }]}>{method === 'demo' ? 'Role demo' : 'Email account'}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {mode === 'signin' && signInMethod === 'demo' && demoEnabled ? (
              <>
                <View style={styles.inputGroup}>
                  <Text style={[styles.label, { color: colors.foreground }]}>Sign in as</Text>
                  <Pressable
                    testID="select-demo-role"
                    accessibilityRole="button"
                    accessibilityLabel={`Role: ${selectedRoleLabel}`}
                    accessibilityState={{ expanded: roleMenuOpen }}
                    onPress={() => setRoleMenuOpen((open) => !open)}
                    style={({ pressed }) => [styles.roleSelect, { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.78 : 1 }]}
                  >
                    <Text style={[styles.roleSelectText, { color: selectedRole ? colors.foreground : colors.mutedForeground }]}>{selectedRoleLabel}</Text>
                    <Feather name={roleMenuOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
                  </Pressable>
                  {roleMenuOpen ? (
                    <View style={[styles.roleMenu, { borderColor: colors.border, backgroundColor: colors.card }]}>
                      {DEMO_ROLES.map((option) => (
                        <Pressable
                          key={option.value}
                          testID={`demo-role-${option.value}`}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: selectedRole === option.value }}
                          onPress={() => { setSelectedRole(option.value); setRoleMenuOpen(false); setError(''); }}
                          style={({ pressed }) => [styles.roleOption, { backgroundColor: selectedRole === option.value ? colors.secondary : 'transparent', opacity: pressed ? 0.72 : 1 }]}
                        >
                          <Text style={[styles.roleOptionText, { color: colors.foreground }]}>{option.label}</Text>
                          {selectedRole === option.value ? <Feather name="check" size={17} color={colors.primary} /> : null}
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
                <Input label="Demo username" value={demoUsername} onChangeText={setDemoUsername} placeholder="Username" autoCapitalize="none" />
                <Input label="Password" value={demoPassword} onChangeText={setDemoPassword} placeholder="Password" secureTextEntry autoComplete="current-password" />
                <Input label="Two-step verification code" value={demoCode} onChangeText={setDemoCode} placeholder="Enter code" keyboardType="number-pad" autoComplete="one-time-code" />
                <Text style={[styles.helperText, { color: colors.mutedForeground }]}>This is shared preview data, separate from private email accounts.</Text>
                {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
                <Button label={selectedRole ? `Sign in as ${selectedRoleLabel}` : 'Choose a role'} icon="log-in" loading={demoBusy} disabled={!selectedRole || !demoUsername.trim() || !demoPassword || !demoCode.trim() || demoBusy} onPress={() => { void submitDemo(); }} testID="demo-auth-submit" />
              </>
            ) : mode === 'signup' ? (
              <>
                <Text style={[styles.label, { color: colors.foreground }]}>Create a</Text>
                <View style={styles.methodRow}>
                  {(['parent', 'child'] as SignUpRole[]).map((role) => (
                    <Pressable
                      key={role}
                      accessibilityRole="button"
                      accessibilityState={{ selected: signupRole === role }}
                      onPress={() => { setSignupRole(role); setError(''); }}
                      style={[styles.methodButton, { backgroundColor: signupRole === role ? colors.secondary : colors.card, borderColor: colors.border }]}
                    >
                      <Text style={[styles.modeText, { color: signupRole === role ? colors.primary : colors.mutedForeground }]}>{role === 'parent' ? 'Parent account' : 'Child account'}</Text>
                    </Pressable>
                  ))}
                </View>
                <Input label="First name" value={firstName} onChangeText={setFirstName} placeholder="First name" autoCapitalize="words" autoComplete="given-name" />
                <Input label="Last name" value={lastName} onChangeText={setLastName} placeholder="Last name" autoCapitalize="words" autoComplete="family-name" />
                {signupRole === 'child' ? (
                  <>
                    <Input label="Phone number" value={phoneNumber} onChangeText={setPhoneNumber} placeholder="Phone number" keyboardType="phone-pad" autoComplete="tel" />
                    <Input label="Family code" value={familyCode} onChangeText={setFamilyCode} placeholder="Enter your parent's family code" autoCapitalize="none" />
                    <Text style={[styles.helperText, { color: colors.mutedForeground }]}>The phone number is contact information; sign-in uses your email.</Text>
                  </>
                ) : null}
                <Input label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
                <Input label="Password" value={password} onChangeText={setPassword} placeholder="Create a password" secureTextEntry autoComplete="new-password" />
                {clerkError ? <Text style={[styles.error, { color: colors.destructive }]}>{clerkError}</Text> : null}
                {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
                <Button label="Create account" icon="arrow-right" loading={busy} disabled={!firstName.trim() || !lastName.trim() || !email.trim() || !password || (signupRole === 'child' && (!phoneNumber.trim() || !familyCode.trim())) || busy} onPress={() => { void submitEmail(); }} testID="email-auth-submit" />
              </>
            ) : (
              <>
                <Input label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
                <Input label="Password" value={password} onChangeText={setPassword} placeholder="Enter your password" secureTextEntry autoComplete="current-password" />
                {clerkError ? <Text style={[styles.error, { color: colors.destructive }]}>{clerkError}</Text> : null}
                {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
                <Button label="Continue securely" icon="arrow-right" loading={busy} disabled={!email.trim() || !password || busy} onPress={() => { void submitEmail(); }} testID="email-auth-submit" />
                <View style={styles.separator}>
                  <View style={[styles.rule, { backgroundColor: colors.border }]} />
                  <Text style={[styles.orText, { color: colors.mutedForeground }]}>OR</Text>
                  <View style={[styles.rule, { backgroundColor: colors.border }]} />
                </View>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void google(); }} style={({ pressed }) => [styles.googleButton, { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed || busy ? 0.68 : 1 }]}>
                  <Feather name="globe" size={18} color={colors.foreground} />
                  <Text style={[styles.googleText, { color: colors.foreground }]}>Continue with Google</Text>
                </Pressable>
              </>
            )}
          </>
        ) : (
          <>
            <Input label="Email verification code" value={code} onChangeText={setCode} placeholder="Enter code" keyboardType="number-pad" autoComplete="one-time-code" />
            {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
            <Button label="Verify email" icon="check" loading={busy} disabled={!code.trim() || busy} onPress={() => { void verify(); }} testID="verify-email" />
            <Pressable onPress={() => { setVerificationPending(false); setError(''); }} style={styles.backLink}>
              <Text style={[styles.backText, { color: colors.primary }]}>Back to sign in</Text>
            </Pressable>
          </>
        )}
      </Card>
      <View style={styles.privacyLine}>
        <Feather name="lock" size={14} color={colors.primary} />
        <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>Your reports and family details are shown only to authorized people.</Text>
      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

function Input(props: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; keyboardType?: 'email-address' | 'number-pad' | 'phone-pad'; secureTextEntry?: boolean; autoCapitalize?: 'none' | 'words'; autoComplete?: 'email' | 'current-password' | 'new-password' | 'one-time-code' | 'given-name' | 'family-name' | 'tel' }) {
  const colors = useColors();
  return (
    <View style={styles.inputGroup}>
      <Text style={[styles.label, { color: colors.foreground }]}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={props.keyboardType}
        secureTextEntry={props.secureTextEntry}
        autoCapitalize={props.autoCapitalize}
        autoComplete={props.autoComplete}
        style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 22, alignItems: 'stretch' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brand: { fontFamily: 'Inter_700Bold', fontSize: 23, letterSpacing: -0.5 },
  brandSub: { fontFamily: 'Inter_500Medium', fontSize: 11, marginTop: 2 },
  heroMark: { alignSelf: 'center', width: 134, height: 134, borderRadius: 67, alignItems: 'center', justifyContent: 'center', marginTop: 32, marginBottom: 26 },
  heroInner: { width: 96, height: 96, borderRadius: 48, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  heroDot: { position: 'absolute', width: 15, height: 15, borderRadius: 8, right: 1, top: 12, borderWidth: 3 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, lineHeight: 36, letterSpacing: -0.8, maxWidth: 350 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: 10, marginBottom: 21 },
  form: { gap: 15, padding: 17 },
  switchRow: { flexDirection: 'row', gap: 8 },
  methodRow: { flexDirection: 'row', gap: 8 },
  methodButton: { flex: 1, minHeight: 42, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  modeButton: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 42, borderRadius: 13 },
  modeText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  inputGroup: { gap: 7 },
  roleSelect: { minHeight: 50, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roleSelectText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
  roleMenu: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  roleOption: { minHeight: 46, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roleOptionText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  input: { height: 50, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontFamily: 'Inter_400Regular', fontSize: 14 },
  helperText: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
  error: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17 },
  separator: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  orText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 1.3 },
  googleButton: { minHeight: 50, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  googleText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  backLink: { alignSelf: 'center', paddingVertical: 3 },
  backText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  privacyLine: { marginTop: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingHorizontal: 10 },
  privacyText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
});