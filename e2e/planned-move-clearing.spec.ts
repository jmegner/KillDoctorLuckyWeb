import { expect, test, type Locator, type Page } from '@playwright/test';

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

type SeedSelectionScenario = {
  pieceId: PieceId;
  currentRoomName: string;
  destinationRoomId: number;
  destinationRoomName: string;
};

const plannerLine = (page: Page, label: string) =>
  page.locator('.planner-line').filter({ hasText: label }).first();

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

const seedDefaultStateForCurrentPlayerSelection = async (page: Page): Promise<SeedSelectionScenario> => {
  const seededScenario = await page.evaluate(
    async ({ gameStateStorageKeyArg, redoStateStackStorageKeyArg }) => {
      const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
      await wasm.default();
      const seededState = wasm.newDefaultGameState();

      try {
        const pieceId = seededState.currentPlayerPieceId();
        const pieceIndexById = new Map<string, number>([
          ['doctor', 0],
          ['player1', 1],
          ['player2', 2],
          ['stranger1', 3],
          ['stranger2', 4],
        ]);
        const pieceIndex = pieceIndexById.get(pieceId);
        if (pieceIndex === undefined) {
          throw new Error(`Unexpected current player piece id: ${pieceId}`);
        }

        const positions = Array.from(seededState.piecePositions(), (value) => Number(value));
        const currentRoomId = positions[pieceIndex];

        const boardRooms = JSON.parse(seededState.boardRoomsJson()) as Array<{
          id?: number;
          Id?: number;
          name?: string;
          Name?: string;
        }>;
        const roomNameById = new Map<number, string>();
        for (const room of boardRooms) {
          const roomId = typeof room.id === 'number' ? room.id : room.Id;
          const roomName = typeof room.name === 'string' ? room.name : room.Name;
          if (typeof roomId === 'number' && typeof roomName === 'string' && roomName.length > 0) {
            roomNameById.set(Math.trunc(roomId), roomName);
          }
        }

        const candidateRoomIds = Array.from(roomNameById.keys()).sort((a, b) => a - b);
        let destinationRoomId: number | null = null;
        for (const roomId of candidateRoomIds) {
          if (roomId === currentRoomId) {
            continue;
          }
          const validation = seededState.validateTurnPlan(JSON.stringify([{ pieceId, roomId }]));
          if (!validation) {
            destinationRoomId = roomId;
            break;
          }
        }
        if (destinationRoomId === null) {
          throw new Error(`Could not find valid destination room for ${pieceId}.`);
        }

        const currentRoomName = roomNameById.get(currentRoomId);
        const destinationRoomName = roomNameById.get(destinationRoomId);
        if (!currentRoomName || !destinationRoomName) {
          throw new Error(
            `Could not resolve room names for current=${currentRoomId} destination=${destinationRoomId}.`,
          );
        }

        const snapshot = seededState.exportStateJson();
        window.localStorage.setItem(gameStateStorageKeyArg, snapshot);
        window.localStorage.removeItem(redoStateStackStorageKeyArg);

        return {
          pieceId,
          currentRoomName,
          destinationRoomId,
          destinationRoomName,
        };
      } finally {
        seededState.free();
      }
    },
    {
      gameStateStorageKeyArg: gameStateStorageKey,
      redoStateStackStorageKeyArg: redoStateStackStorageKey,
    },
  );

  if (!(seededScenario.pieceId in pieceLabelById)) {
    throw new Error(`Unexpected piece id from seeded scenario: ${seededScenario.pieceId}`);
  }

  await page.reload();
  return seededScenario as SeedSelectionScenario;
};

test.describe('selected-piece current-room click behavior', () => {
  test('clicking current room deselects piece when no planned move exists', async ({ page }) => {
    await page.goto('/');
    const seed = await seedDefaultStateForCurrentPlayerSelection(page);
    const pieceLabel = pieceLabelById[seed.pieceId];
    const selectedPiece = page.locator(`.piece-layer [aria-label="${pieceLabel} piece"]`).first();
    const currentRoom = page.locator(`.room-layer rect[aria-label="${seed.currentRoomName}"]`).first();
    const selectedLine = plannerLine(page, 'Selected');
    const plannedLine = plannerLine(page, 'Planned');

    await selectedPiece.click();
    await expect(selectedLine).toContainText(pieceLabel);

    await dispatchRoomClick(currentRoom);
    await expect(selectedLine).toContainText('None');
    await expect(plannedLine).toContainText('No moves planned.');
  });

  test('clicking current room clears existing planned move for selected piece', async ({ page }) => {
    await page.goto('/');
    const seed = await seedDefaultStateForCurrentPlayerSelection(page);
    const pieceLabel = pieceLabelById[seed.pieceId];
    const selectedPiece = page.locator(`.piece-layer [aria-label="${pieceLabel} piece"]`).first();
    const currentRoom = page.locator(`.room-layer rect[aria-label="${seed.currentRoomName}"]`).first();
    const destinationRoom = page.locator(`.room-layer rect[aria-label="${seed.destinationRoomName}"]`).first();
    const selectedLine = plannerLine(page, 'Selected');
    const plannedLine = plannerLine(page, 'Planned');
    const plannedMoveText = `${pieceLabel}@R${seed.destinationRoomId}`;

    await selectedPiece.click();
    await dispatchRoomClick(destinationRoom);
    await expect(selectedLine).toContainText('None');
    await expect(plannedLine).toContainText(plannedMoveText);

    await selectedPiece.click();
    await expect(selectedLine).toContainText(`${pieceLabel} (update)`);

    await dispatchRoomClick(currentRoom);
    await expect(selectedLine).toContainText('None');
    await expect(plannedLine).toContainText('No moves planned.');
    await expect(plannedLine).not.toContainText(plannedMoveText);
  });
});
