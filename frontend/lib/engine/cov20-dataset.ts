import type { ScenarioDataset } from '@/lib/agents/types'
import { COV20_TIMELINE, COV20_INDICES } from '@/lib/data/scenarios/cov-20/timeline'
import { COV20_NEWS_EVENTS, COV20_CIRCUITS } from '@/lib/data/scenarios/cov-20/live-events'

// COV-20 as a ScenarioDataset: the read-only view agents and Monitor use.
// An adapter over Bhavya's scenario data; nothing is copied or changed.
// Becomes one entry of the scenario registry in M4.
export const COV20_DATASET: ScenarioDataset = {
  scenarioId: 'COV-20',
  timeline: COV20_TIMELINE,
  news: COV20_NEWS_EVENTS,
  circuits: COV20_CIRCUITS,
  indices: COV20_INDICES,
}
