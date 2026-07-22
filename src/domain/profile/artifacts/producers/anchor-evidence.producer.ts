import {
  AnchorToEvidenceMap,
  EvidenceId,
  EvidenceNode,
} from '../../types/retrieval.types.js';

export class AnchorEvidenceProducer {

  produce({
    evidences,
  }: {
    evidences:
      Map<
        EvidenceId,
        EvidenceNode
      >;
  }) {

    const map:
      AnchorToEvidenceMap =
        new Map();

    for (
      const [
        evidenceId,
        evidence,
      ]
      of evidences
    ) {

      for (
        const anchorId
        of evidence.anchorIds
      ) {

        if (
          !map.has(anchorId)
        ) {

          map.set(
            anchorId,
            new Set(),
          );
        }

        map
          .get(anchorId)!
          .add(
            evidenceId,
          );
      }
    }

    return map;
  }
}