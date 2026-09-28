import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type StyleProp,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { useColors } from '@/hooks/useColors';

export function BrandMark({ size = 42, inverse = false }: { size?: number; inverse?: boolean }) {
  const colors = useColors();
  void inverse;
  return (
    <View style={[styles.mark, { width: size, height: size, borderRadius: size * 0.34, backgroundColor: colors.brandSurface }]}>
      <Image
        source={require('../assets/images/pathpal-mark.png')}
        resizeMode="contain"
        accessibilityLabel="PathPal logo"
        style={{ width: size * 0.96, height: size * 0.96 }}
      />
    </View>
  );
}

export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  subtitleStyle,
  right,
}: {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  subtitleStyle?: StyleProp<TextStyle>;
  right?: ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        {eyebrow ? <Text style={[styles.eyebrow, { color: colors.primary }]}>{eyebrow.toUpperCase()}</Text> : null}
        {title ? <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text> : null}
        {subtitle ? <Text style={[styles.subtitle, { color: colors.mutedForeground }, subtitleStyle]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({
  children,
  style,
  tone = 'default',
}: {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  tone?: 'default' | 'soft' | 'danger' | 'navy';
}) {
  const colors = useColors();
  const backgroundColor =
    tone === 'soft'
      ? colors.secondary
      : tone === 'danger'
        ? colors.destructive
        : tone === 'navy'
          ? colors.navy
          : colors.card;
  return (
    <View style={[styles.card, { backgroundColor, borderColor: tone === 'default' ? colors.border : backgroundColor }, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({
  title,
  titleStyle,
  action,
  onAction,
}: {
  title: string;
  titleStyle?: StyleProp<TextStyle>;
  action?: string;
  onAction?: () => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.sectionTitle}>
      <Text style={[styles.sectionTitleText, { color: colors.foreground }, titleStyle]}>{title}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={[styles.sectionAction, { color: colors.primary }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Button({
  label,
  icon,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  testID,
}: {
  label: string;
  icon?: keyof typeof Feather.glyphMap;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  const backgroundColor =
    variant === 'primary'
      ? colors.primary
      : variant === 'danger'
        ? colors.destructive
        : variant === 'secondary'
          ? colors.secondary
          : 'transparent';
  const color =
    variant === 'primary'
      ? colors.primaryForeground
      : variant === 'danger'
        ? colors.destructiveForeground
        : variant === 'secondary'
          ? colors.secondaryForeground
          : colors.primary;
  return (
    <Pressable
      testID={testID}
      disabled={disabled || loading}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor,
          borderColor: variant === 'ghost' ? colors.border : backgroundColor,
          opacity: disabled ? 0.45 : pressed ? 0.78 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <>
          {icon ? <Feather name={icon} size={18} color={color} /> : null}
          <Text style={[styles.buttonText, { color }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  color,
  testID,
}: {
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  color?: string;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      testID={testID}
      hitSlop={12}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.45 : 1 }]}
    >
      <Feather name={icon} size={22} color={color ?? colors.foreground} />
    </Pressable>
  );
}

export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  const colors = useColors();
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        style={[
          styles.field,
          {
            color: colors.foreground,
            backgroundColor: colors.card,
            borderColor: error ? colors.destructive : colors.input,
          },
          props.multiline ? styles.multiline : null,
          props.style,
        ]}
      />
      {error ? <Text style={[styles.fieldError, { color: colors.destructive }]}>{error}</Text> : null}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  tone,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  tone?: 'success' | 'warning' | 'danger';
}) {
  const colors = useColors();
  const activeColor =
    tone === 'success'
      ? colors.success
      : tone === 'warning'
        ? colors.warning
        : tone === 'danger'
          ? colors.destructive
          : colors.primary;
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? activeColor : colors.muted,
          borderColor: active ? activeColor : colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function Metric({
  value,
  label,
  icon,
}: {
  value: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
}) {
  const colors = useColors();
  return (
    <View style={styles.metric}>
      <View style={[styles.metricIcon, { backgroundColor: colors.secondary }]}>
        <Feather name={icon} size={17} color={colors.primary} />
      </View>
      <Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

export function Divider() {
  const colors = useColors();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  mark: { alignItems: 'center', justifyContent: 'center' },
  markDot: { position: 'absolute', width: 5, height: 5, borderRadius: 3 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22 },
  headerText: { flex: 1 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.6, marginBottom: 8 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, lineHeight: 35, letterSpacing: -0.8 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: 7 },
  card: { borderWidth: 1, borderRadius: 22, padding: 18 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 12 },
  sectionTitleText: { fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: -0.25 },
  sectionAction: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  button: { minHeight: 52, paddingHorizontal: 18, borderRadius: 17, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  buttonText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  fieldWrap: { gap: 7 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  field: { minHeight: 52, paddingHorizontal: 15, borderWidth: 1, borderRadius: 16, fontFamily: 'Inter_500Medium', fontSize: 15 },
  multiline: { minHeight: 112, paddingTop: 14, textAlignVertical: 'top' },
  fieldError: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  chip: { minHeight: 36, paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  metric: { flex: 1, minWidth: 92, gap: 4 },
  metricIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  metricValue: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  metricLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 15 },
  divider: { height: StyleSheet.hairlineWidth, width: '100%', marginVertical: 14 },
});