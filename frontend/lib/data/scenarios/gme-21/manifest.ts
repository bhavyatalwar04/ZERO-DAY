import { NYSE } from '@/lib/engine/markets'
import type { ScenarioManifest } from '../manifest'

// GME-21: the GameStop short squeeze, Wednesday 27 January 2021, NYSE.
// Daily bars: ./daily.json (real; GME and AMC un-adjusted for later splits, so
// prices are what traders saw: GME closed at $347.51). Headlines: well-documented
// facts of the day; times marked "approximate" are not minute-exact;
// "Illustrative" items are invented noise, labelled as such. ADR-009/011.
// Not simulated: the exchange's single-stock volatility halts (LULD) on GME.
// Written by Claude at Bhavya's request (2026-10-03).

const et = (h: number, m: number) => h * 60 + m - NYSE.openMinuteOfDay
const ILLUSTRATIVE = 'Illustrative (not a historical headline)'

export const GME21_MANIFEST: ScenarioManifest = {
  id: 'GME-21',
  title: 'The GameStop Squeeze',
  subtitle: 'Reddit vs. Wall Street',
  date: '2021-01-27',
  dateLabel: '27 January 2021',
  label: 'GameStop short squeeze: 27 January 2021, NYSE (US)',
  market: NYSE,
  difficulty: 5,
  objective: 'A mania driven by social media and short covering. Can you size a bet you might be wrong about?',
  briefing: 'GameStop closed yesterday at $147.98, up from under $20 at the start of the month, as retail traders on Reddit\'s r/wallstreetbets piled in against hedge funds betting it would fall. After yesterday\'s close, Elon Musk tweeted "Gamestonk!!" with a link to the forum. Several other heavily shorted stocks are also moving.',
  stocks: [
    { symbol: 'GME', ticker: 'GME', name: 'GameStop', sector: 'Video-game retail' },
    { symbol: 'AMC', ticker: 'AMC', name: 'AMC Entertainment', sector: 'Cinemas' },
    { symbol: 'BB', ticker: 'BB', name: 'BlackBerry', sector: 'Software' },
    { symbol: 'NOK', ticker: 'NOK', name: 'Nokia', sector: 'Telecom equipment' },
    { symbol: 'AAPL', ticker: 'AAPL', name: 'Apple', sector: 'Technology' },
    { symbol: 'SPY', ticker: 'SPY', name: 'SPDR S&P 500 ETF', sector: 'Index fund' },
  ],
  indices: [
    { name: 'SPX', ticker: '^GSPC' },
    { name: 'NASDAQ', ticker: '^IXIC' },
    { name: 'VIX', ticker: '^VIX' },
  ],
  hints: {
    SPX: { lowAt: [300, 385] },
    NASDAQ: { highAt: [1, 30], lowAt: [300, 385] },
    SPY: { highAt: [1, 15], lowAt: [300, 385] },
    GME: { highAt: [1, 40], lowAt: [90, 240] },
    AMC: { highAt: [1, 10], lowAt: [60, 240] },
    BB: { lowAt: [1, 10], highAt: [5, 120] },
    NOK: { lowAt: [1, 5], highAt: [5, 60] },
    VIX: { lowAt: [0, 20] },
  },
  news: [
    { id: 'g1', fireAt: et(9, 30), flag: '🚀', headline: 'GameStop opens above $350 after closing at $147.98 on Tuesday', severity: 'critical', classification: 'signal', source: 'NYSE · 09:30', impacts: [] },
    { id: 'g2', fireAt: et(9, 40), flag: '🐦', headline: 'Elon Musk\'s "Gamestonk!!" tweet, posted after Tuesday\'s close, keeps retail buying in focus', severity: 'medium', classification: 'noise', source: 'Social media recap · time approximate' },
    { id: 'g3', fireAt: et(10, 15), flag: '📣', headline: 'Reddit post: "GME to $1,000 by Friday, hold the line"', severity: 'low', classification: 'noise', source: ILLUSTRATIVE },
    { id: 'g4', fireAt: et(11, 30), flag: '🏦', headline: 'Melvin Capital has closed out its GameStop short position, CNBC reports', severity: 'high', classification: 'signal', source: 'CNBC · time approximate' },
    { id: 'g5', fireAt: et(12, 45), flag: '🏛', headline: 'White House says its economic team is monitoring the GameStop situation', severity: 'medium', classification: 'signal', source: 'White House briefing · time approximate' },
    { id: 'g6', fireAt: et(13, 30), flag: '🔒', headline: 'TD Ameritrade restricts some trades in GME and AMC, citing unprecedented volatility', severity: 'high', classification: 'signal', source: 'Broker statement · time approximate' },
    { id: 'g7', fireAt: et(14, 0), flag: '🏦', headline: 'Fed holds rates near zero; Powell says the pace of the recovery has moderated', severity: 'medium', classification: 'signal', source: 'FOMC statement · 14:00' },
    { id: 'g8', fireAt: et(14, 45), flag: '🗣', headline: 'Strategist: "the squeeze has run its course, shorts will win by March"', severity: 'low', classification: 'noise', source: ILLUSTRATIVE },
    { id: 'g9', fireAt: et(15, 30), flag: '🍎', headline: 'Apple, Tesla and Facebook report earnings after today\'s close', severity: 'low', classification: 'noise', source: 'Earnings calendar' },
    { id: 'g10', fireAt: et(15, 45), flag: '📉', headline: 'S&P 500 heads for its worst day since October as hedge funds cut risk', severity: 'high', classification: 'signal', source: 'Market wire · 15:45' },
  ],
  circuits: [],
}
