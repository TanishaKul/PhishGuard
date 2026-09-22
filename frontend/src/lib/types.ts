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
  | 'obfuscation';

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
  recommendedAction: RecommendedAction;
  timestamp: string;
  latencyMs: number;
}

export interface ThreatIndicator {
  term: string;
  weight: number;
  category: string;
  type: 'fraud' | 'legitimate';
  description?: string;
  examplesCount?: number;
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
  costFnWeight: number;
  costFpWeight: number;
  trainSamples: number;
  testSamples: number;
  fraudRateTrain: number;
  fraudRateTest: number;
  confusionMatrix: ConfusionMatrixData;
}

export interface ErrorAnalysisItem {
  id: string;
  message: string;
  score: number;
  riskScore: number;
  actual: ScanVerdict;
  predicted: ScanVerdict;
  reason: string;
  whyMissedOrAlarm: string;
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
  testPrAuc: number;
  testRocAuc: number;
  precision: number;
  recall: number;
  f1: number;
  expectedCost: number;
  isBest: boolean;
  description: string;
}

export interface KeywordCategoryItem {
  category: string;
  displayName: string;
  description: string;
  keywords: string[];
  badgeColor: string;
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
