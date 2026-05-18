import { expect, test, type Page } from '@playwright/test';

const gameStateStorageKey = 'kdl.gameState.v1';

type SetupResult = {
  currentPlayerPieceId: string;
  normalSetup: {
    moveCards: number;
    weaponCards: number;
    failureCards: number;
    player2MoveCards: number;
    player2WeaponCards: number;
    player2FailureCards: number;
    doctorRoomId: number;
    player1RoomId: number;
    stranger1RoomId: number;
    player2RoomId: number;
    stranger2RoomId: number;
    player1Strength: number;
    stranger1Strength: number;
    player2Strength: number;
    stranger2Strength: number;
    turnId: number;
    currentPlayerPieceId: string;
  };
  positions: number[];
  strengths: Record<'player1' | 'stranger1' | 'player2' | 'stranger2', number>;
};

const readSetupResult = async (page: Page): Promise<SetupResult> =>
  page.evaluate(async (storageKey) => {
    const snapshot = window.localStorage.getItem(storageKey);
    if (!snapshot) {
      throw new Error('Expected saved game snapshot after setup.');
    }

    const parsed = JSON.parse(snapshot) as {
      normalSetup?: SetupResult['normalSetup'];
      normal_setup?: SetupResult['normalSetup'];
    };
    const normalSetup = parsed.normalSetup ?? parsed.normal_setup;
    if (!normalSetup) {
      throw new Error('Expected normalSetup in saved game snapshot.');
    }

    const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
    await wasm.default();
    const gameState = wasm.newDefaultGameState();
    try {
      const importError = gameState.importStateJson(snapshot);
      if (importError) {
        throw new Error(importError);
      }

      return {
        currentPlayerPieceId: gameState.currentPlayerPieceId(),
        normalSetup,
        positions: Array.from(gameState.piecePositions(), (value: number) => Number(value)),
        strengths: {
          player1: gameState.pieceStrength('player1'),
          stranger1: gameState.pieceStrength('stranger1'),
          player2: gameState.pieceStrength('player2'),
          stranger2: gameState.pieceStrength('stranger2'),
        },
      };
    } finally {
      gameState.free();
    }
  }, gameStateStorageKey);

test('advanced setup snaps card quantities to 32nds and applies room and current-player overrides', async ({ page }) => {
  await page.goto('/');

  const choices = await page.evaluate(async () => {
    const wasm = await import('/src/KdlRust/pkg/kill_doctor_lucky_rust.js');
    await wasm.default();
    const gameState = wasm.newDefaultGameState();
    try {
      const defaults = JSON.parse(gameState.defaultNormalSetupJson()) as {
        doctorRoomId: number;
        player1RoomId: number;
        stranger1RoomId: number;
        player2RoomId: number;
        stranger2RoomId: number;
      };
      const roomIds = (JSON.parse(gameState.boardRoomsJson()) as Array<{ id?: number; Id?: number }>)
        .map((room) => (typeof room.id === 'number' ? room.id : room.Id))
        .filter((roomId): roomId is number => typeof roomId === 'number')
        .sort((a, b) => a - b);

      const chooseDifferentRoom = (avoid: number[]) => {
        const next = roomIds.find((roomId) => !avoid.includes(roomId));
        if (next === undefined) {
          throw new Error(`Could not find room not in [${avoid.join(', ')}].`);
        }
        return next;
      };

      const doctorRoomId = chooseDifferentRoom([defaults.doctorRoomId]);
      const player1RoomId = chooseDifferentRoom([defaults.player1RoomId, doctorRoomId]);
      const stranger1RoomId = chooseDifferentRoom([defaults.stranger1RoomId, doctorRoomId, player1RoomId]);
      const player2RoomId = chooseDifferentRoom([defaults.player2RoomId, doctorRoomId, player1RoomId, stranger1RoomId]);
      const stranger2RoomId = chooseDifferentRoom([
        defaults.stranger2RoomId,
        doctorRoomId,
        player1RoomId,
        stranger1RoomId,
        player2RoomId,
      ]);

      return {
        doctorRoomId,
        player1RoomId,
        stranger1RoomId,
        player2RoomId,
        stranger2RoomId,
      };
    } finally {
      gameState.free();
    }
  });

  await page.getByRole('button', { name: 'Setup' }).click();
  await page.getByRole('checkbox', { name: 'Advanced' }).check();

  await page.getByRole('spinbutton', { name: 'P1 move cards' }).fill('0.34');
  await page.getByRole('spinbutton', { name: 'P1 weapon cards' }).fill('0.68');
  await page.getByRole('spinbutton', { name: 'P1 failure cards' }).fill('1.23');
  await page.getByRole('spinbutton', { name: 'P3 move cards' }).fill('2.34');
  await page.getByRole('spinbutton', { name: 'P3 weapon cards' }).fill('2.68');
  await page.getByRole('spinbutton', { name: 'P3 failure cards' }).fill('3.23');

  await page.getByLabel('Doctor room').selectOption({ value: choices.doctorRoomId.toString() });
  await page.getByLabel('P1 room').selectOption({ value: choices.player1RoomId.toString() });
  await page.getByLabel('p2 room').selectOption({ value: choices.stranger1RoomId.toString() });
  await page.getByLabel('P3 room').selectOption({ value: choices.player2RoomId.toString() });
  await page.getByLabel('p4 room').selectOption({ value: choices.stranger2RoomId.toString() });
  await page.getByRole('spinbutton', { name: 'P1 strength' }).fill('3');
  await page.getByRole('spinbutton', { name: 'p2 strength' }).fill('4');
  await page.getByRole('spinbutton', { name: 'P3 strength' }).fill('5');
  await page.getByRole('spinbutton', { name: 'p4 strength' }).fill('6');
  await page.getByRole('spinbutton', { name: 'Turn id' }).fill('4');
  await page.getByRole('radio', { name: 'P3' }).check();

  await page.getByRole('button', { name: 'Start New Game' }).click();

  await expect(page.locator('.planner-panel .planner-title').first()).toContainText('P3');

  const result = await readSetupResult(page);
  expect(result.currentPlayerPieceId).toBe('player2');
  expect(result.normalSetup.currentPlayerPieceId).toBe('player2');
  expect(result.normalSetup.moveCards).toBeCloseTo(11 / 32, 10);
  expect(result.normalSetup.weaponCards).toBeCloseTo(22 / 32, 10);
  expect(result.normalSetup.failureCards).toBeCloseTo(39 / 32, 10);
  expect(result.normalSetup.player2MoveCards).toBeCloseTo(75 / 32, 10);
  expect(result.normalSetup.player2WeaponCards).toBeCloseTo(86 / 32, 10);
  expect(result.normalSetup.player2FailureCards).toBeCloseTo(103 / 32, 10);
  expect(result.normalSetup.doctorRoomId).toBe(choices.doctorRoomId);
  expect(result.normalSetup.player1RoomId).toBe(choices.player1RoomId);
  expect(result.normalSetup.stranger1RoomId).toBe(choices.stranger1RoomId);
  expect(result.normalSetup.player2RoomId).toBe(choices.player2RoomId);
  expect(result.normalSetup.stranger2RoomId).toBe(choices.stranger2RoomId);
  expect(result.normalSetup.player1Strength).toBe(3);
  expect(result.normalSetup.stranger1Strength).toBe(4);
  expect(result.normalSetup.player2Strength).toBe(5);
  expect(result.normalSetup.stranger2Strength).toBe(6);
  expect(result.normalSetup.turnId).toBe(4);
  expect(result.positions[0]).toBe(choices.doctorRoomId);
  expect(result.positions[1]).toBe(choices.player1RoomId);
  expect(result.positions[2]).toBe(choices.player2RoomId);
  expect(result.positions[3]).toBe(choices.stranger1RoomId);
  expect(result.positions[4]).toBe(choices.stranger2RoomId);
  expect(result.strengths.player1).toBe(3);
  expect(result.strengths.stranger1).toBe(4);
  expect(result.strengths.player2).toBe(5);
  expect(result.strengths.stranger2).toBe(6);
});

test('advanced setup +/- buttons move card quantities by 1', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Setup' }).click();
  await page.getByRole('checkbox', { name: 'Advanced' }).check();

  const p1MoveCards = page.getByRole('spinbutton', { name: 'P1 move cards' });
  const p3MoveCards = page.getByRole('spinbutton', { name: 'P3 move cards' });

  await expect(p1MoveCards).toHaveValue('2');
  await expect(p3MoveCards).toHaveValue('2');

  await page.getByRole('button', { name: 'Increase move cards' }).click();
  await page.getByRole('button', { name: 'Decrease P3 move cards' }).click();

  await expect(p1MoveCards).toHaveValue('3');
  await expect(p3MoveCards).toHaveValue('1');

  await p1MoveCards.fill('0.02');
  await page.getByRole('button', { name: 'Increase move cards' }).click();
  await expect(p1MoveCards).toHaveValue('1');

  await p1MoveCards.fill('2.5');
  await page.getByRole('button', { name: 'Increase move cards' }).click();
  await expect(p1MoveCards).toHaveValue('3');

  await p1MoveCards.fill('2.5');
  await page.getByRole('button', { name: 'Decrease move cards' }).click();
  await expect(p1MoveCards).toHaveValue('2');

  await p1MoveCards.fill('2.1');
  await page.getByRole('button', { name: 'Decrease move cards' }).click();
  await expect(p1MoveCards).toHaveValue('2');

  await p1MoveCards.fill('2.9');
  await page.getByRole('button', { name: 'Decrease move cards' }).click();
  await expect(p1MoveCards).toHaveValue('2');
});

test('advanced setup +/- buttons step room dropdown options', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Setup' }).click();
  await page.getByRole('checkbox', { name: 'Advanced' }).check();

  const visibleRoomLabels = await page.evaluate(() =>
    ['Doctor room', 'P1 room', 'p2 room', 'P3 room', 'p4 room'].map((ariaLabel) => {
      const select = document.querySelector(`select[aria-label="${ariaLabel}"]`);
      const row = select?.closest('.setup-popup-row');
      return row?.querySelector(':scope > span')?.textContent ?? null;
    }),
  );
  expect(visibleRoomLabels).toEqual(['Dr', 'P1', 'p2', 'P3', 'p4']);

  const rooms = await page.getByLabel('Doctor room').evaluate((select) =>
    Array.from((select as HTMLSelectElement).options, (option) => option.value),
  );
  expect(rooms.length).toBeGreaterThan(2);
  const firstRoom = rooms[0];
  const secondRoom = rooms[1];
  const lastRoom = rooms.at(-1);
  if (!firstRoom || !secondRoom || !lastRoom) {
    throw new Error('Expected at least two setup room options.');
  }

  const roomStepperCases = [
    { selectName: 'Doctor room', previousName: 'Previous Doctor', nextName: 'Next Doctor' },
    { selectName: 'P1 room', previousName: 'Previous P1', nextName: 'Next P1' },
    { selectName: 'p2 room', previousName: 'Previous p2', nextName: 'Next p2' },
    { selectName: 'P3 room', previousName: 'Previous P3', nextName: 'Next P3' },
    { selectName: 'p4 room', previousName: 'Previous p4', nextName: 'Next p4' },
  ];

  for (const { selectName, previousName, nextName } of roomStepperCases) {
    const roomSelect = page.getByLabel(selectName);
    await roomSelect.selectOption(secondRoom);
    await page.getByRole('button', { name: previousName }).click();
    await expect(roomSelect).toHaveValue(firstRoom);
    await page.getByRole('button', { name: nextName }).click();
    await expect(roomSelect).toHaveValue(secondRoom);
    await roomSelect.selectOption(firstRoom);
    await page.getByRole('button', { name: previousName }).click();
    await expect(roomSelect).toHaveValue(lastRoom);
    await page.getByRole('button', { name: nextName }).click();
    await expect(roomSelect).toHaveValue(firstRoom);
  }
});

test('fractional shared card quantities do not force advanced setup when reopening', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Setup' }).click();
  await page.getByRole('spinbutton', { name: 'Normal move cards' }).fill('2.5');
  await page.getByRole('spinbutton', { name: 'Normal weapon cards' }).fill('3.5');
  await page.getByRole('spinbutton', { name: 'Normal failure cards' }).fill('4.5');
  await page.getByRole('button', { name: 'Start New Game' }).click();

  await page.getByRole('button', { name: 'Setup' }).click();

  const advancedCheckbox = page.getByRole('checkbox', { name: 'Advanced' });
  await expect(advancedCheckbox).not.toBeChecked();
  await expect(page.getByRole('spinbutton', { name: 'Normal move cards' })).toHaveValue('2.5');
  await expect(page.getByRole('spinbutton', { name: 'Normal weapon cards' })).toHaveValue('3.5');
  await expect(page.getByRole('spinbutton', { name: 'Normal failure cards' })).toHaveValue('4.5');
  await expect(page.getByRole('spinbutton', { name: 'P3 move cards' })).toHaveCount(0);
});
