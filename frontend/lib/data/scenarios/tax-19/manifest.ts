import { NSE } from '@/lib/engine/markets'
import type { ScenarioManifest } from '../manifest'

// TAX-19: the corporate-tax-cut rally, Friday 20 September 2019, NSE.
// Daily bars: ./daily.json (real). Headlines: well-documented facts of the day;
// times marked "approximate" are not minute-exact; "Illustrative" items are
// invented noise of the kind traders see, labelled as such. ADR-009/011.
// Written by Claude at Bhavya's request (2026-10-03).

const ist = (h: number, m: number) => h * 60 + m - NSE.openMinuteOfDay
const ILLUSTRATIVE = 'Illustrative (not a historical headline)'

export const TAX19_MANIFEST: ScenarioManifest = {
  id: 'TAX-19',
  title: 'The Tax-Cut Rally',
  subtitle: 'A surprise announcement mid-morning',
  date: '2019-09-20',
  dateLabel: '20 September 2019',
  label: 'Corporate-tax-cut rally: 20 September 2019, NSE (India)',
  market: NSE,
  difficulty: 3,
  objective: 'A sudden, policy-driven rally. Do you chase it, fade it, or wait for a plan?',
  briefing: 'Indian markets have been weak for months: growth has slowed to a six-year low and foreign investors are selling. The GST Council meets in Goa today. Nothing else is scheduled.',
  stocks: [
    { symbol: 'HDFCBANK', ticker: 'HDFCBANK.NS', name: 'HDFC Bank', sector: 'Banking' },
    { symbol: 'ICICIBANK', ticker: 'ICICIBANK.NS', name: 'ICICI Bank', sector: 'Banking' },
    { symbol: 'MARUTI', ticker: 'MARUTI.NS', name: 'Maruti Suzuki', sector: 'Autos' },
    { symbol: 'BAJFINANCE', ticker: 'BAJFINANCE.NS', name: 'Bajaj Finance', sector: 'NBFC' },
    { symbol: 'ASIANPAINT', ticker: 'ASIANPAINT.NS', name: 'Asian Paints', sector: 'Consumer' },
    { symbol: 'TCS', ticker: 'TCS.NS', name: 'Tata Consultancy Services', sector: 'IT services' },
  ],
  indices: [
    { name: 'NIFTY', ticker: '^NSEI' },
    { name: 'SENSEX', ticker: '^BSESN' },
    { name: 'VIX', ticker: '^INDIAVIX' },
  ],
  // The rally starts with the announcement (~10:30): domestic stocks bottom before it and peak after.
  hints: {
    NIFTY: { lowAt: [0, 70], highAt: [150, 340] },
    SENSEX: { lowAt: [0, 70], highAt: [150, 340] },
    HDFCBANK: { lowAt: [0, 70], highAt: [90, 360] },
    ICICIBANK: { lowAt: [0, 70], highAt: [90, 360] },
    MARUTI: { lowAt: [0, 70], highAt: [90, 300] },
    BAJFINANCE: { lowAt: [0, 70], highAt: [90, 360] },
    ASIANPAINT: { lowAt: [0, 70], highAt: [90, 300] },
    TCS: { highAt: [0, 70], lowAt: [150, 370] },
    VIX: { lowAt: [0, 70], highAt: [75, 120] },
  },
  news: [
    { id: 't1', fireAt: ist(9, 16), flag: '🔔', headline: 'Markets open slightly higher; traders watch the GST Council meeting in Goa', severity: 'low', classification: 'noise', source: 'Market wire · 09:16' },
    { id: 't2', fireAt: ist(10, 30), flag: '🏛', headline: 'FM Nirmala Sitharaman cuts base corporate tax rate to 22% from 30% for domestic companies', severity: 'critical', classification: 'signal', source: 'Press conference, Goa · time approximate' },
    { id: 't3', fireAt: ist(10, 33), flag: '🏭', headline: 'New manufacturing companies set up after 1 October 2019 to pay 15% tax', severity: 'high', classification: 'signal', source: 'Ministry of Finance · time approximate' },
    { id: 't4', fireAt: ist(10, 36), flag: '📉', headline: 'Effective tax rate for existing companies falls to about 25.17% including surcharge and cess', severity: 'high', classification: 'signal', source: 'Ministry of Finance · time approximate' },
    { id: 't5', fireAt: ist(10, 45), flag: '🌐', headline: 'Enhanced surcharge on capital gains for foreign portfolio investors withdrawn', severity: 'high', classification: 'signal', source: 'Ministry of Finance · time approximate' },
    { id: 't6', fireAt: ist(11, 5), flag: '💰', headline: 'Government puts the revenue cost of the tax cuts at ₹1.45 lakh crore a year', severity: 'medium', classification: 'signal', source: 'Ministry of Finance · time approximate' },
    { id: 't7', fireAt: ist(11, 40), flag: '💻', headline: 'IT exporters lag the rally: their profits gain less from domestic tax cuts', severity: 'medium', classification: 'signal', source: 'Market wire · time approximate', impacts: [{ symbol: 'TCS', pctImpact: -0.005 }] },
    { id: 't8', fireAt: ist(12, 30), flag: '🗣', headline: 'Analyst: "fiscal-deficit worries will cap this rally by Monday"', severity: 'low', classification: 'noise', source: ILLUSTRATIVE },
    { id: 't9', fireAt: ist(13, 45), flag: '💬', headline: 'Social media buzz: "more tax sops for individuals coming tonight"; no official word', severity: 'low', classification: 'noise', source: ILLUSTRATIVE },
    { id: 't10', fireAt: ist(15, 10), flag: '🔔', headline: 'Nifty heads for its biggest single-day gain in over ten years', severity: 'high', classification: 'signal', source: 'Market wire · 15:10' },
  ],
  circuits: [],
}
