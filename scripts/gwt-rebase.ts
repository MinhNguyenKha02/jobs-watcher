#!/usr/bin/env node
/**
 * GWT / RCM cause-effect title rebaser for the test suite (one-shot).
 *
 * Rewrites every `it` / `test` / `it.each` title across the scanned test files into the
 * uniform GIVEN / WHEN / THEN shape mandated by `@plans/gwt-rcm-reconstruction.md` §3:
 *
 *   unit domain : `GIVEN <boundary> WHEN <evaluate> THEN <decision+reason>`
 *   unit apps   : `GIVEN <state+signal> WHEN <signal> THEN <transition+effect> · path cN`
 *   contract    : `GIVEN <port op> WHEN <real adapter> THEN <port semantics>`
 *   integration : `GIVEN <path-cN precond> WHEN <signal/uds> THEN <checkpoint+role> · path cN`
 *   e2e         : `GIVEN <external input> WHEN <webhook/uds/operator> THEN <external outcome>`
 *
 * The engine preserves the original distinctive phrasing (the observable clause) and only
 * re-frames it as GIVEN-state / WHEN-stimulus / THEN-outcome using body analysis (stages,
 * statuses, events, port calls). `it.each` titles keep their `%s` table prose and are never
 * split into per-row cases; fast-check `property:` invariants are left untouched. Duplicate
 * generated titles within a file get an ordinal ` (N)` suffix.
 *
 * Usage:
 *   npx tsx scripts/gwt-rebase.ts [paths...] [--rewrite] [--check] [--report] [--dry-run] [--verbose]
 *
 *   paths     files or directories to scan (default: tests). Also picks up `.spec.ts`.
 *   --rewrite apply the title rebase in place (one-shot; idempotent on re-run).
 *   --check   exit 1 if any `it` title is unresolved (like the CD gate).
 *   --report  (default) print per-test classification without editing.
 *   --dry-run compute + print the plan without writing files (use together with --rewrite).
 *   --verbose include the composed GIVEN/WHEN/THEN in the report.
 *
 * Exit codes: 0 ok, 1 structural violations found.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const args = process.argv.slice(2);
const REWRITE = args.includes('--rewrite');
const CHECK = args.includes('--check');
const VERBOSE = args.includes('--verbose');
const DRY_RUN = args.includes('--dry-run');
const REPORT = !REWRITE && !CHECK;
const paths = args.filter((a) => !a.startsWith('--'));

const DEFAULT_ROOTS = ['tests'];
const FILES = collectFiles(paths.length ? paths : DEFAULT_ROOTS);

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
const GWT_KEYWORDS = /\bGIVEN\b|\bWHEN\b|\bTHEN\b/i;
const ARROW = /→|->|=>|—|–/;
const STATUS_TOKEN_RE =
  /\b(GENERATED|PARSE_COMPLETED|PARSE_FAILED|QUEUED|TRASHED|ROUTE_FAILED|ENRICHING|ENRICHED|FULL_PARSED|PARTIAL_PARSED)\b/g;
const EMIT_RE =
  /\b(emitGenerated|emitCompleted|emitFailed|emitJobQueued|emitJobTrashed|emitRouteFailed)\b/g;

type TitleNode = {
  text: string;
  line: number;
  kind: 'it' | 'describe';
  raw: string;
  start: number;
  end: number;
  describes: string[];
  each: boolean;
  template: boolean;
  body: string;
};

type Edit = { start: number; end: number; replacement: string };

function collectFiles(roots: string[]): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    const st = fs.statSync(p);
    if (st.isFile()) {
      if (p.endsWith('.test.ts') || p.endsWith('.spec.ts')) out.push(p);
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

/** Detect it/test/it.each/describe calls and return a title node when the title is a literal. */
function findTitleNode(node: ts.CallExpression, sf: ts.SourceFile): TitleNode | null {
  const expr = node.expression;
  const inner = (ts.isCallExpression(expr) ? expr.expression : null) as ts.Expression | null;
  const access =
    inner && ts.isPropertyAccessExpression(inner)
      ? inner
      : ts.isPropertyAccessExpression(expr)
        ? expr
        : null;
  let each = false;
  let callee: string | null = null;
  if (access && access.name.text === 'each') {
    const base = access.expression;
    if (ts.isIdentifier(base) && (base.text === 'it' || base.text === 'test')) {
      each = true;
      callee = 'it';
    }
  } else if (ts.isIdentifier(expr)) {
    callee = expr.text;
  }
  if (!callee) return null;
  const isDescribe = callee === 'describe' || callee === 'suite';
  const isIt = each || callee === 'it' || callee === 'test';
  if (!isDescribe && !isIt) return null;

  const titleArg = node.arguments[0];
  const t = titleArg ? getTitleText(titleArg) : null;
  if (!t) return null;

  const start = titleArg.getStart(sf);
  const end = titleArg.getEnd();
  const line = sf.getLineAndCharacterOfPosition(start).line + 1;
  const bodyArg = node.arguments[node.arguments.length - 1];
  const body = bodyArg && ts.isFunctionLike(bodyArg) ? bodyArg.getText(sf) : '';
  return {
    ...t,
    line,
    kind: isDescribe ? 'describe' : 'it',
    start,
    end,
    describes: [],
    each,
    template: t.template,
    body,
  };
}

function getTitleText(arg: ts.Expression): { text: string; raw: string; template: boolean } | null {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return { text: arg.text, raw: arg.getText(), template: false };
  }
  if (ts.isTemplateExpression(arg)) {
    let text = arg.head.text;
    for (const span of arg.templateSpans)
      text += `<expr${span.expression.getStart()}:${span.expression.getEnd()}>`;
    return { text, raw: arg.getText(), template: true };
  }
  return null;
}

function analyzeFile(file: string): { titles: TitleNode[]; sourceFile: ts.SourceFile } {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const titles: TitleNode[] = [];
  const stack: string[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const titleNode = findTitleNode(node, sf);
      if (titleNode) {
        if (titleNode.kind === 'describe') {
          stack.push(titleNode.text);
          titleNode.describes = [...stack];
          titles.push(titleNode);
        } else {
          titleNode.describes = [...stack];
          titles.push(titleNode);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { titles, sourceFile: sf };
}

type Info = {
  checkpoints: string[];
  statuses: string[];
  emits: string[];
  stimuli: string[];
  toBeStatus: string[];
  reasons: string[];
};

function bodyInfo(body: string): Info {
  const checkpoints = new Set<string>();
  for (const key of Object.keys(CHECKPOINTS)) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${esc}\\b`, 'i').test(body)) checkpoints.add(CHECKPOINTS[key]);
  }
  const statuses = [...new Set(body.match(STATUS_TOKEN_RE) || [])];
  const emits = [...new Set(body.match(EMIT_RE) || [])];
  const toBeStatus: string[] = [];
  for (const m of body.match(/\.toBe\((?:JobStage\.|JobStatus\.)?[A-Z_]+\)/g) || []) {
    toBeStatus.push(m.replace(/\.toBe\((?:JobStage\.|JobStatus\.)?/, '').replace(/\)$/, ''));
  }
  const reasons: string[] = [];
  for (const r of body.match(/reasons:\s*\[[^\]]*\]/g) || []) {
    const q = r.match(/['"]([^'"]+)['"]/);
    if (q) reasons.push(q[1]);
  }
  return {
    checkpoints: [...checkpoints],
    statuses,
    emits,
    stimuli: stimulusChain(body),
    toBeStatus,
    reasons,
  };
}

function stimulusChain(body: string): string[] {
  const PATTERNS: Array<[RegExp, string]> = [
    [/processIngest\s*\(/g, 'an ingest signal is processed'],
    [/processResolution\s*\(/g, 'a resolution is applied'],
    [/\bwebhook\.post\s*\(/g, 'the webhook is posted'],
    [/\buds\.ingest\s*\(/g, 'the UDS ingest socket is hit'],
    [/\buds\.action\s*\(/g, 'a UDS action is dispatched'],
    [/\brenderPdf\s*\(/g, 'the PDF renderer runs'],
    [/\btoAsset\s*\(/g, 'the asset pipeline runs'],
    [/\bextractAllJobs\s*\(/g, 'extractAllJobs runs'],
    [/\bparseJobFromHtml\s*\(/g, 'parseJobFromHtml runs'],
    [/\bflattenJob\s*\(/g, 'flattenJob runs'],
    [/\benqueue\s*\(/g, 'the extraction queue is enqueued'],
    [/\bdequeue\s*\(/g, 'the extraction queue is dequeued'],
    [/\bbrowser\.extract\s*\(/g, 'browser extraction runs'],
    [/\bscheduler\.start\s*\(/g, 'the scheduler starts'],
    [/\bscheduler\.stop\s*\(/g, 'the scheduler stops'],
    [/\bupdateStage\s*\(/g, 'updateStage is applied'],
    [/\bfindById\s*\(/g, 'findById loads the doc'],
  ];
  const found: Array<{ idx: number; label: string }> = [];
  for (const [re, label] of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let matched = false;
    while (!matched && (m = re.exec(body))) {
      found.push({ idx: m.index, label });
      matched = true;
    }
  }
  found.sort((a, b) => a.idx - b.idx);
  return [...new Set(found.map((f) => f.label))].slice(0, 4);
}

function invert(text: string): { given?: string; effect: string } {
  const t = text.replace(/^should\s+/i, '');
  const cause =
    t.match(/^cause:\s*(.+?)\s*→\s*effect:\s*(.+)$/i) ||
    t.match(/^cause:\s*(.+?)\s*->\s*effect:\s*(.+)$/i);
  if (cause) return { given: cause[1].trim(), effect: cause[2].trim() };
  const ifThen = t.match(/^\s*if\s+(.+?)\s+then\s+(.+?)$/i);
  if (ifThen) return { given: ifThen[1], effect: ifThen[2] };
  const wm = t.search(/\s+when\s+/i);
  if (wm > 0 && t.slice(wm + 5).trim())
    return { given: t.slice(wm + 5).trim(), effect: t.slice(0, wm).trim() };
  const im = t.search(/\s+if\s+/i);
  if (im > 0 && t.slice(im + 3).trim())
    return { given: t.slice(im + 3).trim(), effect: t.slice(0, im).trim() };
  return { effect: t };
}

function subjectFromDescribes(describes: string[]): string | null {
  const cleanIdent = /^[A-Za-z_$][\w$]*(\.[\w$]*)?$/;
  for (let i = describes.length - 1; i >= 0; i--) {
    const d = describes[i].trim();
    if (cleanIdent.test(d) && !/^(test|suite|files?)$/i.test(d)) return d;
  }
  return null;
}

function findSubjectInput(subject: string, body: string): string | null {
  const esc = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc}\\s*\\(\\s*([^,()]*)`, '');
  const m = body.match(re);
  if (!m) return null;
  const raw = m[1].trim();
  if (/^['"]/.test(raw)) return raw.slice(1, -1).replace(/['"]$/, '');
  if (raw === 'null') return 'null';
  if (raw === 'undefined') return 'undefined';
  if (raw === "''" || raw === '""') return 'empty string';
  if (!raw) return 'empty string';
  return raw;
}

function firstMeaningfulCall(body: string): string | null {
  return meaningfulCalls(body)[0] ?? null;
}

const PORT_OPS = new Set([
  'enqueue',
  'dequeue',
  'size',
  'onEnqueue',
  'upsert',
  'findById',
  'updateStage',
  'clearDb',
  'start',
  'stop',
  'extract',
  'renderPdf',
  'toAsset',
  'toPdf',
  'retrieve',
  'resolve',
  'processIngest',
  'processResolution',
  'ingest',
  'action',
  'getQueueMode',
  'sendToQueue',
  'assertQueue',
  'publish',
  'subscribe',
  'createConsumer',
  'nack',
  'ack',
  'emitGenerated',
  'emitCompleted',
  'emitFailed',
  'emitJobQueued',
  'emitJobTrashed',
  'emitRouteFailed',
]);

function portOps(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\b([a-zA-Z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const name = m[1];
    if (PORT_OPS.has(name) && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out.slice(0, 3);
}

function meaningfulCalls(body: string): string[] {
  const re = /\b(?:await\s+)?(?:expect\([^)]*\)\.)?([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)+)\s*\(/g;
  const JUNK_SUFFIX =
    /\.(toHaveBeenCalled[A-Za-z]*|toBe[A-Za-z]*|toEqual|toMatch[A-Za-z]*|toContain[A-Za-z]*|toThrow[A-Za-z]*|rejects|resolves|not)$/;
  const JUNK_PREFIX = /^(null|undefined|true|false|not|expect)\./;
  const JUNK_MOCK = /(^|\.)mock[A-Za-z]*$/;
  const STATIC =
    /^(fs|path|os|Buffer|JSON|URL|Math|Promise|Date|Object|Array|String|Number|Error|RegExp|console|process)\./;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(body))) {
    const tok = m[1];
    if (
      JUNK_SUFFIX.test(tok) ||
      JUNK_PREFIX.test(tok) ||
      JUNK_MOCK.test(tok) ||
      STATIC.test(tok) ||
      seen.has(tok)
    )
      continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

function subjectLabel(describes: string[]): string {
  if (describes.length) {
    const m = describes[0].match(/[a-zA-Z_$][\w$]*/);
    if (m) return m[0];
  }
  const last = describes[describes.length - 1];
  if (last) return last.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  return 'the system';
}

function levelOf(file: string): string {
  if (file.includes('/e2e/')) return 'e2e';
  if (file.includes('/integration/path/')) return 'integ-path';
  if (file.includes('/unit/application/')) return 'unit-app';
  if (file.includes('/unit/domain/')) return 'unit-domain';
  if (file.includes('/adapter/') || file.includes('/ioc/')) return 'contract';
  if (file.includes('/integration/')) return 'integ';
  if (file.includes('/unit/')) return 'unit';
  return 'unit';
}

function pathOf(file: string): string | null {
  const m = file.match(/\/c([1-4])\//);
  return m ? `c${m[1]}` : null;
}

function checkpointSummary(info: Info): string {
  if (info.checkpoints.length) return info.checkpoints.join('+');
  if (info.statuses.length) return info.statuses.join('→');
  return '';
}

function composeUnitDomain(node: TitleNode, info: Info): string {
  const { given, effect } = invert(node.text);
  const subject = subjectFromDescribes(node.describes) || subjectLabel(node.describes);
  const input = findSubjectInput(subject, node.body + ' ' + node.describes.join(' '));
  const boundary =
    given && given !== effect ? given : input ? `${subject} input "${input}"` : subject;
  const decision = decisionFromBody(info, effect);
  return `GIVEN ${boundary} WHEN ${subject} evaluates THEN ${decision}`;
}

function decisionFromBody(info: Info, effect: string): string {
  const s = info.statuses.join(' → ');
  if (!info.reasons.length) return s || effect;
  const r = info.reasons[0];
  if ((effect + ' ' + s).toLowerCase().includes(r.toLowerCase())) return effect;
  return `${effect} (reason: ${r})`;
}

function composeUnitApp(node: TitleNode, info: Info, file: string): string {
  const { given, effect } = invert(node.text);
  const whenChain = info.stimuli.length
    ? info.stimuli.slice(0, 3).join(' → ')
    : 'the app is driven';
  let g = given;
  const lastDescribe = node.describes[node.describes.length - 1] || '';
  if (!g) {
    if (/PARTIAL_PARSED|makeStage1Partial/.test(node.body)) g = 'an S1 partial job';
    else if (/FULL_PARSED|PARSE_COMPLETED/.test(node.body)) g = 'an S2 full-parse job';
    else g = lastDescribe || 'the wiring-state precondition';
  }
  const statusChain = info.toBeStatus.length ? info.toBeStatus.join(' → ') : '';
  const thenCore = effect || statusChain || 'the expected transition is observed';
  const ck = checkpointSummary(info);
  let thenF = thenCore;
  if (ck && !thenF.includes(ck)) thenF = `${thenCore} (${ck})`;
  const p = pathOf(file) || (file.includes('extraction-scheduler') ? 'c2' : null);
  return `GIVEN ${g} WHEN ${whenChain} THEN ${thenF}${p ? ` · path ${p}` : ''}`;
}

function composeContract(node: TitleNode, info: Info): string {
  const clean = node.text.replace(/\s+/g, ' ').trim();
  const adapter = subjectLabel(node.describes);
  const ops = portOps(node.body);
  const whenOp = ops.slice(0, 3).join(' → ') || info.stimuli[0] || 'the port is exercised';
  const comp = info.checkpoints.length ? ` (${checkpointSummary(info)})` : '';
  return `GIVEN the ${adapter} precondition WHEN ${whenOp} on the real ${adapter} THEN ${clean}${comp}`;
}

function whenForEffect(effect: string, info: Info): string {
  const e = effect.toUpperCase();
  if (e.includes('PARSE_FAILED')) return 'the parse fails';
  if (e.includes('ROUTE_FAILED')) return 'routing is forced to fail';
  if (e.includes('TRASHED')) return 'trash resolution is applied';
  return info.stimuli[0] || 'the path is exercised';
}

function composeIntegPath(node: TitleNode, info: Info, file: string): string {
  const clean = node.text.replace(/\s+/g, ' ').trim();
  const label = /^([A-Za-z]+?\d+[a-z]?:)\s*/.exec(clean)?.[1] || '';
  const rest = label ? clean.slice(label.length).trim() : clean;
  const segs = rest
    .split(/→|->|=>|;/)
    .map((s) => s.trim())
    .filter(Boolean);
  let given: string;
  let whenChain: string;
  let thenF: string;
  if (segs.length >= 2) {
    const cleanSegs = segs.map((s) => s.replace(/^(cause|effect):\s*/i, ''));
    given = cleanSegs[0];
    whenChain = cleanSegs.slice(1, cleanSegs.length - 1).join(' → ');
    thenF = cleanSegs[cleanSegs.length - 1];
  } else {
    const src = (node.body.match(/JobSource\.(BROWSER_AUTO|MANUAL)/) || [])[1] || '';
    const stage = (node.body.match(/JobStage\.([A-Z_]+)/) || [])[1] || '';
    given =
      src && stage
        ? `${stage === 'FULL_PARSED' ? 'an S2' : 'an S1'} ${src.replace(/_/g, ' ').toLowerCase()} ${stage} input`
        : /makeStage1Partial|seedPartial/.test(node.body)
          ? 'an S1 partial doc'
          : /upsert\(/.test(node.body)
            ? 'a seeded job doc'
            : pathOf(file)
              ? `the path ${pathOf(file)} preconditions`
              : subjectLabel(node.describes);
    whenChain = info.stimuli[0] || '';
    thenF = clean;
  }
  given = given.replace(/^path\s+c[1-4]\s*[·:]\s*/i, '').replace(/\s+(via|and|where)\b.*$/i, '');
  const ck = checkpointSummary(info);
  if (ck && !thenF.includes(ck)) thenF = `${thenF} (${ck})`;
  const p = pathOf(file);
  const head = label ? `${label} ` : '';
  return `${head}GIVEN ${given} WHEN ${whenChain || 'the path is exercised'} THEN ${thenF}${p ? ` · path ${p}` : ''}`;
}

function composeE2e(node: TitleNode, info: Info, file: string): string {
  const clean = node.text.replace(/\s+/g, ' ').trim();
  const segs = clean
    .split(/→|->/)
    .map((s) => s.trim())
    .filter(Boolean);
  let given: string;
  let whenChain: string;
  let thenF: string;
  if (segs.length >= 2) {
    given = segs[0];
    whenChain = segs.slice(1, segs.length - 1).join(' → ');
    thenF = segs[segs.length - 1];
  } else {
    given = info.stimuli[0] || 'an external ingress';
    whenChain =
      info.stimuli.length > 1 ? info.stimuli[1] : 'the prod bootstrap drives the workflow';
    thenF = clean;
  }
  const events = checkpointSummary(info) ? ` (${checkpointSummary(info)})` : '';
  const p = pathOf(file);
  return `GIVEN ${given} WHEN ${whenChain || 'the workflow runs'} THEN ${thenF}${events}${p ? ` · path ${p}` : ''}`;
}

function composeGeneric(node: TitleNode, info: Info, file: string): string {
  const clean = node.text.replace(/\s+/g, ' ').trim();
  const { given, effect } = invert(clean);
  const subject = subjectLabel(node.describes);
  const whenF = info.stimuli[0] || firstMeaningfulCall(node.body) || 'exercised';
  const g = given && given !== effect ? given : subject;
  const ck = checkpointSummary(info) ? ` (${checkpointSummary(info)})` : '';
  return `GIVEN ${g} WHEN ${whenF} THEN ${effect || clean}${ck}`;
}

function compose(node: TitleNode, file: string): string {
  if (/^property\b/i.test(node.text)) return node.text;
  if (node.template) return node.text;
  // Idempotency guard: titles already in the uniform GIVEN/WHEN/THEN shape are terminal.
  if (/^\s*(?:[A-Za-z]+\d+[a-z]?:\s*)?GIVEN\b.*\bWHEN\b.*\bTHEN\b/is.test(node.text)) {
    return node.text;
  }
  const info = bodyInfo(node.body);
  switch (levelOf(file)) {
    case 'unit-domain':
      return composeUnitDomain(node, info);
    case 'unit-app':
      return composeUnitApp(node, info, file);
    case 'contract':
      return composeContract(node, info);
    case 'integ-path':
      return composeIntegPath(node, info, file);
    case 'e2e':
      return composeE2e(node, info, file);
    default:
      return composeGeneric(node, info, file);
  }
}

function quote(str: string): string {
  return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function isResolved(text: string): boolean {
  if (/^property\b/i.test(text)) return true;
  return (
    GWT_KEYWORDS.test(text) || ARROW.test(text) || /\bS[1-4]\b/.test(text) || ACTION_TAGS.test(text)
  );
}

function applyEdits(src: string, edits: Edit[]): string {
  return edits
    .slice()
    .sort((a, b) => b.start - a.start)
    .reduce((acc, e) => acc.slice(0, e.start) + e.replacement + acc.slice(e.end), src);
}

let total = 0;
let resolved = 0;
let untouched = 0;
let edited = 0;

for (const file of FILES) {
  const src = fs.readFileSync(file, 'utf8');
  const { titles } = analyzeFile(file);
  const its = titles.filter((t) => t.kind === 'it');
  if (!its.length) continue;
  const rel = path.relative(process.cwd(), file);

  const edits: Edit[] = [];
  const used: Record<string, number> = {};
  const log: string[] = [`─ ${rel}`];

  for (const node of its) {
    total++;
    const newText = compose(node, file);
    if (newText === node.text) {
      untouched++;
      resolved++;
      if (VERBOSE) log.push(`  L${node.line} ${node.text}  (kept)`);
      continue;
    }
    const count = (used[newText] ?? 0) + 1;
    used[newText] = count;
    const final = count > 1 ? `${newText} (${count})` : newText;
    edits.push({ start: node.start, end: node.end, replacement: quote(final) });
    edited++;
    resolved = resolved + (isResolved(final) ? 1 : 0);
    if (!isResolved(final)) {
      if (REPORT || CHECK)
        console.log(`  ✗ L${node.line} ${node.text}  →  ${final}  (still unresolved)`);
    }
    if (VERBOSE || REWRITE) log.push(`  L${node.line} ${node.text}  →  ${final}`);
  }

  if (REWRITE) {
    const next = applyEdits(src, edits);
    if (!DRY_RUN && next !== src) {
      fs.writeFileSync(file, next);
    }
    if (VERBOSE || DRY_RUN) console.log(log.join('\n'));
  }
}

console.log(
  `\nGWT summary: ${FILES.length} files, ${total} titles, ${resolved} resolved, ${edited} rewritten, ${untouched} kept.` +
    (CHECK ? ` check mode — exit ${resolved === total ? '0' : '1'}.` : '')
);
if (CHECK) process.exit(resolved === total ? 0 : 1);
process.exit(0);
