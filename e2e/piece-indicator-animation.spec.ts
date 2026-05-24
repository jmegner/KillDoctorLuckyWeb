import { expect, test, type Page } from '@playwright/test';

const gameStateStorageKey = 'kdl.gameState.v1';
const redoStateStackStorageKey = 'kdl.redoStack.v1';
const animationPrefsStorageKey = 'kdl.settings.v1';

type IndicatorSeed = {
  pieceLabel: string;
  beforeTexts: string[];
  afterTexts: string[];
};

const readPieceTexts = async (page: Page, pieceLabel: string) =>
  page.evaluate((pieceLabelArg) => {
    const shape = document.querySelector<SVGElement>(`.piece-layer [aria-label="${pieceLabelArg} piece"]`);
    if (!shape) {
      return null;
    }
    const group = shape.parentElement;
    if (!group) {
      return null;
    }
    return Array.from(group.querySelectorAll('text'))
      .map((node) => node.textContent?.trim() ?? '')
      .filter((text) => text.length > 0);
  }, pieceLabel);

const seedRedoWithIndicatorChange = async (page: Page): Promise<IndicatorSeed> =>
  page.evaluate(
    async ({ gameStateStorageKeyArg, redoStateStackStorageKeyArg, animationPrefsStorageKeyArg }) => {
      const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
      await wasm.default();
      const seededState = wasm.newDefaultGameState();

      const pieceLabels: Record<string, string> = {
        player1: 'P1',
        player2: 'P3',
        stranger1: 'p2',
        stranger2: 'p4',
      };

      const toIndicatorTexts = (state: { pieceMoveCards(pieceId: string): number; pieceAttackStrength(pieceId: string): number }, pieceId: string) => {
        const isNormalPlayer = pieceId === 'player1' || pieceId === 'player2';
        const texts = [] as string[];
        if (isNormalPlayer) {
          const moveCards = state.pieceMoveCards(pieceId);
          const roundedDownMoveCards = Math.floor(moveCards);
          const progressThirtySeconds = ((Math.round(moveCards * 32) % 32) + 32) % 32;
          const lootActionsAwayFromNextFullMoveCard = (() => {
            for (let lootActions = 0; lootActions < 32; lootActions += 1) {
              if ((progressThirtySeconds + lootActions * 11) % 32 === 0) {
                return lootActions;
              }
            }
            return 0;
          })();
          const suffix = lootActionsAwayFromNextFullMoveCard === 1 ? ':' : lootActionsAwayFromNextFullMoveCard === 2 ? '.' : '';
          texts.push(`${roundedDownMoveCards}${suffix}`);
        }
        texts.push(pieceLabels[pieceId]);
        texts.push(state.pieceAttackStrength(pieceId).toString());
        return texts;
      };

      try {
        const boardRooms = JSON.parse(seededState.boardRoomsJson()) as Array<{ id?: number; Id?: number }>;
        const roomIds = boardRooms
          .map((room) => {
            const raw = typeof room.id === 'number' ? room.id : room.Id;
            return typeof raw === 'number' ? Math.trunc(raw) : NaN;
          })
          .filter((roomId) => Number.isFinite(roomId));
        const movablePieceIds = ['player1', 'player2', 'stranger1', 'stranger2'];
        const indicatorPieceIds = ['player1', 'player2', 'stranger1', 'stranger2'];

        for (const movingPieceId of movablePieceIds) {
          for (const roomId of roomIds) {
            const beforeSnapshot = seededState.exportStateJson();
            const plan = [{ pieceId: movingPieceId, roomId }];
            const validationError = seededState.validateTurnPlan(JSON.stringify(plan));
            if (validationError) {
              continue;
            }
            const applyError = seededState.applyTurnPlan(JSON.stringify(plan));
            if (applyError) {
              const restoreError = seededState.importStateJson(beforeSnapshot);
              if (restoreError) {
                throw new Error(`Failed to restore rejected seed plan: ${restoreError}`);
              }
              continue;
            }
            const beforeState = wasm.newDefaultGameState();
            const restoreBeforeError = beforeState.importStateJson(beforeSnapshot);
            if (restoreBeforeError) {
              beforeState.free();
              throw new Error(`Failed to load before snapshot: ${restoreBeforeError}`);
            }

            for (const indicatorPieceId of indicatorPieceIds) {
              const beforeTexts = toIndicatorTexts(beforeState, indicatorPieceId);
              const afterTexts = toIndicatorTexts(seededState, indicatorPieceId);
              if (beforeTexts.join('|') === afterTexts.join('|')) {
                continue;
              }

              const afterSnapshot = seededState.exportStateJson();
              beforeState.free();
              window.localStorage.setItem(gameStateStorageKeyArg, beforeSnapshot);
              window.localStorage.setItem(redoStateStackStorageKeyArg, JSON.stringify([afterSnapshot]));
              window.localStorage.setItem(
                animationPrefsStorageKeyArg,
                JSON.stringify({
                  animationEnabled: true,
                  animationSpeedIndex: 0,
                }),
              );

              return {
                pieceLabel: pieceLabels[indicatorPieceId],
                beforeTexts,
                afterTexts,
              };
            }
            beforeState.free();

            const restoreError = seededState.importStateJson(beforeSnapshot);
            if (restoreError) {
              throw new Error(`Failed to restore seed state: ${restoreError}`);
            }
          }
        }
      } finally {
        seededState.free();
      }

      throw new Error('Failed to find a one-turn redo whose indicator text changes.');
    },
    {
      gameStateStorageKeyArg: gameStateStorageKey,
      redoStateStackStorageKeyArg: redoStateStackStorageKey,
      animationPrefsStorageKeyArg: animationPrefsStorageKey,
    },
  );

test('piece indicators keep old values until animated redo finishes', async ({ page }) => {
  await page.goto('/');

  const seed = await seedRedoWithIndicatorChange(page);
  await page.reload();

  const aniRedoButton = page.getByRole('button', { name: 'Ani Redo' });

  await expect(aniRedoButton).toBeEnabled();
  await expect.poll(() => readPieceTexts(page, seed.pieceLabel)).toEqual(seed.beforeTexts);

  await aniRedoButton.click();

  await page.waitForTimeout(250);
  await expect.poll(() => readPieceTexts(page, seed.pieceLabel), { timeout: 1500 }).toEqual(seed.beforeTexts);
  await expect.poll(() => readPieceTexts(page, seed.pieceLabel), { timeout: 30000 }).toEqual(seed.afterTexts);
});
