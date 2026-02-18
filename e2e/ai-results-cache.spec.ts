import { expect, test, type Page } from '@playwright/test';

const gameStateStorageKey = 'kdl.gameState.v1';
const redoStateStackStorageKey = 'kdl.redoStack.v1';
const aiPrefsStorageKey = 'kdl.ai.v1';
const aiResultsCacheStorageKey = 'kdl.aiResultsCache.v1';

type CachedBestTurn = {
  isValid: true;
  validationMessage: string;
  suggestedTurnText: string;
  suggestedTurn: Array<{ pieceId: 'player1' | 'player2' | 'stranger1' | 'stranger2'; roomId: number }>;
  heuristicScore: number;
  numStatesVisited: number;
  elapsedMs: number;
};

type CachedAiEntrySeed = {
  analysisLevel: number;
  bestTurn: CachedBestTurn;
  previewRaw: string;
  elapsedMs: number;
  levelElapsedMs: number;
  lastUsedAtMs: number;
};

const seedDefaultStateAndAiSetup = async (
  page: Page,
  options: {
    minAnalysisLevel: number;
    analysisMaxTimeIndex: number;
    cacheEntry?: CachedAiEntrySeed;
  },
) =>
  page.evaluate(
    async ({
      gameStateStorageKeyArg,
      redoStateStackStorageKeyArg,
      aiPrefsStorageKeyArg,
      aiResultsCacheStorageKeyArg,
      minAnalysisLevelArg,
      analysisMaxTimeIndexArg,
      cacheEntryArg,
    }) => {
      const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
      await wasm.default();
      const seeded = wasm.newDefaultGameState();
      const snapshot = seeded.exportStateJson();
      seeded.free();

      window.localStorage.setItem(gameStateStorageKeyArg, snapshot);
      window.localStorage.removeItem(redoStateStackStorageKeyArg);
      window.localStorage.setItem(
        aiPrefsStorageKeyArg,
        JSON.stringify({
          minAnalysisLevel: minAnalysisLevelArg,
          analysisMaxTimeIndex: analysisMaxTimeIndexArg,
          controlP1: false,
          controlP3: false,
          showOnBoardP1: false,
          showOnBoardP3: false,
        }),
      );
      if (cacheEntryArg) {
        window.localStorage.setItem(
          aiResultsCacheStorageKeyArg,
          JSON.stringify({
            version: 1,
            entries: [{ stateJson: snapshot, ...cacheEntryArg }],
          }),
        );
      } else {
        window.localStorage.removeItem(aiResultsCacheStorageKeyArg);
      }
      return snapshot;
    },
    {
      gameStateStorageKeyArg: gameStateStorageKey,
      redoStateStackStorageKeyArg: redoStateStackStorageKey,
      aiPrefsStorageKeyArg: aiPrefsStorageKey,
      aiResultsCacheStorageKeyArg: aiResultsCacheStorageKey,
      minAnalysisLevelArg: options.minAnalysisLevel,
      analysisMaxTimeIndexArg: options.analysisMaxTimeIndex,
      cacheEntryArg: options.cacheEntry ?? null,
    },
  );

const readAiLineValue = async (page: Page, labelText: string) =>
  page.evaluate((labelArg) => {
    const lines = Array.from(document.querySelectorAll('.ai-panel .planner-line'));
    for (const line of lines) {
      const label = line.querySelector('.planner-label')?.textContent?.trim();
      if (label === labelArg) {
        return line.querySelector('.planner-value')?.textContent?.trim() ?? null;
      }
    }
    return null;
  }, labelText);

const readAiStatusLevel = async (page: Page) => {
  const status = await readAiLineValue(page, 'Status');
  if (!status) {
    return null;
  }
  const match = status.match(/^L(\d+)\b/);
  return match ? Number(match[1]) : null;
};

const readCacheEntryForState = async (page: Page, stateJson: string) =>
  page.evaluate(
    ({ aiResultsCacheStorageKeyArg, stateJsonArg }) => {
      const raw = window.localStorage.getItem(aiResultsCacheStorageKeyArg);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as {
        entries?: Array<{
          stateJson?: string;
          analysisLevel?: number;
          bestTurn?: { isValid?: boolean };
          lastUsedAtMs?: number;
        }>;
      };
      if (!Array.isArray(parsed.entries)) {
        return null;
      }
      const match = parsed.entries.find((entry) => entry.stateJson === stateJsonArg);
      if (!match) {
        return null;
      }
      return {
        analysisLevel: typeof match.analysisLevel === 'number' ? match.analysisLevel : null,
        isValid: match.bestTurn?.isValid === true,
        lastUsedAtMs: typeof match.lastUsedAtMs === 'number' ? match.lastUsedAtMs : null,
      };
    },
    {
      aiResultsCacheStorageKeyArg: aiResultsCacheStorageKey,
      stateJsonArg: stateJson,
    },
  );

const cancelAiAnalysisIfRunning = async (page: Page) => {
  const aiPanel = page.locator('.ai-panel');
  const cancelButton = aiPanel.getByRole('button', { name: 'Cancel' });
  if (await cancelButton.isEnabled()) {
    await cancelButton.click();
  }
};

test.describe('AI results cache', () => {
  test('stores analysis results for a never-before-seen game state', async ({ page }) => {
    await page.goto('/');

    const seededStateJson = await seedDefaultStateAndAiSetup(page, {
      minAnalysisLevel: 2,
      analysisMaxTimeIndex: 2,
    });
    await page.reload();

    await cancelAiAnalysisIfRunning(page);

    const aiPanel = page.locator('.ai-panel');
    await aiPanel.getByRole('button', { name: 'Think' }).click();
    await expect.poll(() => readAiStatusLevel(page), { timeout: 5000 }).toBeGreaterThanOrEqual(2);
    await expect
      .poll(async () => {
        const cacheEntry = await readCacheEntryForState(page, seededStateJson);
        return cacheEntry?.analysisLevel ?? null;
      }, { timeout: 30000 })
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(async () => {
        const cacheEntry = await readCacheEntryForState(page, seededStateJson);
        return cacheEntry?.isValid ?? false;
      }, { timeout: 30000 })
      .toBe(true);
  });

  test('uses cached analysis level and suggestion at analysis start for previously analyzed state', async ({ page }) => {
    await page.goto('/');

    const staleLastUsedAtMs = 1700000000000;
    const seededStateJson = await seedDefaultStateAndAiSetup(page, {
      minAnalysisLevel: 0,
      analysisMaxTimeIndex: 0,
      cacheEntry: {
        analysisLevel: 12,
        bestTurn: {
          isValid: true,
          validationMessage: '',
          suggestedTurnText: 'P1@R13',
          suggestedTurn: [{ pieceId: 'player1', roomId: 13 }],
          heuristicScore: 1234,
          numStatesVisited: 4321,
          elapsedMs: 987,
        },
        previewRaw: '',
        elapsedMs: 987,
        levelElapsedMs: 321,
        lastUsedAtMs: staleLastUsedAtMs,
      },
    });
    await page.reload();

    await expect.poll(() => readAiStatusLevel(page), { timeout: 5000 }).toBeGreaterThanOrEqual(13);
    await expect.poll(() => readAiLineValue(page, 'Suggested'), { timeout: 5000 }).toBe('P1@R13');
    await expect
      .poll(async () => {
        const cacheEntry = await readCacheEntryForState(page, seededStateJson);
        return cacheEntry?.lastUsedAtMs ?? null;
      }, { timeout: 5000 })
      .toBeGreaterThan(staleLastUsedAtMs);
  });

  test('Clear Cache removes persisted/in-memory cache so next analysis starts from min depth', async ({ page }) => {
    await page.goto('/');

    await seedDefaultStateAndAiSetup(page, {
      minAnalysisLevel: 0,
      analysisMaxTimeIndex: 0,
      cacheEntry: {
        analysisLevel: 12,
        bestTurn: {
          isValid: true,
          validationMessage: '',
          suggestedTurnText: 'P1@R13',
          suggestedTurn: [{ pieceId: 'player1', roomId: 13 }],
          heuristicScore: 1234,
          numStatesVisited: 4321,
          elapsedMs: 987,
        },
        previewRaw: '',
        elapsedMs: 987,
        levelElapsedMs: 321,
        lastUsedAtMs: 1700000000000,
      },
    });
    await page.reload();

    const aiPanel = page.locator('.ai-panel');
    await expect.poll(() => readAiStatusLevel(page), { timeout: 5000 }).toBeGreaterThanOrEqual(13);
    await cancelAiAnalysisIfRunning(page);
    await aiPanel.getByRole('button', { name: 'Clear Cache' }).click();
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), aiResultsCacheStorageKey), { timeout: 3000 })
      .toBeNull();

    await aiPanel.getByRole('button', { name: 'Think' }).click();
    await expect.poll(() => readAiLineValue(page, 'Suggested'), { timeout: 5000 }).toBe('No suggestion yet.');
  });
});
