import { Feather } from '@expo/vector-icons';
import { useSignIn, useSignUp, useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { BrandMark, Button, Card } from '@/components/OrivisUI';
import { useColors } from '@/hooks/useColors';

WebBrowser.maybeCompleteAuthSession();

type AuthMode = 'signin' | 'signup';

export function AuthScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signIn, errors: signInErrors, fetchStatus: signInFetchStatus } = useSignIn();
  const { signUp, errors: signUpErrors, fetchStatus: signUpFetchStatus } = useSignUp();
  const { startSSOFlow } = useSSO();
  const [mode, setMode] = useState<AuthMode>('signin');
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

  const busy = signInFetchStatus === 'fetching' || signUpFetchStatus === 'fetching' || busyGoogle;
  const clerkError = mode === 'signin'
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
        const result = await signUp.password({ emailAddress: email.trim(), password });
        if (result.error) { setError(result.error.message); return; }
        const sent = await signUp.verifications.sendEmailCode();
        if (sent.error) { setError(sent.error.message); return; }
        setVerificationPending(true);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Authentication could not be completed.');
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
        {verificationPending ? 'Check your inbox.' : mode === 'signin' ? 'Your family’s safe route starts here.' : 'Create your PathPal account.'}
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        {verificationPending
          ? `Enter the verification code sent to ${email}.`
          : 'A trusted space for family travel, local reports, and the people working to make things better.'}
      </Text>
      <Card style={styles.form}>
        {!verificationPending ? (
          <>
            <View style={styles.switchRow}>
              {(['signin', 'signup'] as AuthMode[]).map((item) => (
                <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: mode === item }} onPress={() => { setMode(item); setError(''); }} style={[styles.modeButton, { backgroundColor: mode === item ? colors.primary : colors.muted }]}>
                  <Text style={[styles.modeText, { color: mode === item ? colors.primaryForeground : colors.mutedForeground }]}>{item === 'signin' ? 'Sign in' : 'Create account'}</Text>
                </Pressable>
              ))}
            </View>
            <Input label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
            <Input label="Password" value={password} onChangeText={setPassword} placeholder="Enter your password" secureTextEntry autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
            {clerkError ? <Text style={[styles.error, { color: colors.destructive }]}>{clerkError}</Text> : null}
            {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
            <Button label={mode === 'signin' ? 'Continue securely' : 'Create account'} icon="arrow-right" loading={busy} disabled={!email.trim() || !password || busy} onPress={() => { void submitEmail(); }} testID="email-auth-submit" />
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

function Input(props: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; keyboardType?: 'email-address' | 'number-pad'; secureTextEntry?: boolean; autoCapitalize?: 'none'; autoComplete?: 'email' | 'current-password' | 'new-password' | 'one-time-code' }) {
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
  modeButton: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 42, borderRadius: 13 },
  modeText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  inputGroup: { gap: 7 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  input: { height: 50, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontFamily: 'Inter_400Regular', fontSize: 14 },
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