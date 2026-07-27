import type { AtsSkillSection } from '../resume/compiler/ats-skill-group.compiler.js'
import type { RetrievalEvidenceScore } from '../artifacts/types/artifact.types.js'
import type { Trace } from '../retrieval/retrieval-debugger.js'

export type ResolveOutput = {
    skills: AtsSkillSection
    experiences: RetrievalEvidenceScore[]
    projects: RetrievalEvidenceScore[]
    traces: Trace[]
}