import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import { heatColor, heatScore, type SafetyReport } from '@/context/DemoContext';

export function RouteMap({
  reports = [],
  cityRoute = false,
  heat = false,
  selectedId,
  onSelect,
  height = 260,
}: {
  reports?: SafetyReport[];
  cityRoute?: boolean;
  heat?: boolean;
  selectedId?: string;
  onSelect?: (id: string) => void;
  height?: number;
}) {
  const colors = useColors();
  return (
    <View style={[styles.map, { height, backgroundColor: colors.secondary, borderColor: colors.border }]}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="water" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.secondary} />
            <Stop offset="1" stopColor={colors.muted} />
          </LinearGradient>
        </Defs>
        <Path d="M0 0 H100 V100 H0 Z" fill="url(#water)" />
        <Path d="M-5 26 C18 20, 30 35, 54 28 S85 14, 105 22" fill="none" stroke={colors.card} strokeWidth="2.2" />
        <Path d="M7 86 C22 63, 42 76, 58 51 S83 39, 101 47" fill="none" stroke={colors.card} strokeWidth="3.1" />
        <Path d="M20 -5 C30 18, 12 43, 28 105" fill="none" stroke={colors.card} strokeWidth="2" />
        <Path d="M69 -4 C58 22, 77 45, 64 104" fill="none" stroke={colors.card} strokeWidth="2.5" />
        <Path d="M10 72 C30 60, 42 59, 56 45 S77 32, 90 21" fill="none" stroke={colors.border} strokeWidth="1" strokeDasharray="2 2" />

        {heat
          ? reports.map((report) => {
              const score = heatScore(report, reports);
              return (
                <Circle
                  key={`heat-${report.id}`}
                  cx={report.x}
                  cy={report.y}
                  r={Math.min(12, 5 + score * 0.45)}
                  fill={heatColor(score)}
                  opacity={0.2}
                />
              );
            })
          : null}

        <Path
          d="M18 72 C28 65, 42 61, 52 51 C61 42, 66 34, 79 27"
          fill="none"
          stroke={colors.primary}
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeDasharray="1.6 1.2"
        />
        <Circle cx="18" cy="72" r="3.1" fill={colors.card} stroke={colors.primary} strokeWidth="1.8" />
        <Circle cx="79" cy="27" r="3.1" fill={colors.primary} />

        {cityRoute ? (
          <Path
            d="M24 27 C35 30, 42 37, 49 42 S65 54, 76 61"
            fill="none"
            stroke={colors.warning}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        ) : null}

        {reports.map((report) => (
          <Circle
            key={report.id}
            cx={report.x}
            cy={report.y}
            r={selectedId === report.id ? 3.9 : 2.7}
            fill={heatColor(heatScore(report, reports))}
            stroke={colors.card}
            strokeWidth={selectedId === report.id ? 1.3 : 0.8}
            onPress={() => onSelect?.(report.id)}
          />
        ))}
      </Svg>

      <View style={[styles.legend, { backgroundColor: colors.card }]}>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.legendText, { color: colors.foreground }]}>VTA Route 22</Text>
        </View>
        {cityRoute ? (
          <View style={styles.legendRow}>
            <View style={[styles.legendLine, { backgroundColor: colors.warning }]} />
            <Text style={[styles.legendText, { color: colors.foreground }]}>Clean team</Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.startLabel, { backgroundColor: colors.card }]}>
        <Feather name="circle" size={10} color={colors.primary} />
        <Text style={[styles.labelText, { color: colors.foreground }]}>Willow & Bird</Text>
      </View>
      <View style={[styles.endLabel, { backgroundColor: colors.card }]}>
        <Feather name="flag" size={11} color={colors.primary} />
        <Text style={[styles.labelText, { color: colors.foreground }]}>River Glen</Text>
      </View>
      <Pressable style={[styles.viewButton, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="box" size={14} color={colors.primary} />
        <Text style={[styles.viewText, { color: colors.primary }]}>3D view</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  map: { overflow: 'hidden', borderWidth: 1, borderRadius: 24 },
  legend: { position: 'absolute', left: 12, bottom: 12, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, gap: 5 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLine: { width: 12, height: 3, borderRadius: 2 },
  legendText: { fontFamily: 'Inter_600SemiBold', fontSize: 9 },
  startLabel: { position: 'absolute', left: 9, top: '66%', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  endLabel: { position: 'absolute', right: 8, top: '19%', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  labelText: { fontFamily: 'Inter_600SemiBold', fontSize: 8 },
  viewButton: { position: 'absolute', right: 12, bottom: 12, height: 34, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  viewText: { fontFamily: 'Inter_700Bold', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
});