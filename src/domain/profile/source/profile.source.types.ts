// profile.source.types.ts
export enum backendCapability {
  api_development = 'api-development',
  api_design = 'api-design',
  service_integration = 'service-integration',
  background_job_processing = 'background-job-processing',
  concurrent_processing = 'concurrent-processing',
  message_queue_processing = 'message-queue-processing',
  event_processing = 'event-processing',
  workflow_orchestration = 'workflow-orchestration',
  // caching = 'caching',
}

export enum architectureCapability {
  // clean_architecture = 'clean-architecture',
  // hexagonal_architecture = 'hexagonal-architecture',
  // event_driven_architecture = 'event-driven-architecture',
  // microservices_architecture = 'microservices architecture',
  // modular_monolith = 'modular-monolith',

  service_decomposition = 'service-decomposition',
  dependency_inversion = 'dependency-inversion',
  domain_modeling = 'domain-modeling',
  interface_abstraction = 'interface-abstraction',
  data_flow_design = 'data-flow-design',
  boundary_definition = 'boundary-definition',
  module_design = 'module-design',
  integration_design = 'integration-design',
  architectural_documentation = 'architectural-documentation',
}

export enum testingCapability {
  unit_testing = 'unit-testing',
  integration_testing = 'integration-testing',
  regression_testing = 'regression-testing',
  api_testing = 'api-testing',
  test_automation = 'test-automation',
  end_to_end_testing = 'end-to-end-testing',
  // manual_testing = 'manual-testing',
}

export enum databaseCapability {
  query_optimization = 'query-optimization',
  database_design = 'database-design',
  data_modeling = 'data-modeling',
  database_indexing = 'database-indexing',
  schema_migration = 'schema-migration',
  data_consistency = 'data-consistency',
}

export enum observabilityCapability {
  structured_logging = 'structured-logging',
  monitoring = 'monitoring',
  distributed_tracing = 'distributed-tracing',
}

export enum infrastructureCapability {
  containerized_deployment = 'containerized-deployment',
  linux_host_operation = 'linux-host-operation',
  development_workflow_automation = 'development-workflow-automation',
  cloud_deployment = 'cloud-deployment',
  ci_cd_automation = 'ci-cd-automation',
  configuration_management = 'configuration-management',
  environment_management = 'environment-management',
}

export enum communicationCapability {
  request_response_communication = 'request-response-communication',
  streaming_communication = 'streaming-communication',
  event_based_communication = 'event-based-communication',
}

export enum securityCapability {
  authentication = 'authentication',
  authorization = 'authorization',
  input_validation = 'input-validation',
  rate_limiting = 'rate-limiting',
}

// Additional enums for competencies and behaviors
export enum engineeringCompetency {
  maintainable_system_design = 'maintainable-system-design',
  testing_discipline = 'testing-discipline',
  production_operations = 'production-operations',
  service_operations = 'service-operations',
  service_reliability = 'service-reliability',
}

export enum executionCompetency {
  delivery_focus = 'delivery-focus',
  workflow_consistency = 'workflow-consistency',
  attention_to_detail = 'attention-to-detail',
}

export enum collaborationCompetency {
  technical_communication = 'technical-communication',
  cross_functional_collaboration = 'cross-functional-collaboration',
  agile_collaboration = 'agile-collaboration',
  code_review_participation = 'code-review-participation',
  sprint_planning_participation = 'sprint-planning-participation',
}

export enum ownershipBehavior {
  ownership = 'ownership',
  initiative_taking = 'initiative-taking',
}

export enum engineeringBehavior {
  structured_debugging = 'structured-debugging',
  iterative_refinement = 'iterative-refinement',
  engineering_discipline = 'engineering-discipline',
}

// enums for technologies
export enum protocolTech {
  websocket = 'WebSocket',
  restful_api = 'RESTful API',
  graphql = 'GraphQL',
  pubsub = 'Pub/Sub',
  webhooks = 'Webhooks',
  unix_domain_socket = 'Unix domain socket',
  grpc = 'gRPC',
  rpc = 'RPC',
  abi = 'ABI',
  rabbitmq = 'RabbitMQ',
  kafka = 'Apache Kafka',
}

export enum languageTech {
  go = 'Go',
  typescript = 'TypeScript',
  javascript = 'JavaScript',
  sql = 'SQL',
  c = 'C',
  php = 'PHP',
  bash = 'Bash',
  python = 'Python',
}

export enum backendFrameworkTech {
  nodejs = 'Node.js',
  expressjs = 'Express.js',
  gin = 'Gin',
  laravel = 'Laravel',
  django = 'Django',
  nuxtjs = 'Nuxt',
}

export enum testingTech {
  vitest = 'Vitest',
  jest = 'Jest',
  playwright = 'Playwright',
  go_test = 'Go testing',
  c_test = 'C testing',
}

export enum infrastructureTech {
  docker = 'Docker',
  linux = 'Linux',
  aws = 'AWS',
  google_cloud = 'Google Cloud',
  cloudflare = 'Cloudflare',
  github_actions = 'GitHub Actions',
  git = 'Git',
}

export enum databaseTech {
  postgresql = 'PostgreSQL',
  mongodb = 'MongoDB',
  redis = 'Redis',
  supabase = 'Supabase',
}

export enum observabilityTech {
  pino = 'Pino',
  prometheus = 'Prometheus',
  opentelemetry = 'OpenTelemetry',
}

export enum securityTech {
  jwt = 'JWT',
  oauth = 'OAuth 2.0',
}

export enum foundationCapability {
  data_structures = 'data-structures',
  algorithms = 'algorithms',
  system_design = 'system-design',
  oop = 'oop',
  database_fundamentals = 'database-fundamentals',
  networking_fundamentals = 'networking-fundamentals',
  operating_systems_fundamentals = 'operating-systems-fundamentals',
  sdlc = 'sdlc',
}
