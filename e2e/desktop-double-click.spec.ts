import { expect, test, type Page } from '@playwright/test';

const gameStateStorageKey = 'kdl.gameState.v1';
const redoStateStackStorageKey = 'kdl.redoStack.v1';

const pieceLabelById = {
  doctor: 'Dr',
  player1: 'P1',
  player2: 'P3',
  stranger1: 'p2',
  stranger2: 'p4',
} as const;

type PieceId = keyof typeof pieceLabelById;

type DesktopDoubleClickScenario = {
  currentPlayerPieceId: Extract<PieceId, 'player1' | 'player2'>;
  currentPlayerRoomId: number;
  strangerPieceId: Extract<PieceId, 'stranger1' | 'stranger2'>;
  strangerRoomId: number;
  strangerRoomName: string;
  strangerDestinationRoomId: number;
  strangerDestinationRoomName: string;
};

const plannerLine = (page: Page, label: string) =>
  page.locator('.planner-line').filter({ hasText: label }).first();

const dispatchRoomClick = async (room: import('@playwright/test').Locator) => {
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

const roomSuppressesContextMenu = async (room: import('@playwright/test').Locator) =>
  room.evaluate((element) => {
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });

const dispatchRoomDoubleClick = async (room: import('@playwright/test').Locator) => {
  await room.evaluate((element) => {
    const buildMouseEvent = (type: 'click' | 'dblclick', detail: number) =>
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        detail,
      });

    element.dispatchEvent(buildMouseEvent('click', 1));
    element.dispatchEvent(buildMouseEvent('click', 2));
    element.dispatchEvent(buildMouseEvent('dblclick', 2));
  });
};

const dispatchTouchTap = async (
  room: import('@playwright/test').Locator,
  options?: {
    includeDoubleClickEvent?: boolean;
  },
) => {
  await room.evaluate((element, includeDoubleClickEvent) => {
    const rect = element.getBoundingClientRect();
    const point = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    const pointerId = Math.trunc(Math.random() * 10000) + 1;
    const buildPointerEvent = (type: 'pointerdown' | 'pointerup') =>
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType: 'touch',
        isPrimary: true,
        clientX: point.x,
        clientY: point.y,
      });

    element.dispatchEvent(buildPointerEvent('pointerdown'));
    element.dispatchEvent(buildPointerEvent('pointerup'));
    element.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        detail: 1,
      }),
    );

    if (includeDoubleClickEvent) {
      element.dispatchEvent(
        new MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          composed: true,
          detail: 2,
        }),
      );
    }
  }, options?.includeDoubleClickEvent ?? false);
};

const readStoredPieceRoom = async (page: Page, pieceId: PieceId) =>
  page.evaluate(
    async ({ storageKey, targetPieceId }) => {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return -1;
      }

      const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
      await wasm.default();

      const pieceIndexById: Record<string, number> = {
        doctor: 0,
        player1: 1,
        player2: 2,
        stranger1: 3,
        stranger2: 4,
      };

      const pieceIndex = pieceIndexById[targetPieceId];
      if (pieceIndex === undefined) {
        return -1;
      }

      const state = wasm.newDefaultGameState();
      try {
        const importError = state.importStateJson(raw);
        if (importError) {
          return -1;
        }

        const positions = Array.from(state.piecePositions(), (value) => Number(value));
        return typeof positions[pieceIndex] === 'number' ? positions[pieceIndex] : -1;
      } finally {
        state.free();
      }
    },
    { storageKey: gameStateStorageKey, targetPieceId: pieceId },
  );

const seedStateWithDesktopDoubleClickScenario = async (page: Page): Promise<DesktopDoubleClickScenario> => {
  const seededScenario = await page.evaluate(
    async ({ gameStateStorageKeyArg, redoStateStackStorageKeyArg }) => {
      const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
      await wasm.default();

      const pieceIndexById: Record<string, number> = {
        doctor: 0,
        player1: 1,
        player2: 2,
        stranger1: 3,
        stranger2: 4,
      };

      const buildRoomNameById = (state: { boardRoomsJson(): string }) => {
        const boardRooms = JSON.parse(state.boardRoomsJson()) as Array<{
          id?: number;
          Id?: number;
          name?: string;
          Name?: string;
        }>;
        const roomNameById = new Map<number, string>();
        for (const room of boardRooms) {
          const roomIdRaw = typeof room.id === 'number' ? room.id : room.Id;
          const roomNameRaw = typeof room.name === 'string' ? room.name : room.Name;
          if (typeof roomIdRaw === 'number' && typeof roomNameRaw === 'string' && roomNameRaw.length > 0) {
            roomNameById.set(Math.trunc(roomIdRaw), roomNameRaw);
          }
        }
        return roomNameById;
      };

      const findScenarioInState = (
        state: {
          boardRoomsJson(): string;
          currentPlayerPieceId(): string;
          piecePositions(): Iterable<number>;
          validateTurnPlan(planJson: string): string;
        },
      ) => {
        const roomNameById = buildRoomNameById(state);
        const roomIds = Array.from(roomNameById.keys()).sort((a, b) => a - b);
        const currentPlayerPieceId = state.currentPlayerPieceId();
        const currentPlayerIndex = pieceIndexById[currentPlayerPieceId];
        if (currentPlayerPieceId !== 'player1' && currentPlayerPieceId !== 'player2') {
          return null;
        }
        if (currentPlayerIndex === undefined) {
          throw new Error(`Unexpected current player piece id: ${currentPlayerPieceId}`);
        }

        const positions = Array.from(state.piecePositions(), (value) => Number(value));
        const currentPlayerRoomId = positions[currentPlayerIndex];

        for (const strangerPieceId of ['stranger1', 'stranger2'] as const) {
          const strangerIndex = pieceIndexById[strangerPieceId];
          const strangerRoomId = positions[strangerIndex];
          if (strangerRoomId === currentPlayerRoomId) {
            continue;
          }

          const strangerRoomName = roomNameById.get(strangerRoomId);
          if (!strangerRoomName) {
            continue;
          }

          for (const strangerDestinationRoomId of roomIds) {
            if (strangerDestinationRoomId === strangerRoomId) {
              continue;
            }

            const strangerDestinationRoomName = roomNameById.get(strangerDestinationRoomId);
            if (!strangerDestinationRoomName) {
              continue;
            }

            const strangerOnlyPlan = [{ pieceId: strangerPieceId, roomId: strangerDestinationRoomId }];
            if (state.validateTurnPlan(JSON.stringify(strangerOnlyPlan))) {
              continue;
            }

            const combinedPlan = [
              { pieceId: strangerPieceId, roomId: strangerDestinationRoomId },
              { pieceId: currentPlayerPieceId, roomId: strangerRoomId },
            ];
            if (state.validateTurnPlan(JSON.stringify(combinedPlan))) {
              continue;
            }

            return {
              currentPlayerPieceId,
              currentPlayerRoomId,
              strangerPieceId,
              strangerRoomId,
              strangerRoomName,
              strangerDestinationRoomId,
              strangerDestinationRoomName,
            };
          }
        }

        return null;
      };

      const baseState = wasm.newDefaultGameState();
      try {
        const baseScenario = findScenarioInState(baseState);
        if (baseScenario) {
          window.localStorage.setItem(gameStateStorageKeyArg, baseState.exportStateJson());
          window.localStorage.removeItem(redoStateStackStorageKeyArg);
          return baseScenario;
        }

        const baseSnapshot = baseState.exportStateJson();
        const baseCurrentPlayerPieceId = baseState.currentPlayerPieceId();
        if (baseCurrentPlayerPieceId !== 'player1' && baseCurrentPlayerPieceId !== 'player2') {
          throw new Error(`Unexpected current player piece id while searching next state: ${baseCurrentPlayerPieceId}`);
        }

        const roomNameById = buildRoomNameById(baseState);
        const roomIds = Array.from(roomNameById.keys()).sort((a, b) => a - b);
        for (const roomId of roomIds) {
          const openingPlan = [{ pieceId: baseCurrentPlayerPieceId, roomId }];
          if (baseState.validateTurnPlan(JSON.stringify(openingPlan))) {
            continue;
          }

          const candidateState = wasm.newDefaultGameState();
          try {
            const importError = candidateState.importStateJson(baseSnapshot);
            if (importError) {
              throw new Error(`Failed to import base snapshot while searching desktop double-click scenario: ${importError}`);
            }

            const applyError = candidateState.applyTurnPlan(JSON.stringify(openingPlan));
            if (applyError) {
              continue;
            }

            const candidateScenario = findScenarioInState(candidateState);
            if (!candidateScenario) {
              continue;
            }

            window.localStorage.setItem(gameStateStorageKeyArg, candidateState.exportStateJson());
            window.localStorage.removeItem(redoStateStackStorageKeyArg);
            return candidateScenario;
          } finally {
            candidateState.free();
          }
        }

        throw new Error('Could not find a valid desktop double-click stranger-planning scenario.');
      } finally {
        baseState.free();
      }
    },
    {
      gameStateStorageKeyArg: gameStateStorageKey,
      redoStateStackStorageKeyArg: redoStateStackStorageKey,
    },
  );

  await page.reload();
  return seededScenario as DesktopDoubleClickScenario;
};

test('double-clicking a stranger room preserves the stranger plan while submitting the current player move', async ({
  page,
}) => {
  await page.goto('/');

  const seed = await seedStateWithDesktopDoubleClickScenario(page);
  const strangerPieceLabel = pieceLabelById[seed.strangerPieceId];
  const plannedLine = plannerLine(page, 'Planned');
  const strangerPiece = page.locator(`.piece-layer [aria-label="${strangerPieceLabel} piece"]`).first();
  const strangerDestinationRoom = page
    .locator(`.room-layer rect[aria-label="${seed.strangerDestinationRoomName}"]`)
    .first();
  const strangerRoom = page.locator(`.room-layer rect[aria-label="${seed.strangerRoomName}"]`).first();

  await strangerPiece.click();
  await dispatchRoomClick(strangerDestinationRoom);
  await expect(plannedLine).toContainText(`${strangerPieceLabel}@R${seed.strangerDestinationRoomId}`);

  await dispatchRoomDoubleClick(strangerRoom);

  await expect(plannedLine).toContainText('No moves planned.');
  await expect.poll(() => readStoredPieceRoom(page, seed.currentPlayerPieceId)).toBe(seed.strangerRoomId);
  await expect.poll(() => readStoredPieceRoom(page, seed.strangerPieceId)).toBe(seed.strangerDestinationRoomId);
});

test('two quick touch taps on the same room submit the current player move to that room', async ({ page }) => {
  await page.goto('/');

  const seed = await seedStateWithDesktopDoubleClickScenario(page);
  const plannedLine = plannerLine(page, 'Planned');
  const strangerRoom = page.locator(`.room-layer rect[aria-label="${seed.strangerRoomName}"]`).first();

  await dispatchTouchTap(strangerRoom);
  await dispatchTouchTap(strangerRoom);

  await expect(plannedLine).toContainText('No moves planned.');
  await expect.poll(() => readStoredPieceRoom(page, seed.currentPlayerPieceId)).toBe(seed.strangerRoomId);
  await expect.poll(() => readStoredPieceRoom(page, seed.strangerPieceId)).toBe(seed.strangerRoomId);
});

test('board rooms suppress the browser context menu', async ({ page }) => {
  await page.goto('/');

  const room = page.locator('.room-layer rect').first();
  await expect.poll(() => roomSuppressesContextMenu(room)).toBe(true);
});

test('two quick touch taps in different rooms are not interpreted as a double-click submit', async ({ page }) => {
  await page.goto('/');

  const seed = await seedStateWithDesktopDoubleClickScenario(page);
  const plannedLine = plannerLine(page, 'Planned');
  const strangerPieceLabel = pieceLabelById[seed.strangerPieceId];
  const strangerRoom = page.locator(`.room-layer rect[aria-label="${seed.strangerRoomName}"]`).first();
  const strangerDestinationRoom = page
    .locator(`.room-layer rect[aria-label="${seed.strangerDestinationRoomName}"]`)
    .first();

  await dispatchTouchTap(strangerRoom);
  await dispatchTouchTap(strangerDestinationRoom, { includeDoubleClickEvent: true });

  await expect(plannedLine).toContainText(`${strangerPieceLabel}@R${seed.strangerDestinationRoomId}`);
  await expect.poll(() => readStoredPieceRoom(page, seed.currentPlayerPieceId)).toBe(seed.currentPlayerRoomId);
  await expect.poll(() => readStoredPieceRoom(page, seed.strangerPieceId)).toBe(seed.strangerRoomId);
});
