// src/services/profile/artifacts/serializers/map.serializer.ts

export function serializeMap<
  K,
  V,
>(
  map: Map<K, V>,
) {

  return [
    ...map.entries(),
  ];
}

export function deserializeMap<
  K,
  V,
>(
  entries: [
    K,
    V,
  ][],
) {

  return new Map<
    K,
    V
  >(entries);
}

export function serializeNestedSetMap<
  K,
  V,
>(
  map: Map<K, Set<V>>,
) {

  return [
    ...map.entries(),
  ].map(
    ([
      key,
      set,
    ]) => [
      key,
      [
        ...set.values(),
      ],
    ],
  );
}

export function deserializeNestedSetMap<
  K,
  V,
>(
  entries: [
    K,
    V[],
  ][],
) {

  return new Map<
    K,
    Set<V>
  >(
    entries.map(
      ([
        key,
        values,
      ]) => [
        key,
        new Set(values),
      ],
    ),
  );
}