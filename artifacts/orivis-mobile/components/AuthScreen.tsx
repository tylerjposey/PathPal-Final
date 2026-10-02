import { Feather } from '@expo/vector-icons';
import { useSignIn, useSignUp, useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createPhoneReportSession, createReportSession } from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { BrandMark, Button, Card } from '@/components/OrivisUI';
import { useDemo, type Role } from '@/context/DemoContext';
import { useColors } from '@/hooks/useColors';

WebBrowser.maybeCompleteAuthSession();

type AuthMode = 'signin' | 'signup';
type SignInMethod = 'demo' | 'email';
type SignUpPath = 'choose' | 'parent-email' | 'parent-phone' | 'child-email';
type VerificationStep = 'demo-username' | 'demo-phone-signin' | 'demo-phone-signup' | 'email-signin' | 'email-signup' | null;

const DEMO_PHONE_NUMBER = '4088877754';
const DEMO_ROLES: { value: Role; label: string }[] = [
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
  { value: 'manager', label: 'Case Manager' },
  { value: 'worker', label: 'City Worker' },
];

function normalizePhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function looksLikePhoneNumber(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && /^[+\d\s().-]+$/.test(value);
}

export function AuthScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const demo = useDemo();
  const { signIn, errors: signInErrors, fetchStatus: signInFetchStatus } = useSignIn();
  const { signUp, errors: signUpErrors, fetchStatus: signUpFetchStatus } = useSignUp();
  const { startSSOFlow } = useSSO();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [signInMethod, setSignInMethod] = useState<SignInMethod>(__DEV__ ? 'demo' : 'email');
  const [selectedRole, setSelectedRole] = useState<Role>('parent');
  const [verificationRole, setVerificationRole] = useState<Role>('parent');
  const [identifier, setIdentifier] = useState('AI4SG');
  const [usernamePassword, setUsernamePassword] = useState('1234');
  const [phoneNumber, setPhoneNumber] = useState(DEMO_PHONE_NUMBER);
  const [demoBusy, setDemoBusy] = useState(false);
  const [signupPath, setSignupPath] = useState<SignUpPath>('choose');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [familyCode, setFamilyCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [verificationStep, setVerificationStep] = useState<VerificationStep>(null);
  const [busyGoogle, setBusyGoogle] = useState(false);
  const [error, setError] = useState('');
  const phoneInput = mode === 'signin' && signInMethod === 'demo'
    ? looksLikePhoneNumber(identifier)
    : signupPath === 'parent-phone';
  const demoVerification = verificationStep !== null && verificationStep.startsWith('demo-');

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);

  const demoEnabled = __DEV__;
  const busy = signInFetchStatus === 'fetching' || signUpFetchStatus === 'fetching' || busyGoogle || demoBusy;
  const selectedRoleLabel = DEMO_ROLES.find(({ value }) => value === selectedRole)?.label ?? 'Parent';
  const verificationRoleLabel = DEMO_ROLES.find(({ value }) => value === verificationRole)?.label ?? 'Parent';
  const clerkError = mode === 'signin'
    ? signInErrors.fields.identifier?.message ?? signInErrors.fields.password?.message
    : signUpErrors.fields.emailAddress?.message ?? signUpErrors.fields.password?.message ?? signUpErrors.fields.code?.message;

  const startDemoSignIn = () => {
    setError('');
    if (looksLikePhoneNumber(identifier)) {
      if (normalizePhoneNumber(identifier) !== DEMO_PHONE_NUMBER) {
        setError('Phone sign-in is a preview flow. Use the demo number shown below.');
        return;
      }
      setPhoneNumber(identifier.trim());
      setVerificationRole(selectedRole);
      setCode('1234');
      setVerificationStep('demo-phone-signin');
      return;
    }
    if (identifier.trim().toLowerCase() !== 'ai4sg') {
      setError('Only the AI4SG demo supports username sign-in. Real accounts use Clerk email or Google.');
      return;
    }
    if (!usernamePassword) {
      setError('Enter the demo password to continue.');
      return;
    }
    setVerificationRole(selectedRole);
    setCode('1234');
    setVerificationStep('demo-username');
  };

  const startPhoneSignup = () => {
    setError('');
    if (normalizePhoneNumber(phoneNumber) !== DEMO_PHONE_NUMBER) {
      setError('Phone registration is a preview flow. Use the demo number shown below.');
      return;
    }
    setVerificationRole('parent');
    setCode('1234');
    setVerificationStep('demo-phone-signup');
  };

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
          setVerificationStep('email-signin');
        } else if (signIn.status === 'needs_second_factor') {
          setError('This account needs another verification method. Contact your administrator for access.');
        } else {
          setError('Sign-in needs another step. Please try again or use Google sign-in.');
        }
      } else {
        const role = signupPath === 'child-email' ? 'child' : 'parent';
        const result = await signUp.password({
          emailAddress: email.trim(),
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        });
        if (result.error) { setError(result.error.message); return; }
        demo.setPendingSignUp({
          role,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          familyCode: role === 'child' ? familyCode.trim().toUpperCase() : '',
        });
        const sent = await signUp.verifications.sendEmailCode();
        if (sent.error) { setError(sent.error.message); return; }
        setVerificationStep('email-signup');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Authentication could not be completed.');
    }
  };

  const verifyDemoCode = async () => {
    setError('');
    if (!/^\d{4}$/.test(code.trim())) {
      setError('Enter the four-digit verification code.');
      return;
    }
    setDemoBusy(true);
    try {
      const session = verificationStep === 'demo-username'
        ? await createReportSession({
          username: identifier.trim(),
          password: usernamePassword,
          role: verificationRole,
          verificationCode: code.trim(),
        })
        : await createPhoneReportSession({ phoneNumber: phoneNumber.trim(), role: verificationRole, verificationCode: code.trim() });
      demo.setDemoSession(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Demo verification could not be completed.');
    } finally {
      setDemoBusy(false);
    }
  };

  const verifyEmailCode = async () => {
    setError('');
    try {
      if (verificationStep === 'email-signin') {
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
        {verificationStep
          ? demoVerification ? `Verify your ${verificationRoleLabel} demo sign-in.` : 'Check your inbox.'
          : mode === 'signup'
            ? signupPath === 'choose' ? 'Create a PathPal account.' : signupPath === 'parent-phone' ? 'Verify your phone (demo).' : 'Create your PathPal account.'
            : signInMethod === 'demo' && demoEnabled ? 'Choose your PathPal role.' : 'Your family’s safe route starts here.'}
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        {verificationStep
          ? demoVerification
            ? 'Enter the simulated four-digit code. No SMS is sent; the demo code is 1234.'
            : `Enter the email verification code sent to ${email}.`
          : mode === 'signup' && signupPath === 'choose'
            ? 'Choose email for a real Clerk account, or phone for the shared Parent demo.'
            : mode === 'signup' && signupPath === 'parent-phone'
              ? 'This simulated phone flow opens the shared Parent demo; it does not create a real account.'
              : mode === 'signup' && signupPath === 'child-email'
                ? 'Real Child accounts use Clerk email verification and a family invitation code. No phone number is collected.'
                : mode === 'signin' && signInMethod === 'demo' && demoEnabled
                  ? 'Choose Child, Parent, Case Manager, or City Worker, then sign in to that development demo.'
                  : 'A trusted space for family travel, local reports, and the people working to make things better.'}
      </Text>
      <Card style={styles.form}>
        {!verificationStep ? (
          <>
            <View style={styles.switchRow}>
              {(['signin', 'signup'] as AuthMode[]).map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === item }}
                  onPress={() => {
                    setMode(item);
                    setError('');
                    setVerificationStep(null);
                    if (item === 'signup') setSignupPath('choose');
                  }}
                  style={[styles.modeButton, { backgroundColor: mode === item ? colors.primary : colors.muted }]}
                >
                  <Text style={[styles.modeText, { color: mode === item ? colors.primaryForeground : colors.mutedForeground }]}>{item === 'signin' ? 'Sign in' : 'Create account'}</Text>
                </Pressable>
              ))}
            </View>
            {mode === 'signin' && signInMethod === 'demo' && demoEnabled ? (
              <>
                <Text style={[styles.label, { color: colors.foreground }]}>Sign in to a role</Text>
                <View style={styles.roleGrid}>
                  {DEMO_ROLES.map((role) => {
                    const selected = selectedRole === role.value;
                    return (
                      <Pressable
                        key={role.value}
                        accessibilityRole="button"
                        accessibilityLabel={`Sign in to the ${role.label} role`}
                        accessibilityState={{ selected }}
                        onPress={() => { setSelectedRole(role.value); setError(''); }}
                        style={({ pressed }) => [
                          styles.roleChoice,
                          {
                            borderColor: selected ? colors.primary : colors.border,
                            backgroundColor: selected ? colors.secondary : colors.card,
                            opacity: pressed ? 0.76 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.roleChoiceLabel, { color: selected ? colors.primary : colors.foreground }]}>{role.label}</Text>
                        {selected ? <Feather name="check" size={16} color={colors.primary} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
                <Input label="Username or phone number" value={identifier} onChangeText={(value) => { setIdentifier(value); setError(''); }} placeholder="AI4SG or 408 887 7754" autoCapitalize="none" />
                {!phoneInput ? <Input label="Password" value={usernamePassword} onChangeText={setUsernamePassword} placeholder="Demo password" secureTextEntry autoComplete="current-password" /> : null}
                {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
                <Button
                  label={phoneInput ? 'Send demo code' : `Continue as ${selectedRoleLabel}`}
                  icon="arrow-right"
                  loading={demoBusy}
                  disabled={!identifier.trim() || (!phoneInput && !usernamePassword) || busy}
                  onPress={startDemoSignIn}
                  testID="demo-auth-submit"
                />
                <View style={[styles.demoCredentials, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.demoCredentialsTitle, { color: colors.foreground }]}>Development demo</Text>
                  <Text style={[styles.helperText, { color: colors.mutedForeground }]}>Username: AI4SG · Password: 1234 · Code: 1234</Text>
                  <Text style={[styles.helperText, { color: colors.mutedForeground }]}>Phone: 4088877754 · Code: 1234. This is simulated; no SMS is sent.</Text>
                </View>
                <Pressable onPress={() => { setSignInMethod('email'); setError(''); }} style={styles.backLink}>
                  <Text style={[styles.backText, { color: colors.primary }]}>Use an existing email or Google account</Text>
                </Pressable>
              </>
            ) : mode === 'signin' ? (
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
                {demoEnabled ? (
                  <Pressable onPress={() => { setSignInMethod('demo'); setError(''); }} style={styles.backLink}>
                    <Text style={[styles.backText, { color: colors.primary }]}>Use demo username or phone</Text>
                  </Pressable>
                ) : null}
              </>
            ) : signupPath === 'choose' ? (
              <View style={styles.signupChoices}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => { setSignupPath('parent-email'); setError(''); }}
                  style={({ pressed }) => [styles.signupChoice, { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.8 : 1 }]}
                >
                  <View style={[styles.choiceIcon, { backgroundColor: colors.secondary }]}><Feather name="mail" size={18} color={colors.primary} /></View>
                  <View style={styles.choiceCopy}>
                    <Text style={[styles.choiceTitle, { color: colors.foreground }]}>Sign up with Email</Text>
                    <Text style={[styles.choiceDescription, { color: colors.mutedForeground }]}>Create a real Parent account with Clerk.</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </Pressable>
                {demoEnabled ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => { setSignupPath('parent-phone'); setError(''); }}
                    style={({ pressed }) => [styles.signupChoice, { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.8 : 1 }]}
                  >
                    <View style={[styles.choiceIcon, { backgroundColor: colors.secondary }]}><Feather name="smartphone" size={18} color={colors.primary} /></View>
                    <View style={styles.choiceCopy}>
                      <Text style={[styles.choiceTitle, { color: colors.foreground }]}>Sign up with Phone Number</Text>
                      <Text style={[styles.choiceDescription, { color: colors.mutedForeground }]}>Simulated verification for the shared Parent demo.</Text>
                    </View>
                    <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => { setSignupPath('child-email'); setError(''); }}
                  style={({ pressed }) => [styles.signupChoice, { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.8 : 1 }]}
                >
                  <View style={[styles.choiceIcon, { backgroundColor: colors.secondary }]}><Feather name="users" size={18} color={colors.primary} /></View>
                  <View style={styles.choiceCopy}>
                    <Text style={[styles.choiceTitle, { color: colors.foreground }]}>Child account</Text>
                    <Text style={[styles.choiceDescription, { color: colors.mutedForeground }]}>Join a family with Clerk email and an invitation code.</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ) : signupPath === 'parent-phone' ? (
              <>
                <Input label="Phone number" value={phoneNumber} onChangeText={setPhoneNumber} placeholder="408 887 7754" keyboardType="phone-pad" autoComplete="tel" />
                <Text style={[styles.helperText, { color: colors.mutedForeground }]}>Demo number: 4088877754. Use code 1234 on the next screen. No SMS is sent.</Text>
                {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
                <Button label="Send demo code" icon="arrow-right" loading={demoBusy} disabled={!phoneNumber.trim() || busy} onPress={startPhoneSignup} testID="phone-signup-submit" />
                <Pressable onPress={() => { setSignupPath('choose'); setError(''); }} style={styles.backLink}>
                  <Text style={[styles.backText, { color: colors.primary }]}>Back to signup choices</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Input label="First name" value={firstName} onChangeText={setFirstName} placeholder="First name" autoCapitalize="words" autoComplete="given-name" />
                <Input label="Last name" value={lastName} onChangeText={setLastName} placeholder="Last name" autoCapitalize="words" autoComplete="family-name" />
                {signupPath === 'child-email' ? <Input label="Family invitation code" value={familyCode} onChangeText={setFamilyCode} placeholder="Enter your parent's family code" autoCapitalize="none" /> : null}
                <Input label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
                <Input label="Password" value={password} onChangeText={setPassword} placeholder="Create a password" secureTextEntry autoComplete="new-password" />
                {signupPath === 'child-email' ? <Text style={[styles.helperText, { color: colors.mutedForeground }]}>Clerk email is required for real Child accounts. No phone number is collected.</Text> : null}
                {clerkError ? <Text style={[styles.error, { color: colors.destructive }]}>{clerkError}</Text> : null}
                {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
                <Button
                  label={signupPath === 'child-email' ? 'Continue with Child account' : 'Create Parent account'}
                  icon="arrow-right"
                  loading={busy}
                  disabled={!firstName.trim() || !lastName.trim() || !email.trim() || !password || (signupPath === 'child-email' && !familyCode.trim()) || busy}
                  onPress={() => { void submitEmail(); }}
                  testID="email-auth-submit"
                />
                <Pressable onPress={() => { setSignupPath('choose'); setError(''); }} style={styles.backLink}>
                  <Text style={[styles.backText, { color: colors.primary }]}>Back to signup choices</Text>
                </Pressable>
              </>
            )}
          </>
        ) : demoVerification ? (
          <>
            <Input label="Four-digit verification code" value={code} onChangeText={setCode} placeholder="Enter code" keyboardType="number-pad" autoComplete="one-time-code" />
            <Text style={[styles.helperText, { color: colors.mutedForeground }]}>This is a simulated code, not an SMS. Demo code: 1234.</Text>
            {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
            <Button label="Verify demo code" icon="check" loading={demoBusy} disabled={!code.trim() || busy} onPress={() => { void verifyDemoCode(); }} testID="verify-demo-code" />
            <Pressable onPress={() => { setVerificationStep(null); setError(''); }} style={styles.backLink}>
              <Text style={[styles.backText, { color: colors.primary }]}>Back</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Input label="Email verification code" value={code} onChangeText={setCode} placeholder="Enter code" keyboardType="number-pad" autoComplete="one-time-code" />
            {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
            <Button label="Verify email" icon="check" loading={busy} disabled={!code.trim() || busy} onPress={() => { void verifyEmailCode(); }} testID="verify-email" />
            <Pressable onPress={() => { setVerificationStep(null); setError(''); }} style={styles.backLink}>
              <Text style={[styles.backText, { color: colors.primary }]}>Back</Text>
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
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roleChoice: { width: '48%', minHeight: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roleChoiceLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  signupChoices: { gap: 10 },
  signupChoice: { minHeight: 76, borderWidth: 1, borderRadius: 15, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  choiceIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  choiceCopy: { flex: 1, gap: 4 },
  choiceTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  choiceDescription: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 15 },
  demoCredentials: { gap: 5, padding: 12, borderRadius: 14 },
  demoCredentialsTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
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