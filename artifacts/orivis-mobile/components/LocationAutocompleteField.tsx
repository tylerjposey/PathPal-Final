import { Feather } from '@expo/vector-icons';
import {
  getGetJourneyPlaceAutocompleteQueryKey,
  getJourneyPlaceDetails,
  useGetJourneyPlaceAutocomplete,
  type JourneyPlaceSuggestion,
} from '@workspace/api-client-react';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Field } from '@/components/OrivisUI';
import { useColors } from '@/hooks/useColors';

export type SelectedPlace = {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
};

type Props = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onSelect: (place: SelectedPlace) => void;
  placeholder: string;
  testID: string;
  initiallySelected?: boolean;
};

function newSessionToken(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function LocationAutocompleteField({
  label,
  value,
  onChangeText,
  onSelect,
  placeholder,
  testID,
  initiallySelected = false,
}: Props) {
  const colors = useColors();
  const [searchInput, setSearchInput] = useState('');
  const [sessionToken, setSessionToken] = useState(newSessionToken);
  const [isSelected, setIsSelected] = useState(initiallySelected);
  const [isResolving, setIsResolving] = useState(false);
  const [selectionError, setSelectionError] = useState('');

  useEffect(() => {
    if (isSelected) {
      setSearchInput('');
      return;
    }
    const text = value.trim();
    if (text.length < 3) {
      setSearchInput('');
      return;
    }
    const timer = setTimeout(() => setSearchInput(text), 350);
    return () => clearTimeout(timer);
  }, [value, isSelected]);

  const params = { input: searchInput, sessionToken };
  const suggestionsQuery = useGetJourneyPlaceAutocomplete(
    params,
    {
      query: {
        queryKey: getGetJourneyPlaceAutocompleteQueryKey(params),
        enabled: searchInput.length >= 3 && !isSelected,
        staleTime: 0,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  );

  const chooseSuggestion = async (suggestion: JourneyPlaceSuggestion) => {
    setIsResolving(true);
    setSelectionError('');
    try {
      const details = await getJourneyPlaceDetails({
        placeId: suggestion.placeId,
        sessionToken,
      });
      const selected: SelectedPlace = {
        placeId: details.placeId,
        name: details.name || suggestion.name,
        lat: details.latitude,
        lng: details.longitude,
      };
      if (!Number.isFinite(selected.lat) || !Number.isFinite(selected.lng)) {
        throw new Error('Coordinates were not returned for this place.');
      }
      setIsSelected(true);
      onChangeText(selected.name);
      onSelect(selected);
      setSessionToken(newSessionToken());
    } catch {
      setSelectionError('Could not load this place. Try another suggestion.');
    } finally {
      setIsResolving(false);
    }
  };

  const visible = searchInput.length >= 3 && !isSelected;
  const suggestions = suggestionsQuery.data?.suggestions ?? [];

  return (
    <View style={styles.wrap}>
      <Field
        label={label}
        value={value}
        onChangeText={(text) => {
          setIsSelected(false);
          setSelectionError('');
          onChangeText(text);
        }}
        placeholder={placeholder}
        returnKeyType="search"
        autoCorrect={false}
        testID={testID}
      />
      {visible ? (
        <View style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {suggestionsQuery.isFetching || isResolving ? (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                {isResolving ? 'Getting place coordinates…' : 'Searching locations…'}
              </Text>
            </View>
          ) : null}
          {suggestions.map((suggestion, index) => (
            <Pressable
              key={`${suggestion.placeId}-${index}`}
              testID={`${testID}-suggestion-${index}`}
              accessibilityRole="button"
              disabled={isResolving}
              onPress={() => { void chooseSuggestion(suggestion); }}
              style={({ pressed }) => [
                styles.suggestion,
                { borderBottomColor: colors.border, opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Feather name="map-pin" size={17} color={colors.primary} />
              <View style={styles.suggestionText}>
                <Text style={[styles.name, { color: colors.foreground }]}>{suggestion.name}</Text>
                {suggestion.description ? (
                  <Text style={[styles.helper, { color: colors.mutedForeground }]}>{suggestion.description}</Text>
                ) : null}
              </View>
            </Pressable>
          ))}
          {!suggestionsQuery.isFetching && searchInput.length >= 3 && suggestions.length === 0 ? (
            <Text style={[styles.helper, styles.empty, { color: suggestionsQuery.isError ? colors.destructive : colors.mutedForeground }]}>
              {suggestionsQuery.isError
                ? 'Google Places search is unavailable. Check its API setup and try again.'
                : 'No matching places. Try an address, business, school, landmark, or destination.'}
            </Text>
          ) : null}
        </View>
      ) : null}
      {selectionError ? (
        <Text style={[styles.helper, { color: colors.destructive }]}>{selectionError}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  dropdown: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  suggestion: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestionText: { flex: 1 },
  name: { fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 18 },
  helper: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 12 },
  empty: { paddingHorizontal: 14, paddingVertical: 12 },
});