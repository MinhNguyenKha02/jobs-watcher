import { ProfileSource } from '../../source/source.types.js';
import {
  AnchorId,
  AnchorNode,
} from '../../types/retrieval.types.js';

const SECTIONS = [
  'cap',
  'comp',
  'beh',
  'tech',
] as const;

export class AnchorProducer {

  produce(
    profile: ProfileSource,
  ) {

    const anchors =
      new Map<
        AnchorId,
        AnchorNode
      >();

    for (
      const section
      of SECTIONS
    ) {

      const categories =
        profile[section];

      if (!categories) {
        continue;
      }

      for (
        const [
          category,
          values,
        ]
        of Object.entries(
          categories,
        )
      ) {

        for (
          const value
          of values as string[]
        ) {

          const id =
            `${section}.${category}.${value}` as AnchorId;

          anchors.set(
            id,
            {
              id,
              kind: section,
              category,
              key: value,
            },
          );
        }
      }
    }

    return anchors;
  }
}