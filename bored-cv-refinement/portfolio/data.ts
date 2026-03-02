/* ============================================================
 * Scoring Models & Strength Factors
 * ============================================================
 * Capability Score Matrix Formula:
 * score = LevelStrength[level] × EvidenceWeight[evidenceType]
 * Example: Go (solid, work_experience) = 1.0 × 1.0 = 1.0
 */

/** Competency level strength (x-axis technical depth) weight */
export const LevelStrength = {
  "solid": 1.0,
  "working": 0.8,
  "familiar": 0.6
} as const

/** Evidence type credibility weight (y-axis proof quality) */
export const EvidenceWeight = {
  "work": 1.0,
  "lab": 0.76,
  "thesis": 0.82,
} as const

/** Canonical domain enumerations (data-driven unions) */
export const TechnicalDomains = [
  "backend",
  "frontend",
  "database",
  "networking",
  "security",
  "devops",
  "tooling",
  "fundamentals",
] as const

export const BusinessDomains = [
  "erp",
  "core-product",
  "infrastructure",
  "experimental",
  "third-party",
] as const

/** Semantic grouping of core domains for visualization (non-scoring) */
export const CoreDomains: readonly (typeof TechnicalDomains)[number][] = [
  "backend",
  "database",
  "networking",
  "security",
  "devops",
] as const

/** Evidence axis ordering for matrix rendering */
export const EvidenceAxis = Object.keys(EvidenceWeight) as Array<keyof typeof EvidenceWeight>

/**
 * Fundamentals + capabilities x-axis (technical breadth) weights
 */
export const FundamentalsSlices = {
  "programming_languages": 0.24,
  "dsa": 0.15,
  "os": 0.10,
  "oop": 0.13,
  "database": 0.15,
  "networking": 0.08,
  "security": 0.10,
  "testing": 0.05,
  "ai": 0.00, // optional/emerging
} as const

/**
 * Hierarchical mapping: Fundamental → Capabilities
 * Inverted structure for efficient filtering and aggregation
 * Each fundamental area lists its associated capability IDs
 */
export const CapabilityToFundamental: Record<keyof Fundamentals, string[]> = {
  programming_languages: ["go", "typescript", "nodejs", "expressjs", "gin", "laravel", "fiber", "vue", "nuxt", "react"],
  dsa: [],
  os: ["docker"],
  oop: [],
  database: ["postgres", "mongo", "sqlite", "redis", "supabase"],
  networking: ["tcpip", "tlshttp", "webproto"],
  security: ["auth", "apigw", "ratelimit", "inputval"],
  testing: ["cicd"],
  ai: [],
}

/** Preferred evidence per capability (fallback is lab) */
export const CapabilityPrimaryEvidence: Record<string, EvidenceType> = {
  go: "work",
  typescript: "work",
  nodejs: "work",
  expressjs: "work",
  gin: "lab",
  laravel: "work",
  fiber: "lab",
  rest: "work",
  graphql: "lab",
  tlshttp: "work",
  "external-service": "lab",
  microservices: "lab",
  mvc: "work",
  cleanarch: "lab",
  postgres: "work",
  mongo: "work",
  sqlite: "lab",
  redis: "lab",
  supabase: "lab",
  tcpip: "lab",
  webproto: "work",
  auth: "work",
  apigw: "lab",
  ratelimit: "lab",
  inputval: "work",
  docker: "lab",
  cicd: "work",
  aws: "work",
  cloudops: "lab",
  vue: "work",
  nuxt: "work",
  react: "lab",
  web3: "lab",
  git: "work",
  figma: "work",
  wordpress: "work",
  vscode: "work",
}

/* ============================================================
 * Type-Safe Rule Validators (Integrity Checks)
 * ============================================================ */

/**
 * Validates that:
 * 1. FundamentalsSlices weights sum to 1.0
 * 2. All capabilities in CapabilityToFundamental are registered
 * 3. No orphaned capabilities or fundamentals
 */
export const validateScoringRules = () => {
  // Check 1: FundamentalsSlices sum
  const slicesSum = Object.values(FundamentalsSlices).reduce((a, b) => a + b, 0 as number)
  const isWeightValid = Math.abs(slicesSum - 1.0) < 0.001
  if (!isWeightValid) {
    console.warn(`⚠ FundamentalsSlices sum: ${slicesSum} (expected 1.0)`)
  }

  // Check 2: All fundamentals in CapabilityToFundamental match FundamentalsSlices keys
  const fundamentalKeys = Object.keys(CapabilityToFundamental) as Array<keyof Fundamentals>
  const sliceKeys = Object.keys(FundamentalsSlices) as Array<keyof Fundamentals>
  const mismatchedFundamentals = fundamentalKeys.filter(f => !sliceKeys.includes(f))
  if (mismatchedFundamentals.length > 0) {
    console.warn(`⚠ Fundamentals in mapping but not in slices: ${mismatchedFundamentals.join(", ")}`)
  }

  // Check 3: All capabilities in mappings are defined in profile.capabilities
  const allMappedCapabilities = new Set(
    Object.values(CapabilityToFundamental).flat()
  )
  
  return {
    isValid: isWeightValid && mismatchedFundamentals.length === 0,
    slicesSum,
    fundamentalCount: fundamentalKeys.length,
    capabilityCount: allMappedCapabilities.size,
  }
}

/**
 * Get all capabilities for a fundamental area
 */
export const getCapabilitiesForFundamental = (
  fundamental: keyof Fundamentals
): string[] => CapabilityToFundamental[fundamental] ?? []

/**
 * Get fundamental area for a capability
 */
export const getFundamentalForCapability = (
  capabilityId: string
): keyof Fundamentals | undefined => {
  for (const [fundamental, capabilities] of Object.entries(CapabilityToFundamental)) {
    if (capabilities.includes(capabilityId)) {
      return fundamental as keyof Fundamentals
    }
  }
  return undefined
}

/* ============================================================
 * Canonical Profile Model
 * Single Source of Truth
 * ============================================================ */

export type Level = "solid" | "working" | "familiar"
export type RoleLevel = "Entry" | "Junior"

/**
 * Technical skill domains (x-axis categories)
 * Represents technical areas of competency
 */
export type TechnicalDomain = (typeof TechnicalDomains)[number]

/**
 * Business/Product domains
 * Represents architectural or business contexts
 */
export type BusinessDomain = (typeof BusinessDomains)[number]

export type Domain = TechnicalDomain | BusinessDomain

/* -----------------------------
 * Identity & Intent
 * ----------------------------- */
export interface Identity {
  name: string
  email: string
  phone: string
  location: string
  links: {
    github: string
    linkedin: string
    portfolio?: string
    website?: string
  }
}

export interface RoleIntent {
  primary: "Backend Software Engineer"
  secondary?: string[]
  level: RoleLevel
  focus: string[]
}

/* -----------------------------
 * Software Fundamentals
 * (Invariant layer)
 * ----------------------------- */
export interface Fundamentals { 
  programming_languages: {
    solid: string[]
    familiar: string[]
  }
  dsa: string[]
  os: string[]
  oop: string[]
  database: string[]
  networking: string[]
  security: string[]
  testing: string[]
  ai?: string[]
}

/* -----------------------------
 * Capability (computable unit)
 * ----------------------------- */
export interface Capability {
  id: string
  label: string
  domain: Domain
  level: Level
}

/* -----------------------------
 * Evidence
 * ----------------------------- */
export type EvidenceType = (typeof EvidenceAxis)[number]

export interface Evidence {
  id: string
  type: EvidenceType
  title: string
  period: string
  summary: string
  tech: string[]
  status?: "active" | "paused" | "completed"
}

/* -----------------------------
 * Experience
 * ----------------------------- */
export interface Experience {
  company: string
  position: string
  location: string
  startDate: string
  endDate: string
  highlights: string[]
}

/* -----------------------------
 * Education
 * ----------------------------- */
export interface Education {
  institution: string
  degree: string
  field: string
  startDate: string
  endDate: string
  gpa?: string
}

/* -----------------------------
 * Root Profile
 * ----------------------------- */
export interface ProfileCore {
  identity: Identity
  intent: RoleIntent
  fundamentals: Fundamentals
  capabilities: Capability[]
  evidence: Evidence[]
  experience: Experience[]
  education: Education[]
}

/* ============================================================
 * Concrete Instance (Your Data)
 * ============================================================ */

export const profile: ProfileCore = {
  identity: {
    name: "Minh Nguyen Kha",
    email: "minhnguyen.kha@proton.me",
    phone: "(+84) 39 679 6034",
    location: "District 7, Ho Chi Minh City, Vietnam",
    links: {
      github: "https://github.com/MinhNguyenKha02",
      linkedin: "https://linkedin.com/in/minh-nguyen-kha",
      portfolio: "https://your-portfolio.com"
    }
  },

  intent: {
    primary: "Backend Software Engineer",
    level: "Entry",
    focus: [
      "Backend systems",
      "RESTful APIs",
      "Networking-aware services",
      "Concurrency & resource-aware design"
    ]
  },

  fundamentals: {
    programming_languages: {
      solid: ["Go","TypeScript"],
      familiar: ["JavaScript","C","PHP","Bash"]
    },
    dsa: ["Data structures & algorithms fundamentals"],
    os: ["Linux/Ubuntu fundamentals","Shell automation","Processes and resource control"],
    oop: ["OOP fundamentals","SOLID principles","Design patterns familiarity"],
    database: ["Relational/NoSQL fundamentals","Schema design","SQL queries"],
    networking: ["TCP/IP (L3-L4)","Networking programming fundamentals"],
    security: ["Secure defaults","Threat-model awareness","Trust boundaries & Least privilege","Authentication/Authorization fundamentals"],
    testing: ["Unit & Integration & End-To-End test"],
    ai: ["ML fundamentals and familiarity","Familiarity with AI tools and integration, data labeling, datasets on training or fine-tuned"]
  },

  capabilities: [
    { id: "go", label: "Go", domain: "backend", level: "solid" },
    { id: "typescript", label: "TypeScript", domain: "backend", level: "solid" },
    { id: "node.js", label: "Node.js", domain: "backend", level: "solid" },
    { id: "express.js", label: "Express.js", domain: "backend", level: "solid" },
    { id: "gin", label: "Gin", domain: "backend", level: "solid" },
    { id: "laravel", label: "Laravel", domain: "backend", level: "familiar" },
    { id: "fiber", label: "Fiber", domain: "backend", level: "familiar" },
    { id: "rest", label: "REST", domain: "backend", level: "solid" },
    { id: "tls/http/grpc/websocket/webrtc", label: "TLS/HTTP/gRPC/WebSocket/WebRTC", domain: "backend", level: "solid" },
    { id: "graphql", label: "GraphQL", domain: "backend", level: "familiar" },
    { id: "external-service-integration", label: "External Service Integration", domain: "backend", level: "familiar" },
    { id: "mvc", label: "MVC", domain: "backend", level: "solid" },
    { id: "microservices", label: "Microservices", domain: "backend", level: "solid" },
    { id: "clean", label: "Clean Architecture", domain: "backend", level: "working" },
    { id: "postgresql", label: "PostgreSQL", domain: "database", level: "solid" },
    { id: "mongodb", label: "MongoDB", domain: "database", level: "solid" },
    { id: "sqlite", label: "SQLite", domain: "database", level: "familiar" },
    { id: "redis", label: "Redis", domain: "database", level: "familiar" },
    { id: "supabase", label: "Supabase", domain: "database", level: "familiar" },
    { id: "vue.js", label: "Vue.js", domain: "frontend", level: "solid" },
    { id: "nuxt.js", label: "Nuxt.js", domain: "frontend", level: "solid" },
    { id: "react", label: "React", domain: "frontend", level: "familiar" },
    { id: "web3-integration", label: "Web3 integration", domain: "frontend", level: "familiar" },
    { id: "auth", label: "AuthN/AuthZ (JWT, OAuth, MFA, RBAC)", domain: "security", level: "solid" },
    { id: "apigw", label: "Secure API gateway", domain: "security", level: "solid" },
    { id: "ratelimit", label: "Rate-limiting & abuse control", domain: "security", level: "solid" },
    { id: "inputval", label: "Input validation & sanitization", domain: "security", level: "solid" },
    { id: "docker", label: "Docker", domain: "devops", level: "familiar" },
    { id: "cicd", label: "CI/CD (GitHub Actions)", domain: "devops", level: "solid" },
    { id: "aws", label: "AWS/Azure fundamentals", domain: "devops", level: "solid" },
    { id: "cloudops", label: "Cloud deployment best practices", domain: "devops", level: "familiar" },
    { id: "git", label: "Git", domain: "tooling", level: "solid" },
    { id: "figma", label: "Figma", domain: "tooling", level: "solid" },
    { id: "wordpress", label: "WordPress", domain: "tooling", level: "solid" },
    { id: "vscode", label: "VSCode", domain: "tooling", level: "solid" },
    { id: "shell", label: "Shell/Bash", domain: "tooling", level: "solid" }
  ],

  evidence: [
    {
      id: "microservices-demo-(ts-+-go)",
      type: "lab",
      title: "Microservices demo (TS + Go)",
      period: "2024-12–2025-03",
      summary:
        "Small services communicating over REST; containerized with Docker; focus on modular boundaries and error handling.",
      tech: ["TypeScript","Go","Express","Gin","Docker"],
      status: "completed"
    },
    {
      id: "networking/traffic-prototypes",
      type: "lab",
      title: "Networking/traffic prototypes",
      period: "2025-01–2025-03",
      summary:
        "Experiments with TCP/IP handling, concurrency, and request shaping; emphasis on OS processes/resources.",
      tech: ["Go","TypeScript","Linux","Shell"],
      status: "completed"
    },
    {
      id: "aws-ec2-sandbox",
      type: "lab",
      title: "AWS EC2 sandbox",
      period: "2024-11–present",
      summary:
        "Practice deployments on EC2, security groups, Dockerized services, basic monitoring.",
      tech: ["AWS EC2","Docker","Ubuntu"],
      status: "completed"
    },
    {
      id: "blockchain-api-prototype",
      type: "lab",
      title: "Blockchain API prototype",
      period: "2025-02–2025-03",
      summary:
        "Go API with SQLite; experimented with Solidity contracts and FE Web3 integration; paused after initial week.",
      tech: ["Go","SQLite","Solidity (basic)","Web3 (basic)"],
      status: "paused"
    },
    {
      id: "shell-automation-scripts",
      type: "lab",
      title: "Shell automation scripts",
      period: "2024-10–present",
      summary:
        "Bash scripts for setup, deployment, and local tooling; fallback utilities.",
      tech: ["Bash","Linux"],
      status: "completed"
    },
    {
      id: "blockchain-developer-internship-(ai-generative-industry)",
      type: "work",
      title: "Blockchain Developer Internship (AI Generative Industry)",
      period: "2025-01–2025-04",
      summary:
        "Worked as a Blockchain Developer Intern, using Go in the AI generative industry. Explored blockchain integration and backend services.",
      tech: ["Go","Blockchain","AI"],
      status: "completed"
    },
    {
      id: "full-stack-developer-internship-(nuxt.js)",
      type: "work",
      title: "Full-Stack Developer Internship (Nuxt.js)",
      period: "2024-10–2025-01",
      summary:
        "Interned as a Full-Stack Developer at Golive Dev JSC, specializing in Nuxt.js and Vue.js. Developed front-end modules and integrated REST APIs.",
      tech: ["Nuxt.js","Vue.js","REST API","Git"],
      status: "completed"
    },
    {
      id: "wordpress-intern-(mevivu-co.,-ltd)",
      type: "work",
      title: "WordPress Intern (Mevivu Co., Ltd)",
      period: "2023-08–2023-11",
      summary:
        "Maintained and customized WordPress websites to support marketing needs. Translated Figma prototypes to responsive components.",
      tech: ["WordPress","Figma","HTML","CSS"],
      status: "completed"
    },
    {
      id: "jobs-watcher-core-(lab-evidence)",
      type: "lab",
      title: "Jobs Watcher Core (Lab Evidence)",
      period: "2024-10–2026-02",
      summary:
        "Development and refinement of the jobs-watcher codebase, focusing on backend architecture, metrics, and template rendering. Includes CI/CD, integration tests, and documentation workflows.",
      tech: ["TypeScript","Node.js","Jest","GitHub Actions","Markdown","Shell"],
      status: "completed"
    }
  ],

  experience: [
    {
      company: "Golive Dev JSC",
      position: "Full-Stack Developer",
      location: "Remote",
      startDate: "2024-10",
      endDate: "2025-01",
      highlights: ["Built and optimized Vue/Nuxt product modules, improving navigation flow and responsiveness","Integrated REST APIs end-to-end and tightened error handling to reduce regression risk","Collaborated with designers on UI states and accessibility, increasing clarity of user interactions","Used Git feature branches and reviews to keep changes scoped and traceable"]
    },
    {
      company: "Mevivu Co., Ltd",
      position: "Web Developer",
      location: "Ho Chi Minh City, Vietnam",
      startDate: "2023-08",
      endDate: "2023-11",
      highlights: ["Maintained and customized WordPress sites, ensuring stable releases and timely content updates","Created UI/UX prototypes in Figma to validate flows with stakeholders before build","Produced marketing assets and landing content aligned with campaign timelines"]
    },
    {
      company: "Blockchain Developer Internship (AI Generative Industry)",
      position: "Blockchain Developer Intern",
      location: "Remote",
      startDate: "2025-01",
      endDate: "2025-04",
      highlights: ["Explored blockchain integration and backend services using Go in AI generative industry."]
    }
  ],

  education: [
    {
      institution: "Ho Chi Minh City Open University",
      degree: "Bachelor of Information Technology",
      field: "Software Technology",
      startDate: "2020",
      endDate: "2025",
      gpa: "3.0/4.0"
    }
  ]
}

/* ============================================================
 * Hard Clustering (Mode 1)
 * ============================================================
 * Groups capabilities by domain with clear boundaries.
 * Each capability belongs to exactly one cluster.
 */

export interface CapabilityCluster {
  domain: string
  capabilities: ProfileCore["capabilities"]
  averageScore: number
  evidenceCoverage: {
    work: number
    lab: number
    thesis: number
  }
}

/**
 * Helper function to infer capability IDs from tech stack
 */
function inferCapabilitiesFromTech(techStack: string[]): string[] {
  const capabilityIds: string[] = []
  const techLower = techStack.map(t => t.toLowerCase())
  
  const techMap: Record<string, string> = {
    // Languages
    "go": "go",
    "golang": "go",
    "typescript": "typescript",
    
    // Backend frameworks (match actual capability IDs with dots)
    "node": "node.js",
    "node.js": "node.js",
    "nodejs": "node.js",
    "express": "express.js",
    "express.js": "express.js",
    "gin": "gin",
    "fiber": "fiber",
    "laravel": "laravel",
    
    // API/Protocols
    "rest": "rest",
    "restful": "rest",
    "graphql": "graphql",
    "tls": "tls/http/grpc/websocket/webrtc",
    "http": "tls/http/grpc/websocket/webrtc",
    "https": "tls/http/grpc/websocket/webrtc",
    "grpc": "tls/http/grpc/websocket/webrtc",
    "websocket": "tls/http/grpc/websocket/webrtc",
    "webrtc": "tls/http/grpc/websocket/webrtc",
    
    // Architecture
    "microservices": "microservices",
    "mvc": "mvc",
    "clean": "clean",
    "clean architecture": "clean",
    
    // Databases (match actual capability IDs)
    "postgres": "postgresql",
    "postgresql": "postgresql",
    "mongo": "mongodb",
    "mongodb": "mongodb",
    "sqlite": "sqlite",
    "redis": "redis",
    "supabase": "supabase",
    
    // Frontend frameworks
    "vue": "vue.js",
    "vue.js": "vue.js",
    "nuxt": "nuxt.js",
    "nuxt.js": "nuxt.js",
    "react": "react",
    "web3": "web3-integration",
    
    // Security
    "auth": "auth",
    "authentication": "auth",
    "authorization": "auth",
    "jwt": "auth",
    "oauth": "auth",
    "api gateway": "apigw",
    "rate limit": "ratelimit",
    "rate-limit": "ratelimit",
    "validation": "inputval",
    "input validation": "inputval",
    
    // DevOps
    "docker": "docker",
    "ci/cd": "cicd",
    "github actions": "cicd",
    "aws": "aws",
    "aws ec2": "aws",
    "azure": "aws",
    "cloud": "cloudops",
    
    // Tooling
    "git": "git",
    "figma": "figma",
    "wordpress": "wordpress",
    "vscode": "vscode",
    
    // OS/Shell
    "linux": "shell",
    "ubuntu": "shell",
    "bash": "shell",
    "shell": "shell"
  }
  
  for (const tech of techLower) {
    const capId = techMap[tech]
    if (capId && !capabilityIds.includes(capId)) {
      capabilityIds.push(capId)
    }
  }
  
  return capabilityIds
}

/**
 * Cluster capabilities by domain (hard boundaries).
 * Returns clusters sorted by average score descending.
 */
export function clusterCapabilities(): CapabilityCluster[] {
  const clusters = new Map<string, ProfileCore["capabilities"]>()
  
  // Group capabilities by domain
  for (const capability of profile.capabilities) {
    const domain = capability.domain
    if (!clusters.has(domain)) {
      clusters.set(domain, [])
    }
    clusters.get(domain)!.push(capability)
  }
  
  // Convert to cluster objects with computed metrics
  const result: CapabilityCluster[] = []
  
  for (const [domain, capabilities] of clusters) {
    // Calculate average score for this domain
    const scores = capabilities.map(cap => {
      const level = LevelStrength[cap.level]
      return level
    })
    const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length
    
    // Calculate evidence coverage (how many capabilities have evidence of each type)
    const evidenceCoverage = {
      work: 0,
      lab: 0,
      thesis: 0
    }
    
    for (const capability of capabilities) {
      // Check if any evidence of each type mentions this capability in tech stack
      const hasWorkEvidence = profile.evidence.some(
        e => e.type === "work" && inferCapabilitiesFromTech(e.tech).includes(capability.id)
      )
      const hasLabEvidence = profile.evidence.some(
        e => e.type === "lab" && inferCapabilitiesFromTech(e.tech).includes(capability.id)
      )
      const hasThesisEvidence = profile.evidence.some(
        e => e.type === "thesis" && inferCapabilitiesFromTech(e.tech).includes(capability.id)
      )
      
      if (hasWorkEvidence) evidenceCoverage.work++
      if (hasLabEvidence) evidenceCoverage.lab++
      if (hasThesisEvidence) evidenceCoverage.thesis++
    }
    
    result.push({
      domain,
      capabilities: capabilities.sort((a, b) => LevelStrength[b.level] - LevelStrength[a.level]),
      averageScore,
      evidenceCoverage
    })
  }
  
  // Sort clusters by average score descending
  return result.sort((a, b) => b.averageScore - a.averageScore)
}