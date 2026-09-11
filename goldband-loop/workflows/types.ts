export type HostName =
  | 'claude'
  | 'codex'
  | 'cursor'
  | 'factory'
  | 'hermes'
  | 'kiro'
  | 'opencode'
  | 'openclaw'
  | 'slate';

type EntrypointType = 'typed' | 'compatibility' | 'legacy-thin';
type IntegrationStatus = 'integrated' | 'registered-only';
type WorkflowLifecycle = 'public' | 'experimental';
export type RiskLevel = 'low' | 'medium' | 'high';
export type RuntimeActionContract = {
  modes: string[];
  requiredInputs: Record<string, string[]>;
  outputs: string[];
  sideEffects: Record<string, string>;
};
export type SafetyGateContract = {
  operation: string;
  mode: string;
  enforcement: 'blocked-before-runtime' | 'runtime-owner';
  owner: string | null;
  authorization: 'native-host-approval' | 'not-required-read-only';
  preconditions: string[];
  sideEffects: string[];
  readback: string[];
};
type StepKind = 'typed' | 'llm' | 'legacyPrompt';
export type StepStatus = 'ok' | 'failed' | 'skipped';
export type StopPredicateName =
  | 'target-met'
  | 'findings-converged'
  | 'iteration-cap'
  | 'same-blocker-repeated'
  | 'no-improvement'
  | string;

export type SchemaValidator<T = unknown> = {
  name: string;
  validate(value: unknown): T;
};

export type WorkflowContext = {
  runId: string;
  workflow: WorkflowDefinition;
  cwd: string;
  passStartedAtMonotonicMs?: number;
  input?: unknown;
  options: WorkflowRunOptions;
  artifacts: string[];
  iterationContext?: IterationContext;
};

export type WorkflowStep<T = unknown> = {
  name: string;
  kind: StepKind;
  produces: SchemaValidator<T>;
  run(ctx: WorkflowContext): Promise<T> | T;
};

export type WorkflowDefinition = {
  capability: string;
  action: string;
  name: string;
  target: string;
  evaluationSignal: string;
  iterationCap: number;
  stopConditions: string[];
  contractPath: string;
  entrypointType: EntrypointType;
  integrationStatus: IntegrationStatus;
  lifecycle: WorkflowLifecycle;
  dispatch: 'trusted-launcher' | 'host-runtime' | 'prompt-contract' | 'registered-only';
  runtimeOwner: string | null;
  runtimeContract: RuntimeActionContract | null;
  safetyGates: SafetyGateContract[];
  hostSupport: HostName[];
  riskLevel: RiskLevel;
  evidencePolicy: string;
  migrationNotes: string;
  nextStep: string;
  steps: WorkflowStep[];
  evaluateSignal?: WorkflowSignalEvaluator;
  isTargetMet?: WorkflowTargetEvaluator;
  captureIterationState?: WorkflowIterationStateCapture;
};

export type WorkflowRunOptions = {
  mode?: 'mock' | 'real';
  host?: 'mock' | 'claude' | 'codex';
  base?: string;
  diffFile?: string;
  staged?: boolean;
  worktree?: boolean;
  includeUntracked?: boolean;
  specialists?: 'off' | 'auto' | 'all';
  reviewHostTimeoutMs?: number;
  reviewPassTimeoutMs?: number;
  reviewClaudeMaxBudgetUsd?: number;
  semanticOnly?: boolean;
  evidenceManifestFile?: string;
  closureArtifactFile?: string;
  workId?: string;
  ticketId?: string;
  inputFile?: string;
  goldbandHome?: string;
  reviewReceiptTrustedConfig?: string;
  cwd?: string;
  iteration?: number;
  repeatedBlocker?: boolean;
  maxIterations?: number;
};

export type StepEvidenceEvent = {
  runId: string;
  workflow: string;
  step: string;
  startedAt: string;
  durationMs: number;
  status: StepStatus;
  outputDigest: string;
  artifacts: string[];
  iteration?: number;
  signalSnapshot?: EvaluationSignalSnapshot;
  iterationCount?: number;
  stopReason?: string;
  signalTrail?: SignalTrailEntry[];
  stopHistory?: StopHistoryEntry[];
  error?: string;
};

export type ReviewFinding = {
  id?: string;
  file: string;
  line?: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  summary: string;
  evidence?: string;
  recommendation?: string;
  category?: string;
  ruleId?: string;
  policySource?: string;
  failureScenario?: string;
  suggestedVerification?: string;
  blocking?: boolean;
  specialist?: string;
  contributingSpecialists?: string[];
  classification?: ReviewFindingClassification;
  evidenceIds?: string[];
  behaviorCellIds?: string[];
  reproductionStep?: string;
};

export type ReviewFindingClassification =
  | 'verified-failure'
  | 'coverage-gap'
  | 'semantic-concern'
  | 'runtime-incomplete';

type ReviewClosureStatus =
  | 'closed'
  | 'still-open'
  | 'direct-regression'
  | 'evidence-incomplete';

export type ReviewClosureResult = {
  findingId: string;
  status: ReviewClosureStatus;
  summary: string;
  evidenceIds?: string[];
};

export type QaCheck = {
  id: string;
  label: string;
};

export type QaCheckResult = QaCheck & {
  status: 'pass' | 'fail';
  evidence: string;
};

export type SeverityCounts = Record<ReviewFinding['severity'], number>;

type ReviewFindingsSignal = {
  kind: 'review-findings';
  findingCount: number;
  severityCounts: SeverityCounts;
  blockerKey?: string;
};

type QaChecksSignal = {
  kind: 'qa-checks';
  checkCount: number;
  passedCount: number;
  failedCount: number;
  failedCheckIds: string[];
  blockerKey?: string;
};

type GenericSignal = {
  kind: 'generic';
  score: number;
  targetMet?: boolean;
  blockerKey?: string;
};

export type EvaluationSignalSnapshot =
  | ReviewFindingsSignal
  | QaChecksSignal
  | GenericSignal;

export type StopHistoryEntry = {
  iteration: number;
  condition: StopPredicateName;
  matched: boolean;
  reason: string;
};

export type IterationContext = {
  iteration: number;
  previousSignal?: EvaluationSignalSnapshot;
  previousFindings?: ReviewFinding[];
  previousFailedChecks?: QaCheckResult[];
  stopHistory: StopHistoryEntry[];
};

export type SignalTrailEntry = {
  iteration: number;
  signal: EvaluationSignalSnapshot;
};

type WorkflowSignalEvaluator = (
  output: unknown,
  ctx: WorkflowContext,
  stepName: string,
) => EvaluationSignalSnapshot | undefined;

type WorkflowTargetEvaluator = (
  signal: EvaluationSignalSnapshot,
  ctx: IterationContext,
) => boolean;

type WorkflowIterationStateCapture = (
  output: unknown,
  ctx: WorkflowContext,
  stepName: string,
) => Partial<Pick<IterationContext, 'previousFindings' | 'previousFailedChecks'>> | undefined;
