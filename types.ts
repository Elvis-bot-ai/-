export enum AnalysisType {
  FULL_REPORT = 'FULL_REPORT',
  PRICE_CHECK = 'PRICE_CHECK',
  IMAGE_ANALYSIS = 'IMAGE_ANALYSIS'
}

export interface Feedback {
  rating: number; // 1-5
  comment: string;
  timestamp: number;
}

export interface ReportData {
  id: string;
  stockName: string;
  query: string;
  content: string; // Markdown content
  timestamp: number;
  score: number; // AI's self-score 0-100
  type: AnalysisType;
  accuracyScore?: number; // System accuracy 1-10
  feedback?: Feedback;
}

export interface StockPrice {
  name: string;
  code: string;
  price: string;
  change: string;
  timestamp: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string | ReportData;
  isReport?: boolean;
}