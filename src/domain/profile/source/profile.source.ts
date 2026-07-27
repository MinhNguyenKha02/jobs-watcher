// profile.source.ts
import {
  backendCapability,
  architectureCapability,
  testingCapability,
  databaseCapability,
  observabilityCapability,
  infrastructureCapability,
  communicationCapability,
  securityCapability,
  engineeringCompetency,
  executionCompetency,
  collaborationCompetency,
  ownershipBehavior,
  engineeringBehavior,
  languageTech,
  backendFrameworkTech,
  infrastructureTech,
  databaseTech,
  foundationCapability,
  testingTech,
  securityTech,
  protocolTech,
  observabilityTech,
} from './profile.source.types.js';
import { ProfileSource, ProfileRole } from './source.types.js';

export const profileSource: ProfileSource = {
  name: 'Minh Nguyen Kha',
  email: 'minhnguyen.kha@proton.me',
  phone: '(+84) 39 679 6034',
  location: 'District Binh Thanh, Ho Chi Minh City, Vietnam',
  title: 'Entry Software Engineer',
  cap: {
    foundation: [
      foundationCapability.data_structures,
      foundationCapability.algorithms,
      foundationCapability.system_design,
      foundationCapability.oop,
      foundationCapability.sdlc,
      foundationCapability.networking_fundamentals,
      foundationCapability.operating_systems_fundamentals,
      foundationCapability.database_fundamentals,
    ],
    backend: [
      backendCapability.api_development,
      backendCapability.api_design,
      backendCapability.service_integration,
      backendCapability.background_job_processing,
      backendCapability.workflow_orchestration,
      backendCapability.event_processing,
      backendCapability.message_queue_processing,
      backendCapability.concurrent_processing,
    ],
    
    architecture: [
      architectureCapability.service_decomposition,
      architectureCapability.dependency_inversion,
      architectureCapability.domain_modeling,
      architectureCapability.interface_abstraction,
      architectureCapability.architectural_documentation,
      architectureCapability.data_flow_design,
      architectureCapability.boundary_definition,
      architectureCapability.module_design,
      architectureCapability.integration_design,
    ],
    testing: [
      testingCapability.unit_testing,
      testingCapability.integration_testing,
      testingCapability.regression_testing,
      testingCapability.api_testing,
    ],
    database: [
      databaseCapability.query_optimization,
      databaseCapability.database_design,
      databaseCapability.data_modeling,
      databaseCapability.database_indexing,
      databaseCapability.schema_migration,
      databaseCapability.data_consistency,
    ],
    observability: [
      observabilityCapability.distributed_tracing,
      observabilityCapability.structured_logging,
      observabilityCapability.monitoring,
    ],

    infrastructure: [
      infrastructureCapability.containerized_deployment,
      infrastructureCapability.linux_service_management,
      infrastructureCapability.cloud_deployment,
      infrastructureCapability.ci_cd_automation,
      infrastructureCapability.configuration_management,
      infrastructureCapability.environment_management,
    ],
    
    communication: [
      communicationCapability.event_based_communication,
      communicationCapability.streaming_communication,
      communicationCapability.request_response_communication,
    ],

    security: [
      securityCapability.authentication_implementation,
      securityCapability.authorization_control,
      securityCapability.input_validation,
      securityCapability.rate_limiting,
    ],
  },
  comp: {
    engineering: [
      engineeringCompetency.maintainable_system_design,
      engineeringCompetency.testing_discipline,
      engineeringCompetency.production_operations,
      engineeringCompetency.service_operations,
      engineeringCompetency.service_reliability,
    ],

    execution: [
      executionCompetency.delivery_focus,
      executionCompetency.workflow_consistency,
      executionCompetency.attention_to_detail,
    ],

    collaboration: [
      collaborationCompetency.technical_communication,
      collaborationCompetency.cross_functional_collaboration,
      collaborationCompetency.agile_collaboration,
      collaborationCompetency.code_review_participation,
      collaborationCompetency.sprint_planning_participation,
    ],
  },
  beh: {
    ownership: [ownershipBehavior.ownership, ownershipBehavior.initiative_taking],

    engineering: [
      engineeringBehavior.structured_debugging,
      engineeringBehavior.iterative_refinement,
      engineeringBehavior.engineering_discipline,
    ],
  },
  tech: {
    protocol:[
      protocolTech.websocket,
      protocolTech.restful_api,
      protocolTech.graphql,
      protocolTech.pubsub,
      protocolTech.webhooks,
      protocolTech.unix_domain_socket,
      protocolTech.grpc,
      protocolTech.rpc,
      protocolTech.abi_interface,
      protocolTech.rabbitmq,
    ],
    security: [securityTech.oauth, securityTech.jwt],
    language: [
      languageTech.go,
      languageTech.typescript,
      languageTech.python,
      languageTech.javascript,
      languageTech.sql,
      languageTech.c,
      languageTech.php,
      languageTech.bash,
    ],
    observability: [
      observabilityTech.pino,
      observabilityTech.opentelemetry
    ],
    backend_framework: [
      backendFrameworkTech.nodejs,
      backendFrameworkTech.expressjs,
      backendFrameworkTech.gin,
      backendFrameworkTech.laravel,
      backendFrameworkTech.django,
      backendFrameworkTech.nuxtjs,
    ],
    infrastructure: [
      infrastructureTech.docker,
      infrastructureTech.ubuntu,
      infrastructureTech.github_actions,
      infrastructureTech.git,
      infrastructureTech.cloudflare,
      infrastructureTech.google_cloud,
      infrastructureTech.aws,
    ],
    database: [
      databaseTech.postgresql,
      databaseTech.mongodb,
      databaseTech.redis,
      databaseTech.supabase,
    ],
    testing: [testingTech.vitest, testingTech.jest, testingTech.playwright],
  },

  projects: [
    {
      name: 'Jobs Watcher',
      startDate: 'Quarter 4, 2025',
      endDate: 'Present',
      type: 'personal',
      position: ProfileRole.SoftwareEngineer,
      summary: `
      Event-driven job ingestion and workflow system that converts Gmail job alerts into deterministic, auditable actions using a Saga-style orchestrator and human-in-the-loop enrichment flow.
        `,
      anchors: {
        cap: {
          // foundation: [
          //   foundationCapability.data_structures,
          //   foundationCapability.algorithms,
          //   foundationCapability.system_design,
          //   foundationCapability.oop,
          //   foundationCapability.sdlc,
          // ],
          security: [
            securityCapability.authentication_implementation,
            securityCapability.authorization_control,
            securityCapability.input_validation,
          ],
          backend: [
            backendCapability.api_development,
            backendCapability.api_design,
            backendCapability.service_integration,
            backendCapability.background_job_processing,
            backendCapability.message_queue_processing,
            backendCapability.message_queue_processing,
            backendCapability.event_processing,
            backendCapability.concurrent_processing,
            backendCapability.workflow_orchestration,
          ],
          architecture: [
            architectureCapability.service_decomposition,
            architectureCapability.dependency_inversion,
            architectureCapability.domain_modeling,
            architectureCapability.interface_abstraction,
            architectureCapability.architectural_documentation,
            architectureCapability.data_flow_design,
            architectureCapability.boundary_definition,
            architectureCapability.module_design,
            architectureCapability.integration_design,
          ],
          observability: [
            observabilityCapability.structured_logging,
            observabilityCapability.monitoring,
            observabilityCapability.distributed_tracing,
          ],

          testing: [
            testingCapability.unit_testing,
            testingCapability.integration_testing,
            testingCapability.regression_testing,
          ],
          database: [
            databaseCapability.query_optimization,
            databaseCapability.database_design,
            databaseCapability.data_modeling,
            databaseCapability.database_indexing,
            databaseCapability.schema_migration,
            databaseCapability.data_consistency,
          ],
          infrastructure: [
            infrastructureCapability.linux_service_management,
            infrastructureCapability.configuration_management,
            infrastructureCapability.environment_management,
          ],

          communication: [
            communicationCapability.streaming_communication,
            communicationCapability.request_response_communication,
            communicationCapability.event_based_communication,
          ],
        },

        comp: {
          engineering: [
            engineeringCompetency.maintainable_system_design,
            engineeringCompetency.testing_discipline,
            engineeringCompetency.service_operations,
            engineeringCompetency.production_operations,
            engineeringCompetency.service_reliability,
          ],
          execution: [
            executionCompetency.delivery_focus,
            executionCompetency.workflow_consistency,
            executionCompetency.attention_to_detail,
          ],
        },

        beh: {
          ownership: [ownershipBehavior.ownership, ownershipBehavior.initiative_taking],
          engineering: [
            engineeringBehavior.structured_debugging,
            engineeringBehavior.iterative_refinement,
            engineeringBehavior.engineering_discipline,
          ],
        },

        tech: {
          protocol:[
            protocolTech.pubsub,
            protocolTech.webhooks,
            protocolTech.unix_domain_socket,
            protocolTech.rabbitmq,
            protocolTech.restful_api,
          ],
          language: [languageTech.typescript, languageTech.bash],
          backend_framework: [backendFrameworkTech.nodejs, backendFrameworkTech.expressjs],
          infrastructure: [
            infrastructureTech.ubuntu,
            infrastructureTech.git,
          ],
          database: [databaseTech.mongodb],
          third_party: ['Gmail API'],
          testing: [testingTech.vitest, testingTech.jest, testingTech.playwright],
        },
      },
      key_contributions: [
        // proposed
        'Built Semi-auto queue-based extractor for Gmail Pub/Sub webhook events and headless-browser-based workers pool for parallel job processing with staged parsing, dedupe, filtering and operator-assisted routing and resume IR workflows',
        'Designed a clean and hexagonal architecture using ports/adapters and saga-command patterns orchestration',
        'Developed signal-driven orchestration for staged ingestion, routing, and operator-controlled resolution',
        'Implemented workflow persistence using MongoDB collections for lifecycle state and immutable action snapshots',
        'Integrated background daemon workflows with tmux-based operational tui',
        'Built TUI operator workflows using MongoDB change-stream/SSE event streams and Unix Domain Socket command interfaces',
        'Designed and developed resume IR module for routed-job for optimal resume enforced ATS resolver',
        'Implemented unit and integration and manual tests for ingestion, enrichment, and operator interaction flows using Vitest and local staging environment setups',

        // Already
        // 'Designed a clean and hexagonal architecture using ports/adapters and saga-command orchestration',
        // 'Implemented Gmail Pub/Sub webhook ingestion with staged parsing and job deduplication',
        // 'Built TUI operator workflows using MongoDB change-stream/SSE event streams and Unix Domain Socket command interfaces',
        // 'Implemented workflow persistence using MongoDB collections for lifecycle state and immutable action snapshots',
        // 'Developed signal-driven enrichment flow for staged ingestion, routing, and operator-controlled resolution',
        // 'Integrated background daemon workflows with tmux-based operational tooling and manual validation scripts',
        // 'Implemented unit and integration and manual tests for ingestion, enrichment, and operator interaction flows using Vitest and local staging environment setups,'
      ],
      outcomes: [
        'Reduced repetitive manual job triage through staged ingestion and operator-assisted routing workflows',
        'Established deterministic workflow tracking using lifecycle state transitions and immutable audit snapshots',
        'Enabled real-time operator interaction through SSE broadcasts and TUI-based signal handling',
        'Validated end-to-end ingestion and enrichment flows in controlled local and staging environments',
      ],
      status: 'Functional (active development and operational refinement)',
      evidences: {
        github: [
          'jobs-watcher-repository:https://github.com/MinhNguyenKha02/jobs-watcher'
        ]
      }
    },
    {
      name: 'Speaking Evaluation Service',
      startDate: 'Quarter 4, 2025',
      endDate: 'Present',
      type: 'lab',
      position: ProfileRole.SoftwareEngineer,
      summary: `
  Real-time audio streaming and transcription service using WebSocket pipelines and local STT inference (Whisper.cpp).
          `,
      anchors: {
        cap: {
          backend: [
            backendCapability.service_integration,
          ],
          communication: [communicationCapability.streaming_communication, communicationCapability.request_response_communication, communicationCapability.event_based_communication],
          infrastructure: [infrastructureCapability.containerized_deployment, infrastructureCapability.configuration_management, infrastructureCapability.environment_management],
          testing: [testingCapability.unit_testing, testingCapability.integration_testing],
          architecture: [architectureCapability.service_decomposition, architectureCapability.integration_design, architectureCapability.data_flow_design, architectureCapability.boundary_definition, architectureCapability.module_design, architectureCapability.integration_design, architectureCapability.architectural_documentation],
          foundation: [
            foundationCapability.data_structures,
            foundationCapability.algorithms,
            foundationCapability.system_design,
            foundationCapability.oop,
            foundationCapability.sdlc,
          ],
          security: [securityCapability.input_validation],
        },
        comp: {
          engineering: [
            engineeringCompetency.maintainable_system_design,
            engineeringCompetency.service_operations,
          ],
          execution: [executionCompetency.delivery_focus, executionCompetency.attention_to_detail],
        },

        beh: {
          ownership: [ownershipBehavior.ownership],
          engineering: [engineeringBehavior.structured_debugging],
        },

        tech: {
          protocol: [protocolTech.websocket, protocolTech.rpc],
          language: [languageTech.go],
          infrastructure: [
            infrastructureTech.ubuntu,
            'Whisper.cpp',
            infrastructureTech.git,
            infrastructureTech.docker,
          ],
          testing: [testingTech.gotesting],
        },
      },
      key_contributions: [
        'Built WebSocket-based pipeline for real-time audio streaming and transcription',
        'Integrated Whisper.cpp model for STT-based pronunciation feedback.',
        'Implemented session-based processing for continuous speech input.',
        'Designed CLI audio capture (arecord) and Go RPC for local Whisper.cpp STT inference',
      ],
      outcomes: [
        'End-to-end streaming flow validated in local environment',
        'Achieved real-time transcription via streaming pipeline with local STT inference',
      ],
      status: 'Prototype (local environment; under active development)',
      evidences: {
        github: [
          'speaking-evaluation-service-repository:https://github.com/MinhNguyenKha02/speaking-evaluation-service'
        ]
      },
    },
    {
      name: 'Packet Query',
      startDate: 'Quarter 4, 2025',
      endDate: 'Present',
      type: 'lab',
      position: ProfileRole.SoftwareEngineer,
      summary: `
  Experimental high-throughput packet capture system using C (libpcap, mmap) and Go, supporting query-driven packet processing.
        `,
      key_contributions: [
        'Built packet capture pipeline using libpcap with mmap-based zero-copy.',
        'Implemented Go consumer for packet processing via defined ABI contract.',
        'Designed gRPC control plane for dynamic runtime configuration',
        'Explored query-based filtering model for packet metadata processing',
        'Dockerize application for consistent local testing and development environment',
      ],
      outcomes: ['Demonstrated zero-copy packet capture and processing via mmap-based pipeline.'],
      anchors: {
        cap: {
          backend: [
            backendCapability.service_integration,
            backendCapability.event_processing,
          ],
          communication: [communicationCapability.request_response_communication, communicationCapability.streaming_communication],
          infrastructure: [infrastructureCapability.containerized_deployment, infrastructureCapability.configuration_management, infrastructureCapability.environment_management],
          foundation: [
            foundationCapability.data_structures,
            foundationCapability.algorithms,
            foundationCapability.system_design,
            foundationCapability.oop,
            foundationCapability.sdlc,
          ],
          testing: [
            testingCapability.unit_testing,
            testingCapability.integration_testing,
          ],
          architecture: [architectureCapability.service_decomposition],
          security: [securityCapability.input_validation],
        },

        comp: {
          engineering: [engineeringCompetency.maintainable_system_design],
          execution: [executionCompetency.attention_to_detail],
        },

        beh: {
          ownership: [ownershipBehavior.ownership],
          engineering: [engineeringBehavior.structured_debugging],
        },

        tech: {
          protocol: [protocolTech.grpc, protocolTech.abi_interface],
          language: [languageTech.go, languageTech.c],
          backend_framework: [],
          infrastructure: [
            infrastructureTech.ubuntu,
            infrastructureTech.git,
            infrastructureTech.docker,
          ],
          database: [],
          testing: [testingTech.gotesting, testingTech.ctesting],
        },
      },
      status: 'Prototype under active exploration',
      evidences: {
        github: [
          'capture-repository:https://github.com/MinhNguyenKha02/capture-core',
          'agent-repository:https://github.com/MinhNguyenKha02/agent-core',
        ]
      },
    },
    {
      name: 'Supply Chain Management System',
      position: ProfileRole.FullStackDeveloper,
      startDate: 'Jul 2024',
      endDate: 'Dec 2024',
      type: 'thesis',
      summary: `
          Designed and implemented a supply chain management system with real-time tracking, achieving an 8/10 score for the thesis project on supply chain optimization.
        `,
      key_contributions: [
        'Designed schemas and implemented backend logic for shipment, order, and inventory management modules.',
        'Built REST APIs with error handling and enforce RBAC-based, JWT-based authentication using OAuth 2.0 for shipment, order, and inventory management.',
        'Integrated real-time chat, notifications, and route tracking',
        'Earned an 8/10 score for a thesis project on supply chain optimization.',
      ],
      outcomes: [
        'Demonstrated end-to-end supply chain management features with real-time tracking and communication',
        'Achieved an 8/10 score for the thesis project on supply chain optimization.',
      ],
      anchors: {
        cap: {
          backend: [
            backendCapability.api_development,
            backendCapability.api_design,
            backendCapability.service_integration,
          ],
          communication: [communicationCapability.request_response_communication, communicationCapability.streaming_communication],
          security: [
            securityCapability.authentication_implementation,
            securityCapability.authorization_control,
            securityCapability.input_validation,
          ],
          database: [
            databaseCapability.query_optimization,
            databaseCapability.database_design,
            databaseCapability.data_modeling,
            databaseCapability.database_indexing,
            databaseCapability.data_consistency,
          ],
          foundation: [
            foundationCapability.data_structures,
            foundationCapability.algorithms,
            foundationCapability.system_design,
            foundationCapability.oop,
            foundationCapability.sdlc,
          ],
          architecture: [architectureCapability.service_decomposition],
        },

        comp: {
          engineering: [engineeringCompetency.maintainable_system_design],
          execution: [executionCompetency.delivery_focus],
          collaboration: [collaborationCompetency.technical_communication],
        },

        beh: {
          ownership: [ownershipBehavior.ownership],
          engineering: [engineeringBehavior.structured_debugging],
        },

        tech: {
          language: [languageTech.typescript, languageTech.php],
          backend_framework: [backendFrameworkTech.laravel],
          infrastructure: [infrastructureTech.ubuntu, infrastructureTech.git],
          database: [databaseTech.postgresql],
          security: [securityTech.oauth],
        },
      },
      evidences: {
        github: [
          'frontend-repository:https://github.com/MinhNguyenKha02/logistic_app_frontend',
          'backend-repository:https://github.com/MinhNguyenKha02/logistic_app_backend'
        ]
      },
    },
  ],
  experiences: [
    {
      company: 'Golive Dev JSC',
      position: ProfileRole.FullStackDeveloper,
      location: 'Remote',
      startDate: '2024-10',
      endDate: '2025-01',
      responsibilities: [
        'Designed relational schemas and backend services for 2 production product modules.',
        'Implemented REST APIs with structured validation and error handling.',
        'Maintained API contracts enabling stable frontend-backend integration.',
        'Applied Git-based collaborative development workflows in agile environments.',
      ],
      outcomes: [
        'Delivered backend features integrated from database to API and UI layers',
        'Maintained stable API behavior across modules in staging environment',
      ],
      anchors: {
        cap: {
          backend: [
            backendCapability.api_development,
            backendCapability.api_design,
            backendCapability.service_integration,
          ],
          communication: [communicationCapability.request_response_communication],
          architecture: [architectureCapability.service_decomposition],
          security: [
            securityCapability.input_validation,
            securityCapability.authentication_implementation,
            securityCapability.authorization_control,
          ],
          database: [
            databaseCapability.query_optimization,
            databaseCapability.database_design,
            databaseCapability.data_modeling,
          ],
          foundation: [
            foundationCapability.data_structures,
            foundationCapability.algorithms,
            foundationCapability.system_design,
            foundationCapability.oop,
            foundationCapability.sdlc,
          ],
        },

        comp: {
          engineering: [
            engineeringCompetency.maintainable_system_design,
            engineeringCompetency.service_operations,
          ],
          execution: [executionCompetency.delivery_focus, executionCompetency.workflow_consistency],
          collaboration: [
            collaborationCompetency.technical_communication,
            collaborationCompetency.agile_collaboration,
            collaborationCompetency.code_review_participation,
            collaborationCompetency.sprint_planning_participation,
          ],
        },

        beh: {
          ownership: [ownershipBehavior.ownership, ownershipBehavior.initiative_taking],
          engineering: [engineeringBehavior.structured_debugging],
        },

        tech: {
          language: [languageTech.typescript],
          backend_framework: [backendFrameworkTech.nodejs, backendFrameworkTech.nuxtjs],
          infrastructure: [infrastructureTech.ubuntu, infrastructureTech.git],
          database: [databaseTech.postgresql, databaseTech.supabase],
          security: [securityTech.oauth],
        },
      },
    },
    {
      company: 'Mevivu Co., Ltd',
      position: 'Web Developer',
      location: 'Ho Chi Minh City, Vietnam',
      startDate: '2023-08',
      endDate: '2023-11',
      responsibilities: [
        'Maintained and customized WordPress websites in production.',
        'Designed responsive UI layouts in Figma across devices.',
        'Participated in early-stage web application specification planning and requirement scoping.',
      ],
      outcomes: [
        'Delivered stable client-facing websites with consistent UI behavior',
        'Improved alignment between design and implementation through iterative feedback and refinement',
      ],
      anchors: {
        cap: {
          foundation: [],
          communication: [],
        },

        comp: {
          engineering: [engineeringCompetency.maintainable_system_design],
          execution: [executionCompetency.attention_to_detail],
          collaboration: [collaborationCompetency.technical_communication],
        },

        beh: {
          ownership: [ownershipBehavior.initiative_taking],
          engineering: [engineeringBehavior.iterative_refinement],
        },

        tech: {
          language: [],
          backend_framework: [],
          infrastructure: [],
          database: [],
        },
      },
    },
  ],
  education: [
    {
      institution: 'Ho Chi Minh City Open University',
      degree: 'Bachelor of Information Technology',
      startDate: '2021',
      endDate: '2025',
      grade: 'good'
    },
  ],
  links: {
    linkedin: 'https://linkedin.com/in/minh-nguyen-kha',
    github: 'https://github.com/MinhNguyenKha02',
    portfolio: 'https://your-portfolio.com',
    website: '',
  },
};
