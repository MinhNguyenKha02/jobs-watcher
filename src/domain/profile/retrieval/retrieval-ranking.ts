export class RetrievalRanking {

  static dampen(
    score: number,
  ) {

    return Math.log1p(
      Math.max(
        score,
        0,
      ),
    );
  }

  static normalize(
    score: number,
  ) {

    return Math.min(
      1,

      Math.log1p(
        Math.max(
          score,
          0,
        ),
      ),
    );
  }

  static boostExact(
    score: number,
    exactMatches: number,
  ) {

    return (
      score +
      exactMatches * 0.15
    );
  }

  static penalizeDuplicate(
    score: number,
    duplicateCount: number,
  ) {

    return (
      score /
      (
        1 +
        duplicateCount * 0.2
      )
    );
  }
}