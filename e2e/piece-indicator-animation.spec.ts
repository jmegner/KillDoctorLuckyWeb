import { expect, test, type Locator, type Page } from '@playwright/test';

const gameStateStorageKey = 'kdl.gameState.v1';
const redoStateStackStorageKey = 'kdl.redoStack.v1';
const animationPrefsStorageKey = 'kdl.settings.v1';

type IndicatorSeed = {
  pieceLabel: string;
  beforeTexts: string[];
  afterTexts: string[];
};

type SubmitSpendIndicatorSeed = {
  destinationRoomName: string;
  beforeTop: string;
  spentTop: string;
  afterTop: string;
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

const readPieceTopText = async (page: Page, pieceLabel: string) =>
  readPieceTexts(page, pieceLabel).then((texts) => texts?.[0] ?? null);

const dispatchRoomClick = async (room: Locator) => {
  await room.evaluate((element) => {
    element.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        detail: 1,
      }),
    );
  });
};

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
          const moveCardsThirtySeconds = Math.round(moveCards * 32);
          const roundedDownMoveCards = Math.floor(moveCardsThirtySeconds / 32);
          const fractionalThirtySeconds = ((moveCardsThirtySeconds % 32) + 32) % 32;
          const suffix = fractionalThirtySeconds >= 21 ? ':' : fractionalThirtySeconds >= 10 ? '.' : '';
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

const seedSubmitMoveCardSpendBeforeLoot = async (page: Page): Promise<SubmitSpendIndicatorSeed> =>
  page.evaluate(
    async ({ gameStateStorageKeyArg, redoStateStackStorageKeyArg, animationPrefsStorageKeyArg }) => {
      const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
      await wasm.default();
      const seededState = wasm.newDefaultGameState();

      const toMoveCardIndicatorText = (moveCards: number) => {
        const moveCardsThirtySeconds = Math.round(moveCards * 32);
        const roundedDownMoveCards = Math.floor(moveCardsThirtySeconds / 32);
        const fractionalThirtySeconds = ((moveCardsThirtySeconds % 32) + 32) % 32;
        const suffix = fractionalThirtySeconds >= 21 ? ':' : fractionalThirtySeconds >= 10 ? '.' : '';
        return `${roundedDownMoveCards}${suffix}`;
      };

      try {
        const boardRooms = JSON.parse(seededState.boardRoomsJson()) as Array<{
          id?: number;
          name?: string;
          adjacent?: number[];
        }>;
        const roomNameById = new Map<number, string>();
        const adjacentById = new Map<number, number[]>();
        for (const room of boardRooms) {
          if (typeof room.id !== 'number' || typeof room.name !== 'string') {
            continue;
          }
          const roomId = Math.trunc(room.id);
          roomNameById.set(roomId, room.name);
          adjacentById.set(roomId, Array.isArray(room.adjacent) ? room.adjacent.map((value) => Math.trunc(value)) : []);
        }
        const roomIds = Array.from(roomNameById.keys()).sort((a, b) => a - b);
        const distance = (sourceRoomId: number, destRoomId: number) => {
          const distances = new Map<number, number>([[sourceRoomId, 0]]);
          const queue = [sourceRoomId];
          while (queue.length > 0) {
            const current = queue.shift();
            if (current === undefined) {
              continue;
            }
            const currentDistance = distances.get(current);
            if (currentDistance === undefined) {
              continue;
            }
            if (current === destRoomId) {
              return currentDistance;
            }
            for (const neighbor of adjacentById.get(current) ?? []) {
              if (distances.has(neighbor)) {
                continue;
              }
              distances.set(neighbor, currentDistance + 1);
              queue.push(neighbor);
            }
          }
          return Number.POSITIVE_INFINITY;
        };

        for (const doctorRoomId of roomIds) {
          for (const player1RoomId of roomIds) {
            for (const destinationRoomId of roomIds) {
              if (distance(player1RoomId, destinationRoomId) !== 2) {
                continue;
              }
              const startError = seededState.startNewGameWithSetup(
                1.9,
                2,
                4,
                2,
                2,
                4,
                doctorRoomId,
                player1RoomId,
                roomIds[0],
                roomIds[0],
                roomIds[0],
                1,
                1,
                1,
                1,
                1,
                'player1',
              );
              if (startError) {
                continue;
              }

              const plan = [{ pieceId: 'player1', roomId: destinationRoomId }];
              if (seededState.validateTurnPlan(JSON.stringify(plan))) {
                continue;
              }
              const preview = JSON.parse(seededState.previewTurnPlan(JSON.stringify(plan))) as { currentPlayerLoots?: boolean };
              if (!preview.currentPlayerLoots) {
                continue;
              }

              const snapshot = seededState.exportStateJson();
              const beforeMoveCards = seededState.pieceMoveCards('player1');
              const applyError = seededState.applyTurnPlan(JSON.stringify(plan));
              if (applyError) {
                throw new Error(`Failed to apply seeded submit plan: ${applyError}`);
              }

              window.localStorage.setItem(gameStateStorageKeyArg, snapshot);
              window.localStorage.removeItem(redoStateStackStorageKeyArg);
              window.localStorage.setItem(
                animationPrefsStorageKeyArg,
                JSON.stringify({
                  animationEnabled: true,
                  animationSpeedIndex: 0,
                }),
              );

              return {
                destinationRoomName: roomNameById.get(destinationRoomId) ?? `Room ${destinationRoomId}`,
                beforeTop: toMoveCardIndicatorText(beforeMoveCards),
                spentTop: toMoveCardIndicatorText(beforeMoveCards - 1),
                afterTop: toMoveCardIndicatorText(seededState.pieceMoveCards('player1')),
              };
            }
          }
        }
      } finally {
        seededState.free();
      }

      throw new Error('Failed to find a two-step P1 loot move for the submit indicator seed.');
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

test('submitting a turn spends move-card indicator before movement animations', async ({ page }) => {
  await page.goto('/');

  const seed = await seedSubmitMoveCardSpendBeforeLoot(page);
  await page.reload();

  const playerPiece = page.locator('.piece-layer [aria-label="P1 piece"]').first();
  const destinationRoom = page
    .locator(`.room-layer rect[aria-label=${JSON.stringify(seed.destinationRoomName)}]`)
    .first();

  await expect.poll(() => readPieceTopText(page, 'P1')).toBe(seed.beforeTop);

  await playerPiece.click();
  await dispatchRoomClick(destinationRoom);
  await page.getByRole('button', { name: 'Submit' }).click();

  await expect.poll(() => readPieceTopText(page, 'P1'), { timeout: 1500 }).toBe(seed.spentTop);
  await expect.poll(() => readPieceTopText(page, 'P1'), { timeout: 30000 }).toBe(seed.afterTop);
});
