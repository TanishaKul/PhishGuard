export type ScanVerdict = 'FRAUD' | 'LEGITIMATE';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type DetectedSignalCategory =
  | 'urgency'
  | 'account_threat'
  | 'financial'
  | 'action_request'
  | 'reward_scam'
  | 'entity_url'
  | 'entity_email'
  | 'entity_phone'
  | 'entity_currency'
  | 'entity_shortcode'
  | 'exclamation'
  | 'obfuscation'
  | 'link_risk';

export interface DetectedSignal {
  id: string;
  name: string;
  category: DetectedSignalCategory;
  evidence: string;
  severity: 'low' | 'medium' | 'high';
  explanation: string;
}

export interface RecommendedAction {
  action: string;
  badge: string;
  description: string;
  severity: 'green' | 'amber' | 'red';
  steps: string[];
}

export interface ModelFeaturesBreakdown {
  wordTokens: string[];
  charNgrams: string[];
  charCount: number;
  wordCount: number;
  upperRatio: number;
  digitRatio: number;
  punctRatio: number;
  exclaimCount: number;
  hasUrl: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  hasCurrency: boolean;
  urgencyTermsCount: number;
  urgencyKeywordCount: number;
  suspiciousKeywordCount: number;
}

export interface ScanResult {
  id: string;
  message: string;
  prediction: ScanVerdict;
  probability: number;
  riskScore: number;
  riskLevel: RiskLevel;
  threshold: number;
  reasons: string[];
  detectedSignals: DetectedSignal[];
  modelFeatures: ModelFeaturesBreakdown;
  modelContributions: ModelContributions;
  recommendedAction: RecommendedAction;
  timestamp: string;
  latencyMs: number;
  // The user's verdict on this result, if they gave one.
  feedback?: FeedbackLabel | null;
}

export type FeedbackLabel = 'fraud' | 'legit';

export interface FeatureContribution {
  term: string;
  kind: 'word' | 'char' | 'signal';
  weight: number;
}

// Local per-feature probability effects for one message.
export interface ModelContributions {
  fraud: FeatureContribution[];
  legitimate: FeatureContribution[];
}

export interface ThreatIndicator {
  term: string;
  weight: number;
  type: 'fraud' | 'legitimate';
  fraudDocs: number;
  legitDocs: number;
}

export interface ScanHistoryItem {
  id: string;
  timestamp: string;
  message: string;
  prediction: ScanVerdict;
  riskLevel: RiskLevel;
  riskScore: number;
  probability: number;
  confidence: number;
  reasonsCount: number;
  topReason?: string;
  detectedCategories: string[];
  feedback: FeedbackLabel | null;
  // Full API response, kept so the detail view shows exactly what was returned.
  result: ScanResult;
}

export interface ConfusionMatrixData {
  tn: number;
  fp: number;
  fn: number;
  tp: number;
  total: number;
}

export interface ModelMetrics {
  modelName: string;
  threshold: number;
  prAuc: number;
  rocAuc: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  expectedCost: number;
  rawExpectedCost?: number;
  assumedPrevalence?: number;
  costFnWeight: number;
  costFpWeight: number;
  trainSamples: number;
  testSamples: number;
  fraudRateTrain: number;
  fraudRateTest: number;
  confusionMatrix: ConfusionMatrixData;
}

export interface ErrorAnalysisItem {
  message: string;
  source?: string;
  score: number;
  actual: ScanVerdict;
  predicted: ScanVerdict;
  fraudDrivers: FeatureContribution[];
  legitimateDrivers: FeatureContribution[];
}

export interface ErrorAnalysisData {
  falseNegativesCount: number;
  falsePositivesCount: number;
  falseNegatives: ErrorAnalysisItem[];
  falsePositives: ErrorAnalysisItem[];
}

export interface ModelComparisonItem {
  name: string;
  cvPrAuc: number;
  cvExpectedCost?: number;
  threshold: number;
  testPrAuc: number;
  testRocAuc: number;
  precision: number;
  recall: number;
  f1: number;
  expectedCost: number;
  isBest: boolean;
}

export interface ThresholdPoint {
  threshold: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

// Everything /api/metrics returns; produced by spamham_project_v3.py at training time.
export interface ModelReport {
  dataset: string;
  metrics: ModelMetrics;
  comparisons: ModelComparisonItem[];
  thresholdCurve: ThresholdPoint[];
  topIndicators: ThreatIndicator[];
  errorAnalysis: ErrorAnalysisData;
  keywordCategories: Record<string, string[]>;
  explanationMethod?: 'local_probability_effect';
  indicatorMethod?: 'average_local_probability_effect' | 'legacy_average_coefficient';
  selectionMethod?: 'target_prevalence_cv_cost' | 'cv_pr_auc';
}

export interface ApiHealth {
  status: 'active';
  model: string;
  threshold: number;
  hasReport: boolean;
}

export interface AnalyticsData {
  totalScans: number;
  fraudCount: number;
  legitCount: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  timeline: {
    date: string;
    scans: number;
    fraud: number;
    legit: number;
    avgRisk: number;
  }[];
  categoryBreakdown: {
    name: string;
    count: number;
    color: string;
  }[];
  riskDistribution: {
    range: string;
    count: number;
    percentage: number;
    isHighRisk?: boolean;
  }[];
  hourlyActivity: {
    hour: string;
    count: number;
    threats: number;
  }[];
  signalDistribution: {
    signal: string;
    count: number;
    fraudRate: number;
  }[];
}
