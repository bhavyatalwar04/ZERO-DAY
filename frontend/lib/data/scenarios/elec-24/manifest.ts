import { NSE } from '@/lib/engine/markets'
import type { ScenarioManifest } from '../manifest'

// ELEC-24: election-results day, Tuesday 4 June 2024, NSE.
// Daily bars: ./daily.json (real). Headlines: well-documented facts of the day;
// times marked "approximate" are not minute-exact; "Illustrative" items are
// invented noise, labelled as such. ADR-009/011.
// Written by Claude at Bhavya's request (2026-10-03).

const ist = (h: number, m: number) => h * 60 + m - NSE.openMinuteOfDay
const ILLUSTRATIVE = 'Illustrative (not a historical headline)'

export const ELEC24_MANIFEST: ScenarioManifest = {
  id: 'ELEC-24',
  title: 'Election Shock',
  subtitle: 'When the exit polls were wrong',
  date: '2024-06-04',
  dateLabel: '4 June 2024',
  label: 'Election-results day: 4 June 2024, NSE (India)',
  market: NSE,
  difficulty: 4,
  objective: 'A crowded bet unwinds as votes are counted. Can you tell a panic from a plan?',
  briefing: 'Exit polls on Saturday predicted a large win for the ruling alliance, and yesterday the Nifty jumped to a record high. Vote counting begins at 8:00 this morning. Government-owned and infrastructure stocks led the run-up.',
  stocks: [
    { symbol: 'ADANIENT', ticker: 'ADANIENT.NS', name: 'Adani Enterprises', sector: 'Conglomerate' },
    { symbol: 'SBIN', ticker: 'SBIN.NS', name: 'State Bank of India', sector: 'PSU bank' },
    { symbol: 'ONGC', ticker: 'ONGC.NS', name: 'Oil & Natural Gas Corp', sector: 'PSU energy' },
    { symbol: 'LT', ticker: 'LT.NS', name: 'Larsen & Toubro', sector: 'Infrastructure' },
    { symbol: 'HINDUNILVR', ticker: 'HINDUNILVR.NS', name: 'Hindustan Unilever', sector: 'FMCG' },
    { symbol: 'NESTLEIND', ticker: 'NESTLEIND.NS', name: 'Nestlé India', sector: 'FMCG' },
  ],
  indices: [
    { name: 'NIFTY', ticker: '^NSEI' },
    { name: 'SENSEX', ticker: '^BSESN' },
    { name: 'VIX', ticker: '^INDIAVIX' },
  ],
  // Selling deepens as the counting trends firm up, then partly recovers into the close.
  hints: {
    NIFTY: { lowAt: [150, 260] },
    SENSEX: { lowAt: [150, 260] },
    ADANIENT: { lowAt: [150, 260] },
    SBIN: { lowAt: [150, 260] },
    ONGC: { lowAt: [150, 260] },
    LT: { highAt: [1, 20], lowAt: [150, 260] },
    HINDUNILVR: { lowAt: [1, 30], highAt: [200, 370] },
    NESTLEIND: { lowAt: [1, 30], highAt: [200, 370] },
    VIX: { highAt: [150, 260] },
  },
  news: [
    { id: 'e1', fireAt: ist(9, 15), flag: '🗳', headline: 'Counting under way since 8:00; early leads show a much closer race than exit polls projected', severity: 'critical', classification: 'signal', source: 'Election Commission trends · time approximate' },
    { id: 'e2', fireAt: ist(9, 50), flag: '📊', headline: 'BJP leading in fewer than 272 seats on its own; NDA alliance ahead overall', severity: 'critical', classification: 'signal', source: 'Election Commission trends · time approximate' },
    { id: 'e3', fireAt: ist(10, 30), flag: '🏦', headline: 'PSU, infrastructure and Adani group stocks lead the sell-off', severity: 'high', classification: 'signal', source: 'Market wire · time approximate', impacts: [{ symbol: 'ADANIENT', pctImpact: -0.02 }, { symbol: 'SBIN', pctImpact: -0.015 }, { symbol: 'ONGC', pctImpact: -0.015 }] },
    { id: 'e4', fireAt: ist(11, 0), flag: '📈', headline: 'India VIX surges as markets price in coalition uncertainty', severity: 'medium', classification: 'signal', source: 'NSE · time approximate' },
    { id: 'e5', fireAt: ist(11, 30), flag: '🛒', headline: 'FMCG stocks gain as investors bet on more rural-focused spending', severity: 'medium', classification: 'signal', source: 'Market wire · time approximate', impacts: [{ symbol: 'HINDUNILVR', pctImpact: 0.01 }, { symbol: 'NESTLEIND', pctImpact: 0.005 }] },
    { id: 'e6', fireAt: ist(12, 15), flag: '📺', headline: 'TV debate: "the counting trends will reverse by evening, stay invested"', severity: 'low', classification: 'noise', source: ILLUSTRATIVE },
    { id: 'e7', fireAt: ist(13, 0), flag: '🤝', headline: 'Trends point to an NDA coalition government; allies TDP and JD(U) hold the balance', severity: 'high', classification: 'signal', source: 'Election Commission trends · time approximate' },
    { id: 'e8', fireAt: ist(14, 0), flag: '💬', headline: 'Unverified posts claim "recount demands in dozens of seats"; no official confirmation', severity: 'low', classification: 'noise', source: ILLUSTRATIVE },
    { id: 'e9', fireAt: ist(15, 10), flag: '🔔', headline: 'Nifty set for its worst day since March 2020', severity: 'high', classification: 'signal', source: 'Market wire · 15:10' },
  ],
  circuits: [],
}
