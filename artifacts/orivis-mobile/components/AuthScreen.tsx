import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSignIn, useSignUp } from '@clerk/expo';
import React, { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { BrandMark, Button, Card, Chip, Field } from '@/components/OrivisUI';
import { useColors } from '@/hooks/useColors';

type AuthMode = 'signin' | 'signup';
type AuthStep = 'credentials' | 'verify-signup' | 'verify-signin';

function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'We could not complete sign-in. Please try again.';
}

export function AuthScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [step, setStep] = useState<AuthStep>('credentials');
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setStep('credentials');
    setError('');
    setCode('');
    signIn.reset();
    signUp.reset();
  };

  const finishSignIn = async () => {
    await signIn.finalize({ navigate: () => {} });
  };

  const finishSignUp = async () => {
    await signUp.finalize({ navigate: () => {} });
  };

  const submitCredentials = async () => {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      if (mode === 'signup') {
        const { error: startError } = await signUp.password({
          emailAddress: emailAddress.trim(),
          password,
        });
        if (startError) throw startError;
        await signUp.verifications.sendEmailCode();
        setStep('verify-signup');
        return;
      }

      const { error: startError } = await signIn.password({
        emailAddress: emailAddress.trim(),
        password,
      });
      if (startError) throw startError;
      if (signIn.status === 'complete') {
        await finishSignIn();
      } else if (signIn.status === 'needs_client_trust' || signIn.status === 'needs_second_factor') {
        const emailFactor = signIn.supportedSecondFactors?.some((factor) => factor.strategy === 'email_code');
        if (!emailFactor) {
          setError('This account needs another verification method. Contact your organization administrator.');
          return;
        }
        await signIn.mfa.sendEmailCode();
        setStep('verify-signin');
      } else {
        setError('Sign-in needs another step. Please try again or use a different verification method.');
      }
    } catch (submitError) {
      setError(messageFrom(submitError));
    } finally {
      setWorking(false);
    }
  };

  const verifyCode = async () => {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      if (step === 'verify-signup') {
        const { error: verifyError } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
        if (verifyError) throw verifyError;
        if (signUp.status !== 'complete') {
          setError('Email verification is not complete yet. Check the code and try again.');
          return;
        }
        await finishSignUp();
      } else {
        const { error: verifyError } = await signIn.mfa.verifyEmailCode({ code: code.trim() });
        if (verifyError) throw verifyError;
        if (signIn.status !== 'complete') {
          setError('Sign-in verification is not complete yet. Check the code and try again.');
          return;
        }
        await finishSignIn();
      }
    } catch (verifyError) {
      setError(messageFrom(verifyError));
    } finally {
      setWorking(false);
    }
  };

  const resendCode = async () => {
    setError('');
    try {
      if (step === 'verify-signup') await signUp.verifications.sendEmailCode();
      else await signIn.mfa.sendEmailCode();
    } catch (resendError) {
      setError(messageFrom(resendError));
    }
  };

  const verifying = step !== 'credentials';

  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + (Platform.OS === 'web' ? 72 : 24),
          paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 28),
        },
      ]}
      bottomOffset={60}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.brandRow}>
        <BrandMark size={48} />
        <View>
          <Text style={[styles.brand, { color: colors.foreground }]}>Orivis</Text>
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
        {verifying ? 'Verify your email.' : mode === 'signin' ? 'A safer way to get there.' : 'Join your community.'}
      </Text>
      <Text style={[styles.lead, { color: colors.mutedForeground }]}>
        {verifying
          ? 'Enter the verification code sent to your email to continue.'
          : 'Coordinate journeys and report neighborhood concerns with a verified account.'}
      </Text>

      <Card style={styles.formCard}>
        {!verifying ? (
          <View style={styles.modeRow}>
            <Chip
              label="Sign in"
              active={mode === 'signin'}
              onPress={() => { void Haptics.selectionAsync(); switchMode('signin'); }}
            />
            <Chip
              label="Create account"
              active={mode === 'signup'}
              onPress={() => { void Haptics.selectionAsync(); switchMode('signup'); }}
            />
          </View>
        ) : null}

        {verifying ? (
          <>
            <Text style={[styles.formTitle, { color: colors.foreground }]}>
              {step === 'verify-signup' ? 'Email verification' : 'Sign-in verification'}
            </Text>
            <Field
              label="Verification code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoCapitalize="none"
              testID="verification-code"
            />
          </>
        ) : (
          <>
            <Text style={[styles.formTitle, { color: colors.foreground }]}>
              {mode === 'signin' ? 'Sign in to Orivis' : 'Create a verified account'}
            </Text>
            <Field
              label="Email"
              value={emailAddress}
              onChangeText={setEmailAddress}
              autoCapitalize="none"
              keyboardType="email-address"
              testID="email"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              testID="password"
            />
            {mode === 'signup' ? <View nativeID="clerk-captcha" /> : null}
          </>
        )}

        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
        <Button
          label={verifying ? 'Verify and continue' : mode === 'signin' ? 'Continue securely' : 'Send verification code'}
          icon={verifying ? 'check-circle' : 'arrow-right'}
          onPress={() => { void (verifying ? verifyCode() : submitCredentials()); }}
          loading={working}
          testID={verifying ? 'verify-email' : 'continue-signin'}
        />
        {verifying ? (
          <Button label="Send a new code" icon="refresh-cw" onPress={() => { void resendCode(); }} />
        ) : null}
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>
          Staff access is assigned by an administrator. New accounts can only submit and view their own reports.
        </Text>
      </Card>

      <View style={styles.disclaimer}>
        <Feather name="shield" size={15} color={colors.mutedForeground} />
        <Text style={[styles.disclaimerText, { color: colors.mutedForeground }]}>
          Prototype simulation. Not an emergency service or a replacement for trusted adults and local emergency resources.
        </Text>
      </View>
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
  error: { fontFamily: 'Inter_600SemiBold', fontSize: 12, lineHeight: 17 },
  helper: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  disclaimer: { flexDirection: 'row', gap: 8, marginTop: 20, paddingHorizontal: 8 },
  disclaimerText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 17 },
});