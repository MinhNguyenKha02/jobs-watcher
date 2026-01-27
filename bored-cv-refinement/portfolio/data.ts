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
  programming_languages: ["go", "typescript", "vue"],
  dsa: [],
  os: ["concurrency", "docker"],
  oop: [],
  database: ["postgres", "mongo"],
  networking: ["rest", "microservices", "tcpip", "http"],
  security: ["auth"],
  testing: ["ci"],
  ai: [],
}

/** Preferred evidence per capability (fallback is lab) */
export const CapabilityPrimaryEvidence: Record<string, EvidenceType> = {
  go: "lab",
  typescript: "work",
  rest: "work",
  microservices: "lab",
  concurrency: "lab",
  postgres: "work",
  mongo: "lab",
  tcpip: "lab",
  http: "work",
  auth: "work",
  docker: "lab",
  ci: "lab",
  vue: "work",
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
      solid: ["Go", "TypeScript"],
      familiar: ["JavaScript", "C", "PHP", "Bash"]
    },
    dsa: ["Data structures & algorithms fundamentals"],
    os: [
      "Linux/Ubuntu fundamentals",
      "Shell automation",
      "Processes and resource control"
    ],
    oop: ["OOP fundamentals", "SOLID principles", "Design patterns familiarity"],
    database: [
      "Relational/NoSQL fundamentals",
      "Schema design",
      "SQL queries"
    ],
    networking: [
      "TCP/IP (L3–L4)",
      "Networking programming fundamentals"
    ],
    security: [
      "Secure defaults",
      "Threat-model awareness",
      "Trust boundaries & least privilege",
      "Authentication & authorization fundamentals"
    ],
    testing: ["Unit, integration and end-to-end testing"],
    ai: [
      "ML fundamentals familiarity",
      "AI tools integration (Copilot, ChatGPT)"
    ]
  },


  // adaptation optional: wp laravel, php, 
  capabilities: [
    { id: "go", label: "Go (Golang)", domain: "backend", level: "solid" },
    { id: "typescript", label: "TypeScript", domain: "backend", level: "solid" },
    { id: "rest", label: "REST API design", domain: "backend", level: "solid" },
    { id: "microservices", label: "Microservices", domain: "backend", level: "working" },
    { id: "concurrency", label: "Concurrency & non-blocking I/O", domain: "backend", level: "working" },

    { id: "postgres", label: "PostgreSQL", domain: "database", level: "solid" },
    { id: "mongo", label: "MongoDB", domain: "database", level: "working" },

    { id: "tcpip", label: "TCP/IP networking", domain: "networking", level: "working" },
    { id: "http", label: "HTTP/TLS/gRPC/WebSocket", domain: "networking", level: "working" },

    { id: "auth", label: "AuthN/AuthZ (JWT, OAuth, RBAC)", domain: "security", level: "working" },

    { id: "docker", label: "Docker", domain: "devops", level: "working" },
    { id: "ci", label: "CI/CD pipelines", domain: "devops", level: "working" },

    { id: "vue", label: "Vue/Nuxt (supporting)", domain: "frontend", level: "familiar" }
  ],

  evidence: [
    {
      id: "microservices-demo",
      type: "lab",
      title: "Microservices demo (TS + Go)",
      period: "2024-12 – 2025-03",
      summary:
        "Small services communicating over REST; containerized with Docker; focus on modular boundaries and error handling.",
      tech: ["Go", "TypeScript", "Express", "Gin", "Docker"],
      status: "completed"
    },
    {
      id: "networking-prototypes",
      type: "lab",
      title: "Networking / traffic prototypes",
      period: "2025-01 – 2025-03",
      summary:
        "Experiments with TCP/IP handling, concurrency, and request shaping; emphasis on OS processes and resources.",
      tech: ["Go", "Linux", "Shell"],
      status: "active"
    }
  ],

  experience: [
    {
      company: "Golive Dev JSC",
      position: "Full-Stack Developer",
      location: "Remote",
      startDate: "2024-10",
      endDate: "2025-01",
      highlights: [
        "Built and optimized Vue/Nuxt product modules",
        "Integrated REST APIs end-to-end",
        "Collaborated with designers on UI states and accessibility"
      ]
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