import rawDemoGames from '../../data/source-of-truth/demo-games.json';
import {
  validateDemoGamesDataset,
  DatasetLoadResult,
} from '../domain/achievement-schema';

export const demoGamesResult: DatasetLoadResult = validateDemoGamesDataset(rawDemoGames);

export function loadDemoGamesDataset(): DatasetLoadResult {
  return demoGamesResult;
}
