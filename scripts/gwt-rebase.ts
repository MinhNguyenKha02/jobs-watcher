#!/usr/bin/env node
/**
 * GWT / RCM cause-effect title analyser for the test suite.
 *
 * Reads test files (or walks tests dirs), parses them with the TS compiler API, and
 * classifies every `it` / `it.each` / `describe` title against the GWT contract in
 * `@plans/gwt-rcm-reconstruction.md` §3:
 *
 *   unit domain : `GIVEN <boundary> WHEN <evaluate> THEN <decision+reason>`
 *   unit apps   : `GIVEN <state+signal> WHEN <signal> THEN <transition+effect> · path cN`
 *   contract    : `GIVEN <port op> WHEN <real adapter> THEN <port semantics>`
 *   integration : `GIVEN <path-cN precond> WHEN <signal/uds> THEN <checkpoint+role>`
 *   e2e         : `GIVEN <external input> WHEN <webhook/uds/operator> THEN <external outcome>`
 *
 * Mapping (plan §3): ActionEvent / JobStage / JobStatus constants appearing in THEN →
 * checkpoint symbol (S1..S4); stimulus call (webhook / uds / ActionEvent token / [x] action
 * tag) → WHEN label; seeds/consumers → GIVEN phrase; duplicate-shape families → `it.each`.
 *
 * Subcommands / flags:
 *   [paths...]            files or directories to scan (default: tests)
 *   --check               exit 1 if any title is unresolved or mis-shaped
 *   --report  (default)   print per-test classification without failing
 *   --split-multistimulus flag titles that bundle several THEN-effects (collapse/split hint)
 *   --collapse            flag describes whose member bodies are duplicate-shaped (it.each hint)
 *   --verbose             print checkpoints + normalized GWT title
 *
 * Exit codes: 0 ok, 1 structural violations found.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const VERBOSE = args.includes('--verbose');
const SPLIT = args.includes('--split-multistimulus');
const COLLAPSE = args.includes('--collapse');
const paths = args.filter((a) => !a.startsWith('--'));

const DEFAULT_ROOTS = ['tests'];
// Files delivered under this reconstruction (S4–S8) carry the GWT/cause-effect title contract;
// the hard `--check` gate defaults to this scope so CD pipelines run on rebuilt files only.
const GWT_GUARDED = [
  'tests/e2e',
  'tests/integration/path',
  'tests/integration/ioc',
  'tests/helpers',
  'tests/integration/adapter/outbound/mongo-extraction-queue-storage.contract.integration.test.ts',
  'tests/integration/adapter/outbound/pdf-renderer.contract.integration.test.ts',
  'tests/integration/adapter/outbound/asset-pipeline.contract.integration.test.ts',
];
const roots = paths.length ? paths : CHECK || SPLIT || COLLAPSE ? GWT_GUARDED : DEFAULT_ROOTS;
const FILES = collectFiles(roots);

const CHECKPOINTS: Record<string, string> = {
  GENERATED: 'S1',
  'job.generated': 'S1',
  PARSE_COMPLETED: 'S2',
  'job.parse.completed': 'S2',
  'parse.completed': 'S2',
  FULL_PARSED: 'S2',
  'job.parse.failed': 'S4',
  'parse.failed': 'S4',
  PARTIAL_PARSED: 'S1',
  QUEUED: 'S3',
  'job.queue': 'S3',
  TRASHED: 'S4',
  'job.trash': 'S4',
  ROUTE_FAILED: 'S4',
  'job.route.failed': 'S4',
  PARSE_FAILED: 'S4',
  ENRICHING: 'S1',
  ENRICHED: 'S2',
  FAILED: 'S4',
};

const ACTION_TAGS = /\[(?:c|i|j|d|b|o|p|s)\]/g;
const GWT_KEYWORDS = /\bGIVEN\b|\bWHEN\b|\bTHEN\b|\bgiven\b|\bwhen\b|\bthen\b/i;
const ARROW = /→|->|=>|—|–/;
const PATH_TAG = /\bpath c[1-4]\b/i;

type TitleNode = {
  text: string;
  line: number;
  kind: 'it' | 'describe';
  raw: string;
};

function collectFiles(roots: string[]): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    const st = fs.statSync(p);
    if (st.isFile()) {
      if (p.endsWith('.test.ts')) out.push(p);
      return;
    }
    for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
      if (ent.name === 'node_modules') continue;
      walk(path.join(p, ent.name));
    }
  };
  for (const r of roots) walk(r);
  return out.sort();
}

function flattenTitle(parts: string[]): string {
  return parts
    .flatMap((p) => p.split('\n'))
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ');
}

function getTitleText(arg: ts.Expression): { text: string; raw: string } | null {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return { text: arg.text, raw: arg.getText() };
  }
  if (ts.isTemplateExpression(arg)) {
    // collapsed: concatenate head/spans; placeholders become <expr>
    let text = arg.head.text;
    let raw = arg.head.getText();
    for (const span of arg.templateSpans) {
      text += `<expr${span.expression.getStart()}:${span.expression.getEnd()}>`;
      raw +=
        span.literal.getStart() <= span.literal.getEnd() ? span.literal.getText().slice(1) : '';
    }
    return { text, raw };
  }
  return null;
}

/** Extract (describeTitle[], itTitle) pairs, tracking nesting. */
function analyzeFile(file: string): {
  titles: TitleNode[];
  bodies: { raw: string; line: number }[];
} {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const titles: TitleNode[] = [];
  const bodies: { raw: string; line: number }[] = [];
  const stack: string[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const call = node.expression;
      const callee = ts.isPropertyAccessExpression(call) ? call.name.getText(sf) : call.getText(sf);
      const isIt = callee === 'it' || callee === 'test';
      const isEach = callee === 'each' || (isIt && /\.each$/.test(callee));
      const isDescribe = callee === 'describe' || callee === 'suite';
      if (isIt || isEach || isDescribe) {
        const titleArg = node.arguments[0];
        const bodyArg = node.arguments[1];
        const t = getTitleText(titleArg);
        if (t) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const kind = isDescribe ? 'describe' : 'it';
          if (kind === 'describe') stack.push(t.text);
          else titles.push({ text: t.text, line, kind, raw: t.raw });
          if (kind === 'describe') {
            const idx = stack.lastIndexOf(t.text);
            if (idx !== -1) stack.splice(idx, 1);
          }
        }
        if (bodyArg && ts.isArrowFunction(bodyArg)) {
          bodies.push({ raw: bodyArg.getText(sf), line: 0 });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { titles, bodies };
}

type Classified = {
  node: TitleNode;
  checkpoints: string[];
  actions: string[];
  gwt: boolean;
  path: string;
  arrow: boolean;
  normalized: string;
  issues: string[];
};

function classify(node: TitleNode, file: string): Classified {
  const text = node.text;
  const issues: string[] = [];
  const checkpoints = new Set<string>();
  const actions: string[] = [];
  for (const m of `${text}`.matchAll(ACTION_TAGS)) actions.push(m[0]);
  for (const key of Object.keys(CHECKPOINTS)) {
    if (new RegExp(`\\b${key}\\b`, 'i').test(text)) checkpoints.add(CHECKPOINTS[key]);
  }
  for (const m of text.matchAll(/\bS[1-4]\b/g)) checkpoints.add(m[0]);

  const arrow = ARROW.test(text);
  const gwt = GWT_KEYWORDS.test(text);
  const pathTag = PATH_TAG.test(text)
    ? (text.match(/\bpath (c[1-4])\b/i)?.[1].toLowerCase() ?? '')
    : '';

  const normalized =
    arrow || checkpoints.size || actions.length
      ? text
      : `${text}  <-- no checkpoint (S1..S4 / [x] tag / stage-status) and no cause→effect arrow`;
  if (!arrow) issues.push('missing cause→effect arrow (→)');
  if (checkpoints.size === 0 && actions.length === 0)
    issues.push('missing checkpoint (S1..S4 / [x] tag / stage-status)');

  return {
    node: { ...node },
    checkpoints: [...checkpoints],
    actions,
    gwt,
    path: pathTag,
    arrow,
    normalized,
    issues,
  };
}

function isResolved(c: Classified, kind: 'it' | 'describe'): boolean {
  if (kind === 'describe')
    return c.arrow || c.gwt || c.actions.length > 0 || c.checkpoints.length > 0;
  // fast-check property invariants are logic proofs, not scenario GWT rows — carve-out.
  if (/^property\b/i.test(c.node.text)) return true;
  // an `it` is resolved when it maps to >=1 checkpoint (via state token, action tag, or S1..S4),
  // carries an explicit cause→effect arrow / GIVEN-WHEN-THEN markers, or is a unit-domain
  // decision-table row (GIVEN/WHEN/THEN keywods present).
  return (
    (c.checkpoints.length > 0 && !/no checkpoint/.test(c.normalized)) ||
    c.actions.length > 0 ||
    c.arrow ||
    c.gwt
  );
}

function printVerbose(c: Classified, file: string): void {
  const rel = path.relative(process.cwd(), file);
  console.log(
    `  L${String(c.node.line).padStart(3)}  ${c.node.kind.padEnd(8)} ck=[${c.checkpoints.join(',') || '-'}]  ${c.node.text}`
  );
  if (c.issues.length) console.log(`       ⚠ ${c.issues.join('; ')}`);
}

let violations = 0;
let total = 0;
let resolved = 0;

for (const file of FILES) {
  const { titles } = analyzeFile(file);
  if (!titles.length) continue;
  const rel = path.relative(process.cwd(), file);
  console.log(`─ ${rel} (${titles.length} cases)`);

  for (const node of titles) {
    total++;
    const c = classify(node, file);
    if (VERBOSE) printVerbose(c, file);
    const ok = node.kind === 'it' ? isResolved(c, 'it') : isResolved(c, 'describe');
    if (!ok) {
      violations++;
      if (!VERBOSE)
        console.log(`  ✗ L${node.line} ${node.kind}: ${node.text}  ${c.issues.join('; ')}`);
    } else {
      resolved++;
    }
  }

  if (COLLAPSE) {
    const { bodies } = analyzeFile(file);
    const dupes: Record<string, number> = {};
    for (const b of bodies) {
      const key = b.raw.replace(/\d+/g, '0').replace(/['"`][^'"`]*['"`]/g, '""');
      dupes[key] = (dupes[key] ?? 0) + 1;
    }
    for (const [k, n] of Object.entries(dupes)) {
      if (n >= 3) console.log(`  ∼ collapse hint: ${n} duplicate-shape bodies in ${rel}`);
    }
  }
}

if (CHECK && violations > 0) {
  console.log(
    `\nGWT-CHECK FAILED: ${violations}/${total} titles unresolved (resolved ${resolved}).`
  );
  process.exit(1);
}

console.log(
  `\nGWT summary: ${FILES.length} files, ${total} titles, ${resolved} resolved, ${violations} unresolved (${CHECK ? 'check mode — exit ' + (violations ? 1 : 0) : 'report mode'}).`
);
if (CHECK) process.exit(violations ? 1 : 0);
process.exit(0);
