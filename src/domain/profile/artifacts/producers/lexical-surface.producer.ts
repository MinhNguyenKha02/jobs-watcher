import {
  AnchorId,
  LexicalSurface,
} from '../../types/retrieval.types.js';

import {
  englishTemplates,
  vietnameseTemplates,
  vendorTemplates,
} from '../../source/templates.source.js';

import {
  RelationNode,
  RelationsSource,
} from '../../source/source.types.js';

const TEMPLATE_KINDS = ['responsibility', 'requirement', 'preference'] as const;

export class LexicalSurfaceProducer {

  produce(
    relations: RelationsSource,
  ) {

    const generated:
      LexicalSurface[] =
        [];

    for (
      const [
        kind,
        categories,
      ]
      of Object.entries(
        relations,
      )
    ) {

      for (
        const [
          category,
          entries,
        ]
        of Object.entries(
          categories as object,
        )
      ) {

        for (
          const [
            anchor,
            config,
          ]
          of Object.entries(
            entries as object,
          )
        ) {

          const anchorId =
            `${kind}.${category}.${anchor}` as AnchorId;

          generated.push(
            ...this.canonicalSurfaces({
              anchorId,
              config: config as RelationNode,
            }),

            ...this.templateSurfaces({
              anchorId,
              config: config as RelationNode,
              language: 'en',
            }),

            ...this.templateSurfaces({
              anchorId,
              config: config as RelationNode,
              language: 'vi',
            }),

            ...this.vendorSurfaces({
              anchorId,
              config: config as RelationNode,
            }),
          );
        }
      }
    }

    return this.dedupe(
      generated,
    );
  }

  private canonicalSurfaces({
    anchorId,
    config,
  }: {
    anchorId: AnchorId;
    config: RelationNode;
  }) {

    const generated:
      LexicalSurface[] =
        [];

    for (
      const surface
      of config.recruiter_surfaces.en
    ) {

      generated.push({
        pattern:
          surface,

        anchorId,

        source:
          'canonical',

        language:
          'en',

        weight:
          1,
      });
    }

    for (
      const surface
      of config.recruiter_surfaces.vi
    ) {

      generated.push({
        pattern:
          surface,

        anchorId,

        source:
          'canonical',

        language:
          'vi',

        weight:
          1,
      });
    }

    return generated;
  }

  private templateSurfaces({
    anchorId,
    config,
    language,
  }: {
    anchorId: AnchorId;
    config: RelationNode;
    language: 'en' | 'vi';
  }) {

    const surfaces =
      language === 'en'
        ? config.recruiter_surfaces.en
        : config.recruiter_surfaces.vi;

    const templateMap =
      language === 'en'
        ? englishTemplates
        : vietnameseTemplates;

    const generated:
      LexicalSurface[] =
        [];

    for (
      const templates
      of Object.values(templateMap)
    ) {

      for (
        const surface
        of surfaces
      ) {

        for (
          const template
          of templates
        ) {

          generated.push({
            pattern:
              template.replace(
                '{surface}',
                surface,
              ),

            anchorId,

            source:
              'template',

            language,

            weight:
              0.8,
          });
        }
      }
    }

    return generated;
  }

  private vendorSurfaces({
    anchorId,
    config,
  }: {
    anchorId: AnchorId;
    config: RelationNode;
  }) {

    const generated:
      LexicalSurface[] =
        [];

    for (
      const vendor
      of config.retrieval_associations
    ) {

      generated.push(
        {
          pattern: vendor,
          anchorId,
          source: 'vendor',
          language: 'en',
          weight: 0.35,
        },
        {
          pattern: vendor,
          anchorId,
          source: 'vendor',
          language: 'vi',
          weight: 0.35,
        },
      );

      for (
        const kind of TEMPLATE_KINDS
      ) {

        for (
          const template
          of vendorTemplates.en[kind]
        ) {

          generated.push({
            pattern:
              template.replace(
                '{retrieval_association}',
                vendor,
              ),
            anchorId,
            source: 'vendor',
            language: 'en',
            weight: 0.35,
          });
        }
      }

      for (
        const kind of TEMPLATE_KINDS
      ) {

        for (
          const template
          of vendorTemplates.vi[kind]
        ) {

          generated.push({
            pattern:
              template.replace(
                '{retrieval_association}',
                vendor,
              ),
            anchorId,
            source: 'vendor',
            language: 'vi',
            weight: 0.35,
          });
        }
      }
    }

    return generated;
  }

  private dedupe(
    items:
      LexicalSurface[],
  ) {

    const map =
      new Map<
        string,
        LexicalSurface
      >();

    for (
      const item
      of items
    ) {

      const key =
        [
          item.anchorId,
          item.pattern
            .trim()
            .toLowerCase(),
          item.language,
          item.source,
        ].join('::');

      if (!map.has(key)) {

        map.set(
          key,
          item,
        );
      }
    }

    return [
      ...map.values(),
    ];
  }
}