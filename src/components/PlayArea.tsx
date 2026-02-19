import { useRef, useState, type MouseEvent } from 'react';
import { newDefaultGameState, type GameStateHandle } from '@/KdlRust/pkg/kill_doctor_lucky_rust';
import boardData from '../data/boards/BoardAltDown.json';

type PieceId = 'doctor' | 'player1' | 'player2' | 'stranger1' | 'stranger2';

type TurnPlanEntry = {
  pieceId: PieceId;
  roomId: number;
};

type TurnPlanPreviewResponse = {
  isValid: boolean;
  validationMessage: string;
  nextPlayerPieceId: string;
  hasWinner: boolean;
  winnerPieceId: string;
  attackers: string[];
  currentPlayerLoots: boolean;
  doctorRoomId: number;
  movedStrangers: Array<{
    pieceId: string;
    roomId: number;
  }>;
};

type PreviewToken =
  | {
      kind: 'text';
      text: string;
      colorPieceId: PieceId | null;
    }
  | {
      kind: 'winner';
      winnerPieceId: PieceId | null;
      winnerText: string;
    };

type PreviewDisplay = {
  message: string | null;
  tokens: PreviewToken[];
};

type InfoPopupKind = 'rules' | 'turnPlanner' | 'ai' | 'playerInfoBox';

type PlayerStatsResponseRow = {
  pieceId: string;
  doctorDistance: number;
  strength: number;
  moveCards: number;
  weaponCards: number;
  failureCards: number;
  equivalentClovers: number;
};

type PlayerStatsRow = {
  pieceId: Exclude<PieceId, 'doctor'>;
  doctorDistance: number;
  strength: number;
  moveCards: number;
  weaponCards: number;
  failureCards: number;
  equivalentClovers: number;
};

type BestTurnResponse = {
  isValid: boolean;
  validationMessage: string;
  suggestedTurnText: string;
  suggestedTurn: TurnPlanEntry[];
  heuristicScore: number;
  numStatesVisited: number;
  elapsedMs: number;
};

type TreeSearchWorkerRequest = {
  type: 'analyze';
  runId: number;
  stateJson: string;
  analysisLevel: number;
};

type TreeSearchWorkerResponse =
  | {
      type: 'analysisResult';
      runId: number;
      analysisRaw: string;
      previewRaw: string;
    }
  | {
      type: 'analysisError';
      runId: number;
      message: string;
    };

type AiSuggestion = {
  sourceTurnCounter: number;
  analysisLevel: number;
  bestTurn: BestTurnResponse;
  previewRaw: string;
  elapsedMs: number;
  levelElapsedMs: number;
};

type AiResultsCacheEntry = {
  stateJson: string;
  analysisLevel: number;
  bestTurn: BestTurnResponse;
  previewRaw: string;
  elapsedMs: number;
  levelElapsedMs: number;
  lastUsedAtMs: number;
};

type AiResultsCacheStore = {
  version: 1;
  entries: AiResultsCacheEntry[];
};

type BoardRoomRaw = {
  Id: string | number;
  Name?: string;
  Coords: number[];
  Adjacent?: Array<string | number>;
  Visible?: Array<string | number>;
};

type BoardRoom = {
  id: number;
  name?: string;
  coords: number[];
  adjacent: number[];
  visible: number[];
};

type BoardLayout = {
  ImagePath: string;
  Rooms: BoardRoomRaw[];
};

type ActionKind = 'loot' | 'attack';

type ActionInfo = {
  kind: ActionKind;
  actor: PieceId;
};

type ShapeProps = {
  className?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  pointerEvents?: string;
  onClick?: (event: MouseEvent<SVGElement>) => void;
  'aria-label'?: string;
  'aria-hidden'?: boolean;
};

type RoomRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const boardLayout = boardData as BoardLayout;
const boardWidth = 1480;
const boardHeight = 965;
const boardImageHref = `${import.meta.env.BASE_URL}${boardLayout.ImagePath.replace(/^\//, '')}`;
const boardRooms: BoardRoom[] = boardLayout.Rooms.map((room) => ({
  id: Number(room.Id),
  name: room.Name,
  coords: room.Coords,
  adjacent: room.Adjacent?.map(Number) ?? [],
  visible: room.Visible?.map(Number) ?? [],
}));
const boardRoomById = new Map<number, BoardRoom>(boardRooms.map((room) => [room.id, room] as const));

const pieceOrder: PieceId[] = ['doctor', 'player1', 'player2', 'stranger1', 'stranger2'];
const playerStatsRowOrder: Array<Exclude<PieceId, 'doctor'>> = ['stranger2', 'player1', 'stranger1', 'player2'];
const animationSpeeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5];
const defaultSpeedIndex = 8;
const analysisMaxTimeOptions = [
  { label: '50ms', ms: 50 },
  { label: '500ms', ms: 500 },
  { label: '2s', ms: 2000 },
  { label: '6s', ms: 6000 },
  { label: '10s', ms: 10000 },
  { label: '15s', ms: 15000 },
  { label: '30s', ms: 30000 },
  { label: '45s', ms: 45000 },
  { label: '1min', ms: 60000 },
  { label: '1.5min', ms: 90000 },
  { label: '2min', ms: 120000 },
  { label: '3min', ms: 180000 },
  { label: '4min', ms: 240000 },
  { label: '5min', ms: 300000 },
  { label: '8min', ms: 480000 },
  { label: '12min', ms: 720000 },
  { label: '30min', ms: 1.8e6 },
  { label: '60min', ms: 3.6e6 },
] as const;
const defaultAnalysisMaxTimeIndex = 1;
const defaultMinAnalysisLevel = 2;
const defaultMaxAnalysisLevel = 15;
const touchDoubleTapGraceMs = 650;
const isPieceId = (value: string): value is PieceId => pieceOrder.includes(value as PieceId);
const animationPrefsStorageKey = 'kdl.settings.v1';
const aiPrefsStorageKey = 'kdl.ai.v1';
const aiResultsCacheStorageKey = 'kdl.aiResultsCache.v1';
const setupPrefsStorageKey = 'kdl.setup.v1';
const gameStateStorageKey = 'kdl.gameState.v1';
const redoStateStackStorageKey = 'kdl.redoStack.v1';
const assumedLocalStorageLimitBytes = 5 * 1024 * 1024;
const localStorageUsageThresholdRatio = 0.85;
const boardOverlayFontSizePx = 27;
const fallbackSetupPrefs = {
  moveCards: 2,
  weaponCards: 2,
  failureCards: 4,
};

type AnimationPrefs = {
  animationEnabled: boolean;
  animationSpeedIndex: number;
};

type AiPrefs = {
  minAnalysisLevel: number;
  maxAnalysisLevel: number;
  analysisMaxTimeIndex: number;
  controlP1: boolean;
  controlP3: boolean;
  showOnBoardP1: boolean;
  showOnBoardP3: boolean;
};

type SetupPrefs = {
  moveCards: number;
  weaponCards: number;
  failureCards: number;
};

type SetupPrefsDraft = {
  moveCards: string;
  weaponCards: string;
  failureCards: string;
};

type PendingEmptyRoomTouchTap = {
  roomId: number;
  startedAtMs: number;
  turnCounterAtTap: number;
};

type StepDirection = 'down' | 'up';

const parseNormalTurnCountFromSnapshotJson = (snapshotJson: string): number | null => {
  try {
    const parsed = JSON.parse(snapshotJson) as {
      normalTurns?: unknown;
      normal_turns?: unknown;
    };
    const turns = Array.isArray(parsed.normalTurns)
      ? parsed.normalTurns
      : Array.isArray(parsed.normal_turns)
        ? parsed.normal_turns
        : null;
    if (!turns) {
      return null;
    }
    return turns.length + 1;
  } catch {
    return null;
  }
};

const clampAnimationSpeedIndex = (value: number) => Math.min(animationSpeeds.length - 1, Math.max(0, value));
const clampAnalysisMaxTimeIndex = (value: number) => Math.min(analysisMaxTimeOptions.length - 1, Math.max(0, value));
const isFiniteNonNegative = (value: number) => Number.isFinite(value) && value >= 0;
const parseMinAnalysisLevelDraft = (draft: string) => {
  const parsed = Number(draft);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.trunc(parsed);
};
const parseMaxAnalysisLevelDraft = (draft: string) => {
  const parsed = Number(draft);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.trunc(parsed);
};
const toSetupPrefsDraft = (prefs: SetupPrefs): SetupPrefsDraft => ({
  moveCards: prefs.moveCards.toString(),
  weaponCards: prefs.weaponCards.toString(),
  failureCards: prefs.failureCards.toString(),
});
const parseSetupPrefsDraft = (draft: SetupPrefsDraft): SetupPrefs | null => {
  const parsed = {
    moveCards: Number(draft.moveCards),
    weaponCards: Number(draft.weaponCards),
    failureCards: Number(draft.failureCards),
  };
  return isFiniteNonNegative(parsed.moveCards) &&
    isFiniteNonNegative(parsed.weaponCards) &&
    isFiniteNonNegative(parsed.failureCards)
    ? parsed
    : null;
};
const stepNonNegativeIntegerText = (raw: string, direction: StepDirection) => {
  const parsed = Number(raw);
  const base = Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
  const next = direction === 'down' ? Math.max(0, base - 1) : base + 1;
  return next.toString();
};
const sanitizeSetupPrefs = (candidate: Partial<SetupPrefs>, fallback: SetupPrefs): SetupPrefs => {
  const moveCards = isFiniteNonNegative(candidate.moveCards ?? NaN)
    ? (candidate.moveCards as number)
    : fallback.moveCards;
  const weaponCards = isFiniteNonNegative(candidate.weaponCards ?? NaN)
    ? (candidate.weaponCards as number)
    : fallback.weaponCards;
  const failureCards = isFiniteNonNegative(candidate.failureCards ?? NaN)
    ? (candidate.failureCards as number)
    : fallback.failureCards;
  return {
    moveCards,
    weaponCards,
    failureCards,
  };
};
const parseSetupPrefsJson = (raw: string, fallback: SetupPrefs): SetupPrefs => {
  try {
    const parsed = JSON.parse(raw) as Partial<SetupPrefs>;
    return sanitizeSetupPrefs(parsed, fallback);
  } catch {
    return fallback;
  }
};
const loadSetupPrefs = (fallback: SetupPrefs): SetupPrefs => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(setupPrefsStorageKey);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<SetupPrefs>;
    return sanitizeSetupPrefs(parsed, fallback);
  } catch {
    return fallback;
  }
};
const saveSetupPrefs = (prefs: SetupPrefs) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(setupPrefsStorageKey, JSON.stringify(sanitizeSetupPrefs(prefs, fallbackSetupPrefs)));
  } catch {
    // Ignore persistence failures (e.g. private mode / quota).
  }
};

const loadAnimationPrefs = (): AnimationPrefs => {
  const defaults: AnimationPrefs = { animationEnabled: true, animationSpeedIndex: defaultSpeedIndex };
  if (typeof window === 'undefined') {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(animationPrefsStorageKey);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<AnimationPrefs>;
    const animationEnabled = typeof parsed.animationEnabled === 'boolean' ? parsed.animationEnabled : true;
    const parsedSpeedIndex =
      typeof parsed.animationSpeedIndex === 'number' && Number.isFinite(parsed.animationSpeedIndex)
        ? Math.trunc(parsed.animationSpeedIndex)
        : defaultSpeedIndex;
    return {
      animationEnabled,
      animationSpeedIndex: clampAnimationSpeedIndex(parsedSpeedIndex),
    };
  } catch {
    return defaults;
  }
};

const saveAnimationPrefs = (prefs: AnimationPrefs) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      animationPrefsStorageKey,
      JSON.stringify({
        animationEnabled: prefs.animationEnabled,
        animationSpeedIndex: clampAnimationSpeedIndex(prefs.animationSpeedIndex),
      }),
    );
  } catch {
    // Ignore persistence failures (e.g. private mode / quota).
  }
};

const sanitizeAiPrefs = (candidate: Partial<AiPrefs>): AiPrefs => {
  const minAnalysisLevel = isFiniteNonNegative(candidate.minAnalysisLevel ?? NaN)
    ? Math.trunc(candidate.minAnalysisLevel as number)
    : defaultMinAnalysisLevel;
  const maxAnalysisLevel = isFiniteNonNegative(candidate.maxAnalysisLevel ?? NaN)
    ? Math.trunc(candidate.maxAnalysisLevel as number)
    : defaultMaxAnalysisLevel;
  const rawMaxTimeIndex =
    typeof candidate.analysisMaxTimeIndex === 'number' && Number.isFinite(candidate.analysisMaxTimeIndex)
      ? Math.trunc(candidate.analysisMaxTimeIndex)
      : defaultAnalysisMaxTimeIndex;
  const controlP1 = typeof candidate.controlP1 === 'boolean' ? candidate.controlP1 : false;
  const controlP3 = typeof candidate.controlP3 === 'boolean' ? candidate.controlP3 : false;
  const showOnBoardP1 = typeof candidate.showOnBoardP1 === 'boolean' ? candidate.showOnBoardP1 : false;
  const showOnBoardP3 = typeof candidate.showOnBoardP3 === 'boolean' ? candidate.showOnBoardP3 : false;
  return {
    minAnalysisLevel,
    maxAnalysisLevel,
    analysisMaxTimeIndex: clampAnalysisMaxTimeIndex(rawMaxTimeIndex),
    controlP1,
    controlP3,
    showOnBoardP1,
    showOnBoardP3,
  };
};

const loadAiPrefs = (): AiPrefs => {
  const defaults = {
    minAnalysisLevel: defaultMinAnalysisLevel,
    maxAnalysisLevel: defaultMaxAnalysisLevel,
    analysisMaxTimeIndex: defaultAnalysisMaxTimeIndex,
    controlP1: false,
    controlP3: false,
    showOnBoardP1: false,
    showOnBoardP3: false,
  };
  if (typeof window === 'undefined') {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(aiPrefsStorageKey);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<AiPrefs>;
    return sanitizeAiPrefs(parsed);
  } catch {
    return defaults;
  }
};

const saveAiPrefs = (prefs: AiPrefs) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(aiPrefsStorageKey, JSON.stringify(sanitizeAiPrefs(prefs)));
  } catch {
    // Ignore persistence failures (e.g. private mode / quota).
  }
};

const createEmptyAiResultsCacheStore = (): AiResultsCacheStore => ({
  version: 1,
  entries: [],
});

const sanitizeCachedTurnPlanEntry = (candidate: unknown): TurnPlanEntry | null => {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const parsed = candidate as { pieceId?: unknown; roomId?: unknown };
  const pieceId = parsed.pieceId;
  if (typeof pieceId !== 'string' || !isPieceId(pieceId)) {
    return null;
  }
  if (typeof parsed.roomId !== 'number' || !Number.isFinite(parsed.roomId)) {
    return null;
  }
  return {
    pieceId,
    roomId: parsed.roomId,
  };
};

const sanitizeCachedBestTurnResponse = (candidate: unknown): BestTurnResponse | null => {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const parsed = candidate as Partial<BestTurnResponse>;
  if (parsed.isValid !== true) {
    return null;
  }
  if (typeof parsed.suggestedTurnText !== 'string') {
    return null;
  }
  if (!Array.isArray(parsed.suggestedTurn)) {
    return null;
  }
  const suggestedTurn = parsed.suggestedTurn
    .map((entry) => sanitizeCachedTurnPlanEntry(entry))
    .filter((entry): entry is TurnPlanEntry => entry !== null);
  if (
    typeof parsed.validationMessage !== 'string' ||
    typeof parsed.heuristicScore !== 'number' ||
    !Number.isFinite(parsed.heuristicScore) ||
    typeof parsed.numStatesVisited !== 'number' ||
    !Number.isFinite(parsed.numStatesVisited) ||
    typeof parsed.elapsedMs !== 'number' ||
    !Number.isFinite(parsed.elapsedMs)
  ) {
    return null;
  }
  return {
    isValid: true,
    validationMessage: parsed.validationMessage,
    suggestedTurnText: parsed.suggestedTurnText,
    suggestedTurn,
    heuristicScore: parsed.heuristicScore,
    numStatesVisited: parsed.numStatesVisited,
    elapsedMs: parsed.elapsedMs,
  };
};

const sanitizeAiResultsCacheEntry = (candidate: unknown): AiResultsCacheEntry | null => {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const parsed = candidate as Partial<AiResultsCacheEntry>;
  if (typeof parsed.stateJson !== 'string' || parsed.stateJson.length === 0) {
    return null;
  }
  if (typeof parsed.analysisLevel !== 'number' || !Number.isFinite(parsed.analysisLevel) || parsed.analysisLevel < 0) {
    return null;
  }
  const bestTurn = sanitizeCachedBestTurnResponse(parsed.bestTurn);
  if (!bestTurn) {
    return null;
  }
  if (typeof parsed.previewRaw !== 'string') {
    return null;
  }
  if (typeof parsed.elapsedMs !== 'number' || !Number.isFinite(parsed.elapsedMs) || parsed.elapsedMs < 0) {
    return null;
  }
  if (
    typeof parsed.levelElapsedMs !== 'number' ||
    !Number.isFinite(parsed.levelElapsedMs) ||
    parsed.levelElapsedMs < 0
  ) {
    return null;
  }
  if (typeof parsed.lastUsedAtMs !== 'number' || !Number.isFinite(parsed.lastUsedAtMs) || parsed.lastUsedAtMs < 0) {
    return null;
  }

  return {
    stateJson: parsed.stateJson,
    analysisLevel: Math.trunc(parsed.analysisLevel),
    bestTurn,
    previewRaw: parsed.previewRaw,
    elapsedMs: parsed.elapsedMs,
    levelElapsedMs: parsed.levelElapsedMs,
    lastUsedAtMs: parsed.lastUsedAtMs,
  };
};

const normalizeAiResultsCacheEntries = (entries: AiResultsCacheEntry[]) => {
  const entriesByState = new Map<string, AiResultsCacheEntry>();
  entries.forEach((entry) => {
    const previous = entriesByState.get(entry.stateJson);
    if (!previous || previous.lastUsedAtMs <= entry.lastUsedAtMs) {
      entriesByState.set(entry.stateJson, entry);
    }
  });
  return Array.from(entriesByState.values());
};

const estimateStorageStringBytes = (value: string) => value.length * 2;

const estimateLocalStorageUsageBytes = (storage: Storage, excludedKey?: string) => {
  let totalBytes = 0;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || key === excludedKey) {
      continue;
    }
    const value = storage.getItem(key) ?? '';
    totalBytes += estimateStorageStringBytes(key) + estimateStorageStringBytes(value);
  }
  return totalBytes;
};

const getOldestAiResultsCacheEntryIndex = (entries: AiResultsCacheEntry[]) => {
  if (entries.length === 0) {
    return -1;
  }
  let oldestIndex = 0;
  let oldestTime = entries[0].lastUsedAtMs;
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index].lastUsedAtMs < oldestTime) {
      oldestTime = entries[index].lastUsedAtMs;
      oldestIndex = index;
    }
  }
  return oldestIndex;
};

const saveAiResultsCacheStore = (store: AiResultsCacheStore): AiResultsCacheStore => {
  const normalizedStore: AiResultsCacheStore = {
    version: 1,
    entries: normalizeAiResultsCacheEntries(store.entries),
  };
  if (typeof window === 'undefined') {
    return normalizedStore;
  }

  const storage = window.localStorage;
  const usageThresholdBytes = Math.floor(assumedLocalStorageLimitBytes * localStorageUsageThresholdRatio);
  const bytesWithoutCacheKey = estimateLocalStorageUsageBytes(storage, aiResultsCacheStorageKey);
  const nextEntries = [...normalizedStore.entries];

  while (nextEntries.length > 0) {
    const serialized = JSON.stringify({ version: 1, entries: nextEntries } satisfies AiResultsCacheStore);
    const projectedUsageBytes =
      bytesWithoutCacheKey +
      estimateStorageStringBytes(aiResultsCacheStorageKey) +
      estimateStorageStringBytes(serialized);
    if (projectedUsageBytes < usageThresholdBytes) {
      try {
        storage.setItem(aiResultsCacheStorageKey, serialized);
        return {
          version: 1,
          entries: [...nextEntries],
        };
      } catch {
        // Try again after removing oldest entries until a write succeeds.
      }
    }
    const oldestEntryIndex = getOldestAiResultsCacheEntryIndex(nextEntries);
    if (oldestEntryIndex < 0) {
      break;
    }
    nextEntries.splice(oldestEntryIndex, 1);
  }

  try {
    storage.removeItem(aiResultsCacheStorageKey);
  } catch {
    // Ignore cleanup failures.
  }
  return createEmptyAiResultsCacheStore();
};

const loadAiResultsCacheStore = (): AiResultsCacheStore => {
  if (typeof window === 'undefined') {
    return createEmptyAiResultsCacheStore();
  }

  try {
    const raw = window.localStorage.getItem(aiResultsCacheStorageKey);
    if (!raw) {
      return createEmptyAiResultsCacheStore();
    }
    const parsed = JSON.parse(raw) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) {
      window.localStorage.removeItem(aiResultsCacheStorageKey);
      return createEmptyAiResultsCacheStore();
    }
    const sanitizedEntries = parsed.entries
      .map((entry) => sanitizeAiResultsCacheEntry(entry))
      .filter((entry): entry is AiResultsCacheEntry => entry !== null);
    return saveAiResultsCacheStore({
      version: 1,
      entries: sanitizedEntries,
    });
  } catch {
    try {
      window.localStorage.removeItem(aiResultsCacheStorageKey);
    } catch {
      // Ignore cleanup failures.
    }
    return createEmptyAiResultsCacheStore();
  }
};

const clearAiResultsCacheStore = (): AiResultsCacheStore => {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(aiResultsCacheStorageKey);
    } catch {
      // Ignore cleanup failures.
    }
  }
  return createEmptyAiResultsCacheStore();
};

const saveGameStateSnapshot = (gameState: GameStateHandle | null) => {
  if (!gameState || typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(gameStateStorageKey, gameState.exportStateJson());
  } catch {
    // Ignore persistence failures (e.g. private mode / quota).
  }
};

const loadRedoStateStack = (): string[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const hasGameStateSnapshot = window.localStorage.getItem(gameStateStorageKey) !== null;
    if (!hasGameStateSnapshot) {
      window.localStorage.removeItem(redoStateStackStorageKey);
      return [];
    }

    const raw = window.localStorage.getItem(redoStateStackStorageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      window.localStorage.removeItem(redoStateStackStorageKey);
      return [];
    }
    return parsed.filter((snapshot): snapshot is string => typeof snapshot === 'string');
  } catch {
    try {
      window.localStorage.removeItem(redoStateStackStorageKey);
    } catch {
      // Ignore cleanup failures.
    }
    return [];
  }
};

const saveRedoStateStack = (redoStateStack: string[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const snapshots = redoStateStack.filter((snapshot): snapshot is string => typeof snapshot === 'string');
    if (snapshots.length === 0) {
      window.localStorage.removeItem(redoStateStackStorageKey);
      return;
    }
    window.localStorage.setItem(redoStateStackStorageKey, JSON.stringify(snapshots));
  } catch {
    // Ignore persistence failures (e.g. private mode / quota).
  }
};

const loadGameStateSnapshot = (gameState: GameStateHandle) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const rawSnapshot = window.localStorage.getItem(gameStateStorageKey);
    if (!rawSnapshot) {
      return;
    }

    const importError = gameState.importStateJson(rawSnapshot);
    if (importError) {
      window.localStorage.removeItem(gameStateStorageKey);
      window.localStorage.removeItem(redoStateStackStorageKey);
      console.warn(`Saved game ignored: ${importError}`);
      return;
    }
    const setupFromGame = parseSetupPrefsJson(gameState.currentNormalSetupJson(), fallbackSetupPrefs);
    saveSetupPrefs(setupFromGame);
  } catch {
    try {
      window.localStorage.removeItem(gameStateStorageKey);
      window.localStorage.removeItem(redoStateStackStorageKey);
    } catch {
      // Ignore cleanup failures.
    }
  }
};

const pieceConfig: Record<
  PieceId,
  {
    label: string;
    shape: 'circle' | 'square' | 'hex';
    color: string;
    textColor: string;
    showLabel: boolean;
  }
> = {
  doctor: { label: 'Dr', shape: 'circle', color: '#000000', textColor: '#ffffff', showLabel: true },
  player1: { label: 'P1', shape: 'square', color: '#ff4444', textColor: '#000000', showLabel: true },
  player2: { label: 'P3', shape: 'square', color: '#44ff44', textColor: '#000000', showLabel: true },
  stranger1: { label: 'p2', shape: 'hex', color: '#f08a24', textColor: '#000000', showLabel: true },
  stranger2: { label: 'p4', shape: 'hex', color: '#55cccc', textColor: '#000000', showLabel: true },
};

const pieceSizeTarget = 80;
const pieceGap = 3;

const getRoomRect = (coords: number[]): RoomRect => ({
  x: coords[0],
  y: coords[1],
  width: coords[2] - coords[0],
  height: coords[3] - coords[1],
});

const getSlotLayout = (count: number) => {
  if (count <= 1) {
    return { cols: 1, rows: 1, slots: [{ col: 0, row: 0 }] };
  }
  if (count === 2) {
    return {
      cols: 2,
      rows: 1,
      slots: [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
      ],
    };
  }
  if (count === 3) {
    return {
      cols: 3,
      rows: 1,
      slots: [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
      ],
    };
  }
  if (count === 4) {
    return {
      cols: 2,
      rows: 2,
      slots: [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 0, row: 1 },
        { col: 1, row: 1 },
      ],
    };
  }

  return {
    cols: 3,
    rows: 2,
    slots: [
      { col: 1, row: 0 },
      { col: 0, row: 0 },
      { col: 2, row: 0 },
      { col: 0, row: 1 },
      { col: 2, row: 1 },
    ],
  };
};

const getPiecePositionsInRoom = (count: number, roomRect: RoomRect) => {
  if (count === 0) {
    return { size: pieceSizeTarget, positions: [] as Array<{ x: number; y: number }> };
  }

  const { cols, rows, slots } = getSlotLayout(count);
  const maxPieceWidth = (roomRect.width - pieceGap * (cols - 1)) / cols;
  const maxPieceHeight = (roomRect.height - pieceGap * (rows - 1)) / rows;
  const size = Math.min(pieceSizeTarget, maxPieceWidth, maxPieceHeight);
  const gridWidth = cols * size + pieceGap * (cols - 1);
  const gridHeight = rows * size + pieceGap * (rows - 1);
  const offsetX = roomRect.x + (roomRect.width - gridWidth) / 2;
  const offsetY = roomRect.y + (roomRect.height - gridHeight) / 2;

  const positions = slots.slice(0, count).map((slot) => ({
    x: offsetX + slot.col * (size + pieceGap),
    y: offsetY + slot.row * (size + pieceGap),
  }));

  return { size, positions };
};

const getHexPoints = (x: number, y: number, size: number) => {
  const radius = size / 2;
  const centerX = x + radius;
  const centerY = y + radius;
  const startAngle = Math.PI / 6;
  const points = Array.from({ length: 6 }, (_, index) => {
    const angle = startAngle + index * (Math.PI / 3);
    return `${centerX + radius * Math.cos(angle)},${centerY + radius * Math.sin(angle)}`;
  });

  return points.join(' ');
};

const actionDisplayBounds = (() => {
  const room3 = boardRoomById.get(3);
  const room11 = boardRoomById.get(11);
  const room12 = boardRoomById.get(12);
  if (!room3 || !room11 || !room12) {
    return null;
  }
  const room3Rect = getRoomRect(room3.coords);
  const room11Rect = getRoomRect(room11.coords);
  const room12Rect = getRoomRect(room12.coords);
  return {
    minX: room12Rect.x + room12Rect.width,
    maxX: room11Rect.x,
    minY: room3Rect.y + room3Rect.height,
  };
})();

const buildRoomDistanceMap = (startRoomId: number) => {
  const distances = new Map<number, number>();
  const queue = [startRoomId];
  distances.set(startRoomId, 0);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      continue;
    }
    const currentDistance = distances.get(current);
    if (currentDistance === undefined) {
      continue;
    }
    const room = boardRoomById.get(current);
    if (!room) {
      continue;
    }
    room.adjacent.forEach((neighbor) => {
      if (distances.has(neighbor)) {
        return;
      }
      distances.set(neighbor, currentDistance + 1);
      queue.push(neighbor);
    });
  }

  return distances;
};

const parseActionActor = (token: string): PieceId | null => {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }
  const prefix = trimmed[0];
  const num = Number(trimmed.slice(1));
  if (!Number.isFinite(num)) {
    return null;
  }
  if (prefix === 'P') {
    if (num === 1) {
      return 'player1';
    }
    if (num === 2 || num === 3) {
      return 'player2';
    }
    return null;
  }
  if (prefix === 'p') {
    if (num === 2) {
      return 'stranger1';
    }
    if (num === 4) {
      return 'stranger2';
    }
    return null;
  }
  return null;
};

const parseActionSummaries = (summary: string): Array<ActionInfo | null> => {
  const trimmed = summary.trim();
  if (!trimmed) {
    return [];
  }
  const lines = summary.split(/\r?\n/);
  const summaries: string[][] = [];
  let current: string[] = [];

  lines.forEach((line) => {
    if (line.startsWith('  Turn')) {
      if (current.length > 0) {
        summaries.push(current);
      }
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    }
  });

  if (current.length > 0) {
    summaries.push(current);
  }

  return summaries.map((entry) => {
    const actionKind = entry.some((line) => line.includes('    LOOT '))
      ? 'loot'
      : entry.some((line) => line.includes('    ATTACK:'))
        ? 'attack'
        : null;
    if (!actionKind) {
      return null;
    }
    const firstLine = entry[0] ?? '';
    const match = firstLine.match(/\(([^)]+)\)/);
    if (!match) {
      return null;
    }
    const actorToken = match[1].replace(/[MLA]+$/g, '');
    const actor = parseActionActor(actorToken);
    if (!actor) {
      return null;
    }
    return { kind: actionKind, actor };
  });
};

const buildActionOverlayLayout = (text: string) => {
  const fontSize = boardOverlayFontSizePx;
  const paddingX = 16;
  const paddingY = 8;
  const estimatedTextWidth = Math.max(60, text.length * fontSize * 0.6);
  const boxHeight = fontSize + paddingY * 2;
  const bounds = actionDisplayBounds;
  const minX = bounds ? bounds.minX + 8 : 12;
  const maxX = bounds ? bounds.maxX - 8 : boardWidth - 12;
  const minY = bounds ? bounds.minY + 6 : 12;
  const maxWidth = Math.max(120, maxX - minX);
  const boxWidth = Math.min(maxWidth, Math.max(160, estimatedTextWidth + paddingX * 2));
  const desiredX = boardWidth / 2 - boxWidth / 2;
  const desiredY = boardHeight - boxHeight - 12;
  const clampedX = Math.min(Math.max(desiredX, minX), Math.max(minX, maxX - boxWidth));
  const clampedY = Math.min(Math.max(desiredY, minY), Math.max(minY, boardHeight - boxHeight - 6));

  return {
    boxX: clampedX,
    boxY: clampedY,
    boxWidth,
    boxHeight,
    textX: clampedX + boxWidth / 2,
    textY: clampedY + boxHeight / 2 + 0.5,
    fontSize,
  };
};

const buildWinnerOverlayLayout = (text: string) => {
  const fontSize = 52;
  const paddingX = 24;
  const paddingY = 18;
  const estimatedTextWidth = Math.max(180, text.length * fontSize * 0.58);
  const maxWidth = Math.max(220, boardWidth - 40);
  const boxWidth = Math.min(maxWidth, Math.max(280, estimatedTextWidth + paddingX * 2));
  const boxHeight = fontSize + paddingY * 2;
  const boxX = boardWidth / 2 - boxWidth / 2;
  const boxY = boardHeight / 2 - boxHeight / 2;

  return {
    boxX,
    boxY,
    boxWidth,
    boxHeight,
    textX: boxX + boxWidth / 2,
    textY: boxY + boxHeight / 2 + 1,
  };
};

const blendHexColor = (from: string, to: string, ratio: number) => {
  const normalize = (value: string) => value.replace('#', '').trim();
  const fromHex = normalize(from);
  const toHex = normalize(to);
  if (fromHex.length !== 6 || toHex.length !== 6) {
    return from;
  }
  const fromNum = parseInt(fromHex, 16);
  const toNum = parseInt(toHex, 16);
  if (Number.isNaN(fromNum) || Number.isNaN(toNum)) {
    return from;
  }
  const clamp = (value: number) => Math.min(255, Math.max(0, value));
  const fromRgb = [(fromNum >> 16) & 0xff, (fromNum >> 8) & 0xff, fromNum & 0xff];
  const toRgb = [(toNum >> 16) & 0xff, (toNum >> 8) & 0xff, toNum & 0xff];
  const blended = fromRgb.map((channel, index) => clamp(Math.round(channel + (toRgb[index] - channel) * ratio)));
  return `#${blended.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
};

const toPreviewDisplay = (rawPreview: string, invalidMessage: string): PreviewDisplay => {
  const emptyTokens: PreviewToken[] = [];
  let parsed: TurnPlanPreviewResponse;
  try {
    parsed = JSON.parse(rawPreview) as TurnPlanPreviewResponse;
  } catch {
    return {
      message: 'Preview unavailable.',
      tokens: emptyTokens,
    };
  }

  if (!parsed.isValid) {
    return {
      message: parsed.validationMessage || invalidMessage,
      tokens: emptyTokens,
    };
  }

  const nextPieceId = isPieceId(parsed.nextPlayerPieceId) ? parsed.nextPlayerPieceId : null;
  const nextText = nextPieceId ? pieceConfig[nextPieceId].label : parsed.nextPlayerPieceId || '??';
  const winnerPieceId = isPieceId(parsed.winnerPieceId) ? parsed.winnerPieceId : null;
  const winnerText = winnerPieceId
    ? pieceConfig[winnerPieceId].label
    : parsed.winnerPieceId || (nextPieceId ? pieceConfig[nextPieceId].label : '??');
  const tokens: PreviewToken[] = parsed.hasWinner
    ? [{ kind: 'winner', winnerPieceId, winnerText }]
    : [{ kind: 'text', text: `Next:${nextText}`, colorPieceId: nextPieceId }];

  if (parsed.attackers.length > 0) {
    const attackerLabels = parsed.attackers.map((pieceId) =>
      isPieceId(pieceId) ? pieceConfig[pieceId].label : pieceId,
    );
    tokens.push({ kind: 'text', text: `Atk:${attackerLabels.join(',')}`, colorPieceId: null });
  }

  if (parsed.currentPlayerLoots) {
    tokens.push({ kind: 'text', text: 'Loot', colorPieceId: null });
  }

  parsed.movedStrangers.forEach((entry) => {
    const pieceId = isPieceId(entry.pieceId) ? entry.pieceId : null;
    const pieceText = pieceId ? pieceConfig[pieceId].label : entry.pieceId;
    const roomText = Number.isFinite(entry.roomId) ? entry.roomId : '?';
    const colorPieceId = pieceId === 'stranger1' || pieceId === 'stranger2' ? pieceId : null;
    tokens.push({ kind: 'text', text: `${pieceText}:R${roomText}`, colorPieceId });
  });

  const doctorRoomText = Number.isFinite(parsed.doctorRoomId) ? parsed.doctorRoomId : '?';
  tokens.push({ kind: 'text', text: `Dr:R${doctorRoomText}`, colorPieceId: null });

  return {
    message: null,
    tokens,
  };
};

const formatElapsedTime = (elapsedMs: number) => {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return '0ms';
  }
  if (elapsedMs < 1000) {
    return `${Math.round(elapsedMs)}ms`;
  }
  return `${(elapsedMs / 1000).toFixed(2)}s`;
};

const formatWholeSeconds = (elapsedMs: number) => {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return '0s';
  }
  return `${Math.floor(elapsedMs / 1000)}s`;
};

const isTerminalHeuristicScore = (score: number) => Number.isFinite(score) && Math.abs(score) > 1e12;

const formatSuggestedTurnText = (bestTurn: BestTurnResponse) => {
  if (bestTurn.suggestedTurn.length > 0) {
    return bestTurn.suggestedTurn.map((entry) => `${pieceConfig[entry.pieceId].label}@R${entry.roomId}`).join(', ');
  }

  const normalized = bestTurn.suggestedTurnText
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (normalized.length > 0) {
    return normalized.join(', ');
  }
  return '(none)';
};

const formatSuggestedTurnTextForBoard = (bestTurn: BestTurnResponse) => {
  if (bestTurn.suggestedTurn.length > 0) {
    return bestTurn.suggestedTurn.map((entry) => `${pieceConfig[entry.pieceId].label}@${entry.roomId}`).join(', ');
  }
  return null;
};

const formatHeuristicScore = (score: number) => {
  if (!Number.isFinite(score)) {
    return '?';
  }
  if (Math.abs(score) > 1e12) {
    return score > 0 ? 'WIN' : 'LOSE';
  }
  return `${score >= 0 ? '+' : ''}${score.toFixed(2)}`;
};

const formatPlayerStatDecimal = (value: number) => (Number.isFinite(value) ? value.toFixed(1) : '?');

const formatPlayerInteger = (value: number) => (Number.isFinite(value) ? Math.trunc(value).toString() : '?');

function PlayArea() {
  const [gameState] = useState<GameStateHandle | null>(() => {
    try {
      const freshState = newDefaultGameState();
      loadGameStateSnapshot(freshState);
      const setupFromGame = parseSetupPrefsJson(freshState.currentNormalSetupJson(), fallbackSetupPrefs);
      saveSetupPrefs(setupFromGame);
      return freshState;
    } catch {
      return null;
    }
  });
  const defaultSetupPrefs = gameState
    ? parseSetupPrefsJson(gameState.defaultNormalSetupJson(), fallbackSetupPrefs)
    : fallbackSetupPrefs;
  const currentSetupPrefs = gameState
    ? parseSetupPrefsJson(gameState.currentNormalSetupJson(), defaultSetupPrefs)
    : defaultSetupPrefs;
  const [selectedPieceId, setSelectedPieceId] = useState<PieceId | null>(null);
  const [plannedMoves, setPlannedMoves] = useState<Partial<Record<PieceId, number>>>({});
  const [planOrder, setPlanOrder] = useState<PieceId[]>([]);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [infoPopup, setInfoPopup] = useState<InfoPopupKind | null>(null);
  const [setupPopupOpen, setSetupPopupOpen] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupPrefsDraft, setSetupPrefsDraft] = useState<SetupPrefsDraft>(() =>
    toSetupPrefsDraft(loadSetupPrefs(currentSetupPrefs)),
  );
  const [redoStateStack, setRedoStateStack] = useState<string[]>(() => (gameState ? loadRedoStateStack() : []));
  const [turnCounter, setTurnCounter] = useState(0);
  const turnCounterRef = useRef(turnCounter);
  turnCounterRef.current = turnCounter;
  const initialAutoAnalysisQueuedRef = useRef(false);
  const [minAnalysisLevelDraft, setMinAnalysisLevelDraft] = useState(() => loadAiPrefs().minAnalysisLevel.toString());
  const [maxAnalysisLevelDraft, setMaxAnalysisLevelDraft] = useState(() => loadAiPrefs().maxAnalysisLevel.toString());
  const [analysisMaxTimeIndex, setAnalysisMaxTimeIndex] = useState(() => loadAiPrefs().analysisMaxTimeIndex);
  const [aiControlP1, setAiControlP1] = useState(() => loadAiPrefs().controlP1);
  const [aiControlP3, setAiControlP3] = useState(() => loadAiPrefs().controlP3);
  const [aiShowOnBoardP1, setAiShowOnBoardP1] = useState(() => loadAiPrefs().showOnBoardP1);
  const [aiShowOnBoardP3, setAiShowOnBoardP3] = useState(() => loadAiPrefs().showOnBoardP3);
  const aiControlP1Ref = useRef(aiControlP1);
  aiControlP1Ref.current = aiControlP1;
  const aiControlP3Ref = useRef(aiControlP3);
  aiControlP3Ref.current = aiControlP3;
  const aiShowOnBoardP1Ref = useRef(aiShowOnBoardP1);
  aiShowOnBoardP1Ref.current = aiShowOnBoardP1;
  const aiShowOnBoardP3Ref = useRef(aiShowOnBoardP3);
  aiShowOnBoardP3Ref.current = aiShowOnBoardP3;
  const [analysisIsRunning, setAnalysisIsRunning] = useState(false);
  const [analysisRunningLevel, setAnalysisRunningLevel] = useState<number | null>(null);
  const analysisRunningLevelRef = useRef<number | null>(analysisRunningLevel);
  analysisRunningLevelRef.current = analysisRunningLevel;
  const [analysisElapsedMs, setAnalysisElapsedMs] = useState(0);
  const [analysisCurrentLevelElapsedMs, setAnalysisCurrentLevelElapsedMs] = useState(0);
  const [analysisStatusMessage, setAnalysisStatusMessage] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const aiResultsCacheRef = useRef<AiResultsCacheStore>(loadAiResultsCacheStore());
  const analysisTimerRef = useRef<number | null>(null);
  const analysisDeadlineTimerRef = useRef<number | null>(null);
  const analysisTimingRef = useRef<{ runStartMs: number; levelStartMs: number } | null>(null);
  const analysisWorkerRef = useRef<Worker | null>(null);
  const analysisRunIdRef = useRef(0);
  const [animationEnabled, setAnimationEnabled] = useState(() => loadAnimationPrefs().animationEnabled);
  const [animationSpeedIndex, setAnimationSpeedIndex] = useState(() => loadAnimationPrefs().animationSpeedIndex);
  const [actionOverlay, setActionOverlay] = useState<string | null>(null);
  const [actionHighlightPieceId, setActionHighlightPieceId] = useState<PieceId | null>(null);
  const [animatedPieces, setAnimatedPieces] = useState<Array<{
    pieceId: PieceId;
    roomId: number;
    x: number;
    y: number;
    size: number;
  }> | null>(null);
  const animationRef = useRef<{
    segments: Array<{
      from: Array<{ pieceId: PieceId; roomId: number; x: number; y: number; size: number }>;
      to: Array<{ pieceId: PieceId; roomId: number; x: number; y: number; size: number }>;
      actionText: string | null;
      highlightPieceId: PieceId | null;
    }>;
    segmentIndex: number;
    startTime: number;
    durationMs: number;
    speed: number;
    rafId: number | null;
  } | null>(null);
  const queuedAutoSubmitRef = useRef<{
    moves: Partial<Record<PieceId, number>>;
    order: PieceId[];
    sourceTurnCounter: number;
  } | null>(null);
  const pendingEmptyRoomTouchTapRef = useRef<PendingEmptyRoomTouchTap | null>(null);
  const animationSpeed = animationSpeeds[animationSpeedIndex];
  const summary = gameState ? gameState.summary(0) : 'Failed to create game state.';
  const prevTurnSummary = gameState ? gameState.prevTurnSummaryVerbose() : '';
  const history = gameState ? gameState.normalTurnHistory() : '';
  const currentPlayerPieceId = gameState ? (gameState.currentPlayerPieceId() as PieceId) : null;
  const currentNormalTurnCount = gameState
    ? (parseNormalTurnCountFromSnapshotJson(gameState.exportStateJson()) ?? 1)
    : 1;
  const highestRememberedUndoneTurnCount = redoStateStack.reduce((highest, snapshot) => {
    const snapshotNormalTurnCount = parseNormalTurnCountFromSnapshotJson(snapshot);
    return snapshotNormalTurnCount === null ? highest : Math.max(highest, snapshotNormalTurnCount);
  }, currentNormalTurnCount);
  const currentTurnCountText =
    highestRememberedUndoneTurnCount === currentNormalTurnCount
      ? `${currentNormalTurnCount}`
      : `${currentNormalTurnCount}/${highestRememberedUndoneTurnCount}`;
  const currentTurnTitleText = `Turn ${currentTurnCountText}: ${currentPlayerPieceId ? pieceConfig[currentPlayerPieceId].label : '??'}`;
  const hasWinner = gameState ? gameState.hasWinner() : false;
  const canUndo = history.trim().length > 0;
  const canRedo = redoStateStack.length > 0;
  const canCancelTurnPlan = selectedPieceId !== null || planOrder.length > 0 || validationMessage !== null;
  const winnerPieceIdRaw = gameState ? gameState.winnerPieceId() : '';
  const winnerPieceId =
    winnerPieceIdRaw === 'player1' || winnerPieceIdRaw === 'player2' ? (winnerPieceIdRaw as PieceId) : null;
  const winnerOverlayText = winnerPieceId ? `${pieceConfig[winnerPieceId].label} won!` : null;
  const winnerTurnTitleText = winnerPieceId
    ? `Turn ${currentNormalTurnCount}: ${pieceConfig[winnerPieceId].label} won!`
    : null;
  const saveCurrentAiPrefs = (overrides?: Partial<AiPrefs>) => {
    const fallbackAiPrefs = loadAiPrefs();
    saveAiPrefs({
      minAnalysisLevel: parseMinAnalysisLevelDraft(minAnalysisLevelDraft) ?? fallbackAiPrefs.minAnalysisLevel,
      maxAnalysisLevel: parseMaxAnalysisLevelDraft(maxAnalysisLevelDraft) ?? fallbackAiPrefs.maxAnalysisLevel,
      analysisMaxTimeIndex,
      controlP1: aiControlP1Ref.current,
      controlP3: aiControlP3Ref.current,
      showOnBoardP1: aiShowOnBoardP1Ref.current,
      showOnBoardP3: aiShowOnBoardP3Ref.current,
      ...overrides,
    });
  };
  const updateAiControlPrefs = (nextControlP1: boolean, nextControlP3: boolean) => {
    aiControlP1Ref.current = nextControlP1;
    aiControlP3Ref.current = nextControlP3;
    setAiControlP1(nextControlP1);
    setAiControlP3(nextControlP3);
    saveCurrentAiPrefs({
      controlP1: nextControlP1,
      controlP3: nextControlP3,
    });
  };
  const updateAiShowOnBoardPrefs = (nextShowOnBoardP1: boolean, nextShowOnBoardP3: boolean) => {
    aiShowOnBoardP1Ref.current = nextShowOnBoardP1;
    aiShowOnBoardP3Ref.current = nextShowOnBoardP3;
    setAiShowOnBoardP1(nextShowOnBoardP1);
    setAiShowOnBoardP3(nextShowOnBoardP3);
    saveCurrentAiPrefs({
      showOnBoardP1: nextShowOnBoardP1,
      showOnBoardP3: nextShowOnBoardP3,
    });
  };
  const findAiResultsCacheEntry = (stateJson: string) =>
    aiResultsCacheRef.current.entries.find((entry) => entry.stateJson === stateJson) ?? null;
  const toAiSuggestionFromCacheEntry = (entry: AiResultsCacheEntry, sourceTurnCounter: number): AiSuggestion => ({
    sourceTurnCounter,
    analysisLevel: entry.analysisLevel,
    bestTurn: entry.bestTurn,
    previewRaw: entry.previewRaw,
    elapsedMs: entry.elapsedMs,
    levelElapsedMs: entry.levelElapsedMs,
  });
  const touchAiResultsCacheEntry = (entry: AiResultsCacheEntry, touchedAtMs: number) => {
    const nextEntry: AiResultsCacheEntry = {
      ...entry,
      lastUsedAtMs: touchedAtMs,
    };
    const otherEntries = aiResultsCacheRef.current.entries.filter(
      (candidate) => candidate.stateJson !== entry.stateJson,
    );
    aiResultsCacheRef.current = saveAiResultsCacheStore({
      version: 1,
      entries: [...otherEntries, nextEntry],
    });
    return nextEntry;
  };
  const upsertAiResultsCacheFromSuggestion = (stateJson: string, suggestion: AiSuggestion, touchedAtMs: number) => {
    const nextEntry: AiResultsCacheEntry = {
      stateJson,
      analysisLevel: suggestion.analysisLevel,
      bestTurn: suggestion.bestTurn,
      previewRaw: suggestion.previewRaw,
      elapsedMs: suggestion.elapsedMs,
      levelElapsedMs: suggestion.levelElapsedMs,
      lastUsedAtMs: touchedAtMs,
    };
    const otherEntries = aiResultsCacheRef.current.entries.filter((entry) => entry.stateJson !== stateJson);
    aiResultsCacheRef.current = saveAiResultsCacheStore({
      version: 1,
      entries: [...otherEntries, nextEntry],
    });
  };
  const handleClearAiResultsCache = () => {
    aiResultsCacheRef.current = clearAiResultsCacheStore();
    setAnalysisStatusMessage('AI cache cleared.');
  };
  const pieceRooms = gameState ? gameState.piecePositions() : null;
  const pieceRoomMap = (() => {
    const map = new Map<PieceId, number>();
    if (!pieceRooms) {
      return map;
    }
    pieceOrder.forEach((pieceId, index) => {
      if (pieceRooms.length > index) {
        map.set(pieceId, pieceRooms[index]);
      }
    });
    return map;
  })();
  const playerStatsRows = (() => {
    if (!gameState) {
      return [] as PlayerStatsRow[];
    }
    let parsedRows: PlayerStatsResponseRow[];
    try {
      parsedRows = JSON.parse(gameState.playerStatsJson()) as PlayerStatsResponseRow[];
    } catch {
      return [] as PlayerStatsRow[];
    }
    return parsedRows
      .map((row) => {
        if (!isPieceId(row.pieceId) || row.pieceId === 'doctor') {
          return null;
        }
        return {
          pieceId: row.pieceId,
          doctorDistance: row.doctorDistance,
          strength: row.strength,
          moveCards: row.moveCards,
          weaponCards: row.weaponCards,
          failureCards: row.failureCards,
          equivalentClovers: row.equivalentClovers,
        };
      })
      .filter((row): row is PlayerStatsRow => row !== null)
      .sort((a, b) => playerStatsRowOrder.indexOf(a.pieceId) - playerStatsRowOrder.indexOf(b.pieceId));
  })();
  const plannedEntries = pieceOrder
    .map((pieceId) => {
      const roomId = plannedMoves[pieceId];
      if (roomId === undefined) {
        return null;
      }
      return { pieceId, roomId };
    })
    .filter((entry): entry is TurnPlanEntry => entry !== null);
  const renderPieces = (() => {
    type RenderToken = {
      pieceId: PieceId;
      roomId: number;
      kind: 'actual' | 'ghost';
      x: number;
      y: number;
      size: number;
    };
    const roomTokens = new Map<number, Array<Omit<RenderToken, 'x' | 'y' | 'size'>>>();

    pieceOrder.forEach((pieceId) => {
      const roomId = pieceRoomMap.get(pieceId);
      if (roomId === undefined) {
        return;
      }
      const list = roomTokens.get(roomId) ?? [];
      list.push({ pieceId, roomId, kind: 'actual' });
      roomTokens.set(roomId, list);
    });

    plannedEntries.forEach((entry) => {
      const list = roomTokens.get(entry.roomId) ?? [];
      list.push({ pieceId: entry.pieceId, roomId: entry.roomId, kind: 'ghost' });
      roomTokens.set(entry.roomId, list);
    });

    const tokens: RenderToken[] = [];
    roomTokens.forEach((entries, roomId) => {
      const room = boardRoomById.get(roomId);
      if (!room) {
        return;
      }
      const orderedEntries = entries.slice().sort((a, b) => {
        const aIndex = pieceOrder.indexOf(a.pieceId);
        const bIndex = pieceOrder.indexOf(b.pieceId);
        if (aIndex !== bIndex) {
          return aIndex - bIndex;
        }
        if (a.kind === b.kind) {
          return 0;
        }
        return a.kind === 'actual' ? -1 : 1;
      });

      const roomRect = getRoomRect(room.coords);
      const { size, positions } = getPiecePositionsInRoom(orderedEntries.length, roomRect);
      orderedEntries.forEach((entry, index) => {
        const placement = positions[index];
        if (!placement) {
          return;
        }
        tokens.push({ ...entry, x: placement.x, y: placement.y, size });
      });
    });

    return tokens;
  })();
  const animatedPieceList = animatedPieces ?? [];

  const isPieceSelectable = (pieceId: PieceId) =>
    !hasWinner &&
    currentPlayerPieceId !== null &&
    (pieceId === currentPlayerPieceId || pieceId === 'stranger1' || pieceId === 'stranger2');

  const alliedStranger =
    currentPlayerPieceId === 'player1' ? 'stranger2' : currentPlayerPieceId === 'player2' ? 'stranger1' : null;
  const opposingStranger =
    currentPlayerPieceId === 'player1' ? 'stranger1' : currentPlayerPieceId === 'player2' ? 'stranger2' : null;

  const getPreferredSelectablePieceInRoom = (roomId: number) => {
    const preference: Array<PieceId | null> = [currentPlayerPieceId, alliedStranger, opposingStranger];
    for (const pieceId of preference) {
      if (!pieceId) {
        continue;
      }
      if (!isPieceSelectable(pieceId)) {
        continue;
      }
      if (pieceRoomMap.get(pieceId) === roomId) {
        return pieceId;
      }
    }
    return null;
  };

  const clearPendingEmptyRoomTouchTap = () => {
    pendingEmptyRoomTouchTapRef.current = null;
  };

  const isTouchLikeRoomClick = (event?: MouseEvent<SVGRectElement>) => {
    const nativeEvent = event?.nativeEvent as
      | (globalThis.MouseEvent & {
          pointerType?: string;
          sourceCapabilities?: { firesTouchEvents?: boolean };
        })
      | undefined;
    if (!nativeEvent) {
      return false;
    }
    if (nativeEvent.pointerType === 'touch') {
      return true;
    }
    if (nativeEvent.sourceCapabilities?.firesTouchEvents) {
      return true;
    }
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
      return true;
    }
    return false;
  };

  const rememberForgivingTouchTap = (roomId: number, event?: MouseEvent<SVGRectElement>) => {
    if (!isTouchLikeRoomClick(event)) {
      clearPendingEmptyRoomTouchTap();
      return;
    }
    pendingEmptyRoomTouchTapRef.current = {
      roomId,
      startedAtMs: Date.now(),
      turnCounterAtTap: turnCounterRef.current,
    };
  };

  // Intentionally timer-free: no delayed callbacks means fewer places that must remember to cancel state.
  const tryConsumeForgivingTouchDoubleTap = (roomId: number, event?: MouseEvent<SVGRectElement>) => {
    if (!isTouchLikeRoomClick(event)) {
      clearPendingEmptyRoomTouchTap();
      return false;
    }

    const pendingTouchTap = pendingEmptyRoomTouchTapRef.current;
    if (
      pendingTouchTap &&
      pendingTouchTap.roomId === roomId &&
      pendingTouchTap.turnCounterAtTap === turnCounterRef.current &&
      Date.now() - pendingTouchTap.startedAtMs <= touchDoubleTapGraceMs
    ) {
      clearPendingEmptyRoomTouchTap();
      if (selectedPieceId) {
        setSelectedPieceId(null);
      }
      submitCurrentPlayerMoveToRoom(roomId);
      return true;
    }

    return false;
  };

  const submitCurrentPlayerMoveToRoom = (roomId: number) => {
    if (!currentPlayerPieceId) {
      setValidationMessage('No current player available.');
      return;
    }
    if (pieceRoomMap.get(currentPlayerPieceId) === roomId) {
      setValidationMessage(null);
      return;
    }
    const nextMoves = { ...plannedMoves, [currentPlayerPieceId]: roomId };
    const nextOrder = planOrder.includes(currentPlayerPieceId) ? planOrder : [...planOrder, currentPlayerPieceId];
    submitPlan(nextMoves, nextOrder);
  };

  const clearPlannedMoveForPiece = (pieceId: PieceId) => {
    setPlannedMoves((prev) => {
      if (prev[pieceId] === undefined) {
        return prev;
      }
      const { [pieceId]: _removed, ...remainingMoves } = prev;
      return remainingMoves;
    });
    setPlanOrder((prev) => (prev.includes(pieceId) ? prev.filter((id) => id !== pieceId) : prev));
  };

  const handlePieceClick = (pieceId: PieceId) => {
    clearPendingEmptyRoomTouchTap();
    if (hasWinner) {
      return;
    }
    if (selectedPieceId === pieceId) {
      setSelectedPieceId(null);
      setValidationMessage(null);
      return;
    }
    if (!isPieceSelectable(pieceId)) {
      setValidationMessage('You can only move your own piece or a stranger.');
      return;
    }
    setSelectedPieceId(pieceId);
    setValidationMessage(null);
  };

  const handleRoomClick = (roomId: number, event?: MouseEvent<SVGRectElement>) => {
    if (hasWinner) {
      return;
    }
    if (tryConsumeForgivingTouchDoubleTap(roomId, event)) {
      return;
    }
    if (event?.detail && event.detail > 1 && !selectedPieceId && !isTouchLikeRoomClick(event)) {
      return;
    }
    if (!selectedPieceId) {
      const preferredPiece = getPreferredSelectablePieceInRoom(roomId);
      if (preferredPiece) {
        rememberForgivingTouchTap(roomId, event);
        setSelectedPieceId(preferredPiece);
        setValidationMessage(null);
        return;
      }
      if (isTouchLikeRoomClick(event)) {
        rememberForgivingTouchTap(roomId, event);
        return;
      }
      clearPendingEmptyRoomTouchTap();
      setValidationMessage('Select a piece, then choose a destination room.');
      return;
    }
    clearPendingEmptyRoomTouchTap();
    if (pieceRoomMap.get(selectedPieceId) === roomId) {
      const plannedRoomId = plannedMoves[selectedPieceId];
      if (plannedRoomId !== undefined && plannedRoomId !== roomId) {
        clearPlannedMoveForPiece(selectedPieceId);
      }
      setSelectedPieceId(null);
      setValidationMessage(null);
      return;
    }
    setPlannedMoves((prev) => ({ ...prev, [selectedPieceId]: roomId }));
    setPlanOrder((prev) => (prev.includes(selectedPieceId) ? prev : [...prev, selectedPieceId]));
    setSelectedPieceId(null);
    setValidationMessage(null);
  };

  const stopAnalysisTimer = () => {
    const timerId = analysisTimerRef.current;
    if (timerId !== null) {
      window.clearInterval(timerId);
      analysisTimerRef.current = null;
    }
    const deadlineTimerId = analysisDeadlineTimerRef.current;
    if (deadlineTimerId !== null) {
      window.clearTimeout(deadlineTimerId);
      analysisDeadlineTimerRef.current = null;
    }
    analysisTimingRef.current = null;
  };

  const stopAnalysisWorker = () => {
    if (!analysisWorkerRef.current) {
      return;
    }
    analysisWorkerRef.current.terminate();
    analysisWorkerRef.current = null;
  };

  const stopAnalysisRun = (
    statusMessage: string | null,
    options?: {
      terminateWorker?: boolean;
    },
  ) => {
    stopAnalysisTimer();
    if (options?.terminateWorker ?? true) {
      stopAnalysisWorker();
    }
    setAnalysisIsRunning(false);
    analysisRunningLevelRef.current = null;
    setAnalysisRunningLevel(null);
    setAnalysisCurrentLevelElapsedMs(0);
    setAnalysisStatusMessage(statusMessage);
  };

  const resetAiOutputs = () => {
    setAiSuggestion(null);
    analysisRunningLevelRef.current = null;
    setAnalysisRunningLevel(null);
    setAnalysisElapsedMs(0);
    setAnalysisCurrentLevelElapsedMs(0);
    setAnalysisStatusMessage(null);
  };

  const submitPlan = (
    moves: Partial<Record<PieceId, number>>,
    order: PieceId[],
    options?: {
      animateFromCurrentState?: boolean;
    },
  ) => {
    if (!gameState || gameState.hasWinner()) {
      return;
    }
    const initialRoomsForAnimation = options?.animateFromCurrentState
      ? Array.from(gameState.piecePositions(), (value) => Number(value))
      : null;
    const planEntries = order
      .map((pieceId) => {
        const roomId = moves[pieceId];
        if (roomId === undefined) {
          return null;
        }
        return { pieceId, roomId };
      })
      .filter((entry): entry is TurnPlanEntry => entry !== null);
    const validation = gameState.validateTurnPlan(JSON.stringify(planEntries));
    if (validation) {
      setPlannedMoves(moves);
      setPlanOrder(order);
      setValidationMessage(validation);
      return;
    }
    const applyError = gameState.applyTurnPlan(JSON.stringify(planEntries));
    if (applyError) {
      setPlannedMoves(moves);
      setPlanOrder(order);
      setValidationMessage(applyError);
      return;
    }
    setPlannedMoves({});
    setPlanOrder([]);
    setSelectedPieceId(null);
    setValidationMessage(null);
    if (analysisIsRunning) {
      analysisRunIdRef.current += 1;
      stopAnalysisRun('Analysis stopped because the position changed.');
    }
    resetAiOutputs();
    setRedoStateStack([]);
    saveRedoStateStack([]);
    saveGameStateSnapshot(gameState);
    const nextTurnCounter = advanceTurnCounter();
    startAnimationFromState(initialRoomsForAnimation);
    if (!gameState.hasWinner()) {
      startBestTurnAnalysis(false, nextTurnCounter);
    }
  };
  const handleSubmit = () => {
    if (!gameState || hasWinner) {
      return;
    }
    submitPlan(plannedMoves, planOrder);
  };

  const entriesToMovesAndOrder = (entries: TurnPlanEntry[]) => {
    const moves: Partial<Record<PieceId, number>> = {};
    const order: PieceId[] = [];
    entries.forEach((entry) => {
      moves[entry.pieceId] = entry.roomId;
      order.push(entry.pieceId);
    });
    return { moves, order };
  };

  const advanceTurnCounter = () => {
    const nextTurnCounter = turnCounterRef.current + 1;
    turnCounterRef.current = nextTurnCounter;
    setTurnCounter(nextTurnCounter);
    return nextTurnCounter;
  };

  const startBestTurnAnalysis = (autoSubmit: boolean, sourceTurnCounterOverride?: number) => {
    if (!gameState) {
      setAnalysisStatusMessage('Analysis unavailable.');
      return;
    }
    if (gameState.hasWinner()) {
      setAnalysisStatusMessage('Game already has a winner.');
      return;
    }

    const parsedMinLevel = Number(minAnalysisLevelDraft);
    if (!Number.isFinite(parsedMinLevel) || parsedMinLevel < 0) {
      setAnalysisStatusMessage('Min turn depth must be a number >= 0.');
      return;
    }
    const parsedMaxLevel = Number(maxAnalysisLevelDraft);
    if (!Number.isFinite(parsedMaxLevel) || parsedMaxLevel < 0) {
      setAnalysisStatusMessage('Max turn depth must be a number >= 0.');
      return;
    }

    const minAnalysisLevel = Math.trunc(parsedMinLevel);
    const maxAnalysisLevel = Math.trunc(parsedMaxLevel);
    const effectiveMaxAnalysisLevel = minAnalysisLevel <= maxAnalysisLevel ? maxAnalysisLevel : null;
    setMinAnalysisLevelDraft(minAnalysisLevel.toString());
    setMaxAnalysisLevelDraft(maxAnalysisLevel.toString());
    saveCurrentAiPrefs({
      minAnalysisLevel,
      maxAnalysisLevel,
      analysisMaxTimeIndex,
    });
    const maxTimeOption = analysisMaxTimeOptions[analysisMaxTimeIndex] ?? analysisMaxTimeOptions[0];
    const maxTimeMs = maxTimeOption.ms;
    analysisRunIdRef.current += 1;
    const runId = analysisRunIdRef.current;
    const sourceTurnCounter = sourceTurnCounterOverride ?? turnCounterRef.current;
    const sourceStateJson = gameState.exportStateJson();
    const sourceCurrentPlayerPieceIdRaw = gameState.currentPlayerPieceId();
    const sourceCurrentPlayerPieceId = isPieceId(sourceCurrentPlayerPieceIdRaw) ? sourceCurrentPlayerPieceIdRaw : null;
    const shouldAutoSubmitAtThisMoment = () => {
      if (autoSubmit) {
        return true;
      }
      if (sourceCurrentPlayerPieceId === 'player1') {
        return aiControlP1Ref.current;
      }
      if (sourceCurrentPlayerPieceId === 'player2') {
        return aiControlP3Ref.current;
      }
      return false;
    };
    const cachedEntry = findAiResultsCacheEntry(sourceStateJson);
    const cachedSuggestion = cachedEntry
      ? toAiSuggestionFromCacheEntry(touchAiResultsCacheEntry(cachedEntry, Date.now()), sourceTurnCounter)
      : null;
    const initialAnalysisLevel = cachedSuggestion
      ? Math.max(minAnalysisLevel, cachedSuggestion.analysisLevel + 1)
      : minAnalysisLevel;

    stopAnalysisTimer();
    if (analysisIsRunning) {
      stopAnalysisWorker();
    }

    if (
      effectiveMaxAnalysisLevel !== null &&
      cachedSuggestion &&
      cachedSuggestion.analysisLevel >= effectiveMaxAnalysisLevel
    ) {
      setAiSuggestion(cachedSuggestion);
      setAnalysisIsRunning(false);
      analysisRunningLevelRef.current = null;
      setAnalysisRunningLevel(null);
      setAnalysisCurrentLevelElapsedMs(0);
      setAnalysisElapsedMs(cachedSuggestion.elapsedMs);
      const cacheStopPrefix = `Max turn depth reached from cache at L${cachedSuggestion.analysisLevel}.`;
      if (!shouldAutoSubmitAtThisMoment()) {
        setAnalysisStatusMessage(cacheStopPrefix);
        return;
      }
      if (sourceTurnCounter !== turnCounterRef.current) {
        setAnalysisStatusMessage(`${cacheStopPrefix} Auto-submit skipped because the position changed.`);
        return;
      }
      const planned = entriesToMovesAndOrder(cachedSuggestion.bestTurn.suggestedTurn);
      if (animationRef.current) {
        queuedAutoSubmitRef.current = {
          moves: planned.moves,
          order: planned.order,
          sourceTurnCounter,
        };
        setAnalysisStatusMessage(`${cacheStopPrefix} Suggested turn queued.`);
        return;
      }
      setAnalysisStatusMessage(`${cacheStopPrefix} Suggested turn submitted.`);
      submitPlan(planned.moves, planned.order, { animateFromCurrentState: true });
      return;
    }

    setAiSuggestion(cachedSuggestion);
    setAnalysisIsRunning(true);
    analysisRunningLevelRef.current = initialAnalysisLevel;
    setAnalysisRunningLevel(initialAnalysisLevel);
    setAnalysisCurrentLevelElapsedMs(0);
    setAnalysisStatusMessage(shouldAutoSubmitAtThisMoment() ? 'Analyzing and auto-submitting...' : 'Analyzing...');
    setAnalysisElapsedMs(0);

    const timerStart = performance.now();
    analysisTimingRef.current = {
      runStartMs: timerStart,
      levelStartMs: timerStart,
    };
    analysisTimerRef.current = window.setInterval(() => {
      const timing = analysisTimingRef.current;
      if (!timing) {
        return;
      }
      const now = performance.now();
      setAnalysisElapsedMs(Math.max(0, now - timing.runStartMs));
      setAnalysisCurrentLevelElapsedMs(Math.max(0, now - timing.levelStartMs));
    }, 100);

    let worker = analysisWorkerRef.current;
    if (!worker) {
      try {
        worker = new Worker(new URL('../workers/treeSearchWorker.ts', import.meta.url), { type: 'module' });
      } catch {
        stopAnalysisRun('Failed to start analysis worker.');
        return;
      }
      analysisWorkerRef.current = worker;
    }

    let currentLevel = initialAnalysisLevel;
    let deepestCompletedSuggestion: AiSuggestion | null = cachedSuggestion;
    let mostRecentCompletedLevelElapsedMs: number | null = cachedSuggestion ? cachedSuggestion.levelElapsedMs : null;
    let timeLimitReached = false;

    const completeAndMaybeSubmit = (
      completionMessage: string,
      options?: {
        terminateWorker?: boolean;
      },
    ) => {
      const terminateWorker = options?.terminateWorker ?? false;
      if (!shouldAutoSubmitAtThisMoment()) {
        stopAnalysisRun(completionMessage, { terminateWorker });
        return;
      }
      if (!deepestCompletedSuggestion) {
        stopAnalysisRun(`${completionMessage} No suggested turn found.`, { terminateWorker });
        return;
      }
      if (sourceTurnCounter !== turnCounterRef.current) {
        stopAnalysisRun(`${completionMessage} Auto-submit skipped because the position changed.`, {
          terminateWorker,
        });
        return;
      }

      const planned = entriesToMovesAndOrder(deepestCompletedSuggestion.bestTurn.suggestedTurn);
      if (animationRef.current) {
        queuedAutoSubmitRef.current = {
          moves: planned.moves,
          order: planned.order,
          sourceTurnCounter,
        };
        stopAnalysisRun(`${completionMessage} Suggested turn queued.`, { terminateWorker });
        return;
      }
      stopAnalysisRun(`${completionMessage} Suggested turn submitted.`, { terminateWorker });
      submitPlan(planned.moves, planned.order, { animateFromCurrentState: true });
    };

    const requestCurrentLevel = () => {
      if (runId !== analysisRunIdRef.current) {
        return;
      }
      if (effectiveMaxAnalysisLevel !== null && currentLevel > effectiveMaxAnalysisLevel) {
        const deepestCompletedLevel = deepestCompletedSuggestion?.analysisLevel ?? effectiveMaxAnalysisLevel;
        completeAndMaybeSubmit(`Max turn depth reached at L${deepestCompletedLevel}.`, { terminateWorker: true });
        return;
      }
      const now = performance.now();
      const elapsedMs = Math.max(0, now - timerStart);
      setAnalysisElapsedMs(elapsedMs);
      if (timeLimitReached) {
        const levelAtTimeout = analysisRunningLevelRef.current ?? currentLevel;
        completeAndMaybeSubmit(`Time limit during L${levelAtTimeout}.`, { terminateWorker: true });
        return;
      }
      if (currentLevel > minAnalysisLevel && elapsedMs >= maxTimeMs) {
        const levelAtTimeout = analysisRunningLevelRef.current ?? currentLevel;
        completeAndMaybeSubmit(`Time limit during L${levelAtTimeout}.`, { terminateWorker: true });
        return;
      }
      if (currentLevel > minAnalysisLevel && mostRecentCompletedLevelElapsedMs !== null) {
        const remainingMs = Math.max(0, maxTimeMs - elapsedMs);
        if (remainingMs < mostRecentCompletedLevelElapsedMs) {
          const deepestCompletedLevel = deepestCompletedSuggestion?.analysisLevel ?? currentLevel - 1;
          completeAndMaybeSubmit(`smart stop at L${deepestCompletedLevel}`, { terminateWorker: true });
          return;
        }
      }
      analysisTimingRef.current = {
        runStartMs: timerStart,
        levelStartMs: now,
      };
      setAnalysisCurrentLevelElapsedMs(0);
      analysisRunningLevelRef.current = currentLevel;
      setAnalysisRunningLevel(currentLevel);
      const request: TreeSearchWorkerRequest = {
        type: 'analyze',
        runId,
        stateJson: sourceStateJson,
        analysisLevel: currentLevel,
      };
      worker.postMessage(request);
    };

    analysisDeadlineTimerRef.current = window.setTimeout(() => {
      if (runId !== analysisRunIdRef.current) {
        return;
      }
      timeLimitReached = true;
      const levelAtTimeout = analysisRunningLevelRef.current ?? currentLevel;
      if (levelAtTimeout <= minAnalysisLevel) {
        return;
      }
      analysisRunIdRef.current += 1;
      completeAndMaybeSubmit(`Time limit during L${levelAtTimeout}.`, { terminateWorker: true });
    }, maxTimeMs);

    worker.onmessage = (event: MessageEvent<TreeSearchWorkerResponse>) => {
      if (runId !== analysisRunIdRef.current) {
        return;
      }
      const now = performance.now();
      const completedElapsedMs = Math.max(0, now - timerStart);

      const message = event.data;
      if (message.type === 'analysisError') {
        stopAnalysisRun(`Analysis failed: ${message.message}`);
        return;
      }

      let bestTurn: BestTurnResponse;
      try {
        bestTurn = JSON.parse(message.analysisRaw) as BestTurnResponse;
      } catch {
        stopAnalysisRun('Analysis failed: invalid JSON response.');
        return;
      }

      setAnalysisElapsedMs(completedElapsedMs);
      const timing = analysisTimingRef.current;
      const completedLevelElapsedMs = Math.max(0, now - (timing?.levelStartMs ?? now));
      setAnalysisCurrentLevelElapsedMs(completedLevelElapsedMs);
      if (!bestTurn.isValid) {
        const invalidMessage = bestTurn.validationMessage || 'No suggested turn found.';
        if (!deepestCompletedSuggestion) {
          stopAnalysisRun(invalidMessage, { terminateWorker: false });
          return;
        }
        completeAndMaybeSubmit(`Analysis stopped at L${currentLevel}: ${invalidMessage}`);
        return;
      }

      deepestCompletedSuggestion = {
        sourceTurnCounter,
        analysisLevel: currentLevel,
        bestTurn,
        previewRaw: message.previewRaw,
        elapsedMs: completedElapsedMs,
        levelElapsedMs: completedLevelElapsedMs,
      };
      upsertAiResultsCacheFromSuggestion(sourceStateJson, deepestCompletedSuggestion, Date.now());
      mostRecentCompletedLevelElapsedMs = completedLevelElapsedMs;
      setAiSuggestion(deepestCompletedSuggestion);

      if (effectiveMaxAnalysisLevel !== null && currentLevel >= effectiveMaxAnalysisLevel) {
        completeAndMaybeSubmit(`Max turn depth reached at L${currentLevel}.`);
        return;
      }

      if (isTerminalHeuristicScore(bestTurn.heuristicScore)) {
        completeAndMaybeSubmit(`${formatHeuristicScore(bestTurn.heuristicScore)} found at L${currentLevel}.`);
        return;
      }

      if (completedElapsedMs >= maxTimeMs) {
        completeAndMaybeSubmit(`Time limit during L${currentLevel}.`);
        return;
      }

      currentLevel += 1;
      requestCurrentLevel();
    };

    worker.onerror = () => {
      if (runId !== analysisRunIdRef.current) {
        return;
      }
      stopAnalysisRun('Analysis worker failed.');
    };

    requestCurrentLevel();
  };

  const handleAnalysisCancel = () => {
    if (!analysisIsRunning) {
      return;
    }
    const levelAtCancel = analysisRunningLevelRef.current;
    analysisRunIdRef.current += 1;
    stopAnalysisRun(`cancelled during L${levelAtCancel ?? '?'}`);
  };

  const handleThink = () => {
    startBestTurnAnalysis(false);
  };

  const handleThinkAndDo = () => {
    startBestTurnAnalysis(true);
  };

  const handleDoSuggestedTurn = () => {
    if (!aiSuggestion || hasWinner) {
      return;
    }

    if (aiSuggestion.sourceTurnCounter !== turnCounterRef.current) {
      setAnalysisStatusMessage('Suggested turn is stale. Run Think again.');
      return;
    }

    const planned = entriesToMovesAndOrder(aiSuggestion.bestTurn.suggestedTurn);
    if (animationRef.current) {
      queuedAutoSubmitRef.current = {
        moves: planned.moves,
        order: planned.order,
        sourceTurnCounter: aiSuggestion.sourceTurnCounter,
      };
      setAnalysisStatusMessage('Suggested turn queued.');
      return;
    }
    submitPlan(planned.moves, planned.order, { animateFromCurrentState: true });
  };

  const handleUndo = () => {
    if (!gameState) {
      return;
    }
    if (analysisIsRunning) {
      analysisRunIdRef.current += 1;
      stopAnalysisRun('Analysis stopped because the position changed.');
    }
    const snapshotBeforeUndo = gameState.exportStateJson();
    const didUndo = gameState.undoLastTurn();
    if (!didUndo) {
      setValidationMessage('No previous turn to undo.');
      return;
    }
    const nextRedoStateStack = [...redoStateStack, snapshotBeforeUndo];
    setRedoStateStack(nextRedoStateStack);
    saveRedoStateStack(nextRedoStateStack);
    const undonePlayerPieceIdRaw = gameState.currentPlayerPieceId();
    const undonePlayerPieceId = isPieceId(undonePlayerPieceIdRaw) ? undonePlayerPieceIdRaw : null;
    const nextAiControlP1 = undonePlayerPieceId === 'player1' ? false : aiControlP1Ref.current;
    const nextAiControlP3 = undonePlayerPieceId === 'player2' ? false : aiControlP3Ref.current;
    if (nextAiControlP1 !== aiControlP1Ref.current || nextAiControlP3 !== aiControlP3Ref.current) {
      updateAiControlPrefs(nextAiControlP1, nextAiControlP3);
    }
    stopAnimation();
    setPlannedMoves({});
    setPlanOrder([]);
    setSelectedPieceId(null);
    setValidationMessage(null);
    resetAiOutputs();
    saveGameStateSnapshot(gameState);
    const nextTurnCounter = advanceTurnCounter();
    if (!(gameState?.hasWinner() ?? true)) {
      startBestTurnAnalysis(false, nextTurnCounter);
    }
  };

  const runRedo = (options?: { animateFromCurrentState?: boolean }) => {
    if (!gameState) {
      return;
    }
    if (redoStateStack.length === 0) {
      setValidationMessage('No undone turn to redo.');
      return;
    }
    const animateFromCurrentState = options?.animateFromCurrentState ?? false;
    const initialRoomsForAnimation = animateFromCurrentState
      ? Array.from(gameState.piecePositions(), (value) => Number(value))
      : null;
    if (analysisIsRunning) {
      analysisRunIdRef.current += 1;
      stopAnalysisRun('Analysis stopped because the position changed.');
    }

    const redoSnapshot = redoStateStack[redoStateStack.length - 1];
    const importError = gameState.importStateJson(redoSnapshot);
    if (importError) {
      setValidationMessage(`Redo failed: ${importError}`);
      return;
    }

    const nextRedoStateStack = redoStateStack.slice(0, -1);
    setRedoStateStack(nextRedoStateStack);
    saveRedoStateStack(nextRedoStateStack);
    stopAnimation();
    setPlannedMoves({});
    setPlanOrder([]);
    setSelectedPieceId(null);
    setValidationMessage(null);
    resetAiOutputs();
    saveGameStateSnapshot(gameState);
    const nextTurnCounter = advanceTurnCounter();
    if (!(gameState?.hasWinner() ?? true)) {
      startBestTurnAnalysis(false, nextTurnCounter);
    }
    if (animateFromCurrentState) {
      startAnimationFromState(initialRoomsForAnimation, { force: true });
    }
  };

  const handleRedo = () => {
    runRedo();
  };

  const handleReset = () => {
    if (!gameState) {
      return;
    }
    if (analysisIsRunning) {
      analysisRunIdRef.current += 1;
      stopAnalysisRun('Analysis stopped because the position changed.');
    }
    gameState.resetGame();
    stopAnimation();
    setPlannedMoves({});
    setPlanOrder([]);
    setSelectedPieceId(null);
    setValidationMessage(null);
    resetAiOutputs();
    setRedoStateStack([]);
    saveRedoStateStack([]);
    saveGameStateSnapshot(gameState);
    const nextTurnCounter = advanceTurnCounter();
    if (!gameState.hasWinner()) {
      startBestTurnAnalysis(false, nextTurnCounter);
    }
  };

  const handleSetupOpen = () => {
    setInfoPopup(null);
    setSetupPopupOpen(true);
    setSetupError(null);
  };

  const handleSetupCancel = () => {
    setSetupPopupOpen(false);
    setSetupError(null);
  };

  const handleSetupDraftChange = (field: keyof SetupPrefsDraft, value: string) => {
    const nextDraft = { ...setupPrefsDraft, [field]: value };
    setSetupPrefsDraft(nextDraft);
    setSetupError(null);
    const nextPrefs = parseSetupPrefsDraft(nextDraft);
    if (nextPrefs) {
      saveSetupPrefs(nextPrefs);
    }
  };

  const handleAnalysisLevelStep = (direction: StepDirection) => {
    if (analysisIsRunning) {
      return;
    }
    setMinAnalysisLevelDraft((prev) => {
      const next = stepNonNegativeIntegerText(prev, direction);
      saveCurrentAiPrefs({
        minAnalysisLevel: Number(next),
        maxAnalysisLevel: parseMaxAnalysisLevelDraft(maxAnalysisLevelDraft) ?? defaultMaxAnalysisLevel,
        analysisMaxTimeIndex,
      });
      return next;
    });
  };

  const handleAnalysisLevelChange = (rawLevel: string) => {
    setMinAnalysisLevelDraft(rawLevel);
    const parsedMinAnalysisLevel = parseMinAnalysisLevelDraft(rawLevel);
    if (parsedMinAnalysisLevel === null) {
      return;
    }
    saveCurrentAiPrefs({
      minAnalysisLevel: parsedMinAnalysisLevel,
      maxAnalysisLevel: parseMaxAnalysisLevelDraft(maxAnalysisLevelDraft) ?? defaultMaxAnalysisLevel,
      analysisMaxTimeIndex,
    });
  };

  const handleMaxAnalysisLevelStep = (direction: StepDirection) => {
    if (analysisIsRunning) {
      return;
    }
    setMaxAnalysisLevelDraft((prev) => {
      const next = stepNonNegativeIntegerText(prev, direction);
      saveCurrentAiPrefs({
        minAnalysisLevel: parseMinAnalysisLevelDraft(minAnalysisLevelDraft) ?? defaultMinAnalysisLevel,
        maxAnalysisLevel: Number(next),
        analysisMaxTimeIndex,
      });
      return next;
    });
  };

  const handleMaxAnalysisLevelChange = (rawLevel: string) => {
    setMaxAnalysisLevelDraft(rawLevel);
    const parsedMaxAnalysisLevel = parseMaxAnalysisLevelDraft(rawLevel);
    if (parsedMaxAnalysisLevel === null) {
      return;
    }
    saveCurrentAiPrefs({
      minAnalysisLevel: parseMinAnalysisLevelDraft(minAnalysisLevelDraft) ?? defaultMinAnalysisLevel,
      maxAnalysisLevel: parsedMaxAnalysisLevel,
      analysisMaxTimeIndex,
    });
  };

  const handleAnalysisMaxTimeStep = (direction: StepDirection) => {
    if (analysisIsRunning) {
      return;
    }
    setAnalysisMaxTimeIndex((prev) => {
      const nextIndex = clampAnalysisMaxTimeIndex(direction === 'down' ? prev - 1 : prev + 1);
      saveCurrentAiPrefs({
        analysisMaxTimeIndex: nextIndex,
      });
      return nextIndex;
    });
  };

  const handleAnalysisMaxTimeChange = (rawIndex: string) => {
    if (analysisIsRunning) {
      return;
    }
    const parsed = Number(rawIndex);
    const nextIndex = Number.isFinite(parsed) ? clampAnalysisMaxTimeIndex(Math.trunc(parsed)) : analysisMaxTimeIndex;
    setAnalysisMaxTimeIndex(nextIndex);
    saveCurrentAiPrefs({
      analysisMaxTimeIndex: nextIndex,
    });
  };

  const handleAiControlChange = (player: 'player1' | 'player2', checked: boolean) => {
    if (player === 'player1') {
      updateAiControlPrefs(checked, aiControlP3Ref.current);
      return;
    }
    updateAiControlPrefs(aiControlP1Ref.current, checked);
  };

  const handleAiShowOnBoardChange = (player: 'player1' | 'player2', checked: boolean) => {
    if (player === 'player1') {
      updateAiShowOnBoardPrefs(checked, aiShowOnBoardP3Ref.current);
      return;
    }
    updateAiShowOnBoardPrefs(aiShowOnBoardP1Ref.current, checked);
  };

  const handleSetupStep = (field: keyof SetupPrefsDraft, direction: StepDirection) => {
    handleSetupDraftChange(field, stepNonNegativeIntegerText(setupPrefsDraft[field], direction));
  };

  const handleRestoreSetupDefaults = () => {
    setSetupPrefsDraft(toSetupPrefsDraft(defaultSetupPrefs));
    saveSetupPrefs(defaultSetupPrefs);
    setSetupError(null);
  };

  const handleStartNewGameWithSetup = () => {
    if (!gameState) {
      return;
    }
    const parsedSetup = parseSetupPrefsDraft(setupPrefsDraft);
    if (!parsedSetup) {
      setSetupError('Setup values must be numbers >= 0.');
      return;
    }

    const startError = gameState.startNewGameWithSetup(
      parsedSetup.moveCards,
      parsedSetup.weaponCards,
      parsedSetup.failureCards,
    );
    if (startError) {
      setSetupError(startError);
      return;
    }

    if (analysisIsRunning) {
      analysisRunIdRef.current += 1;
      stopAnalysisRun('Analysis stopped because the position changed.');
    }
    stopAnimation();
    setPlannedMoves({});
    setPlanOrder([]);
    setSelectedPieceId(null);
    setValidationMessage(null);
    setSetupPopupOpen(false);
    setSetupError(null);
    resetAiOutputs();
    saveSetupPrefs(parsedSetup);
    setRedoStateStack([]);
    saveRedoStateStack([]);
    saveGameStateSnapshot(gameState);
    const nextTurnCounter = advanceTurnCounter();
    if (!gameState.hasWinner()) {
      startBestTurnAnalysis(false, nextTurnCounter);
    }
  };

  const handleCancel = () => {
    stopAnimation();
    setPlannedMoves({});
    setPlanOrder([]);
    setSelectedPieceId(null);
    setValidationMessage(null);
  };

  const handleInfoToggle = (kind: InfoPopupKind) => {
    setInfoPopup((prev) => (prev === kind ? null : kind));
  };

  const handleRoomMouseDown = (event: MouseEvent<SVGRectElement>, roomId: number) => {
    clearPendingEmptyRoomTouchTap();
    if (hasWinner) {
      return;
    }
    if (event.button !== 1) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!selectedPieceId) {
      handleSubmit();
      return;
    }
    if (pieceRoomMap.get(selectedPieceId) === roomId) {
      const plannedRoomId = plannedMoves[selectedPieceId];
      if (plannedRoomId !== undefined && plannedRoomId !== roomId) {
        clearPlannedMoveForPiece(selectedPieceId);
      }
      setSelectedPieceId(null);
      setValidationMessage(null);
      return;
    }
    const nextMoves = { ...plannedMoves, [selectedPieceId]: roomId };
    const nextOrder = planOrder.includes(selectedPieceId) ? planOrder : [...planOrder, selectedPieceId];
    setSelectedPieceId(null);
    submitPlan(nextMoves, nextOrder);
  };

  const handleRoomDoubleClick = (roomId: number) => {
    clearPendingEmptyRoomTouchTap();
    if (hasWinner) {
      return;
    }
    if (selectedPieceId) {
      return;
    }
    submitCurrentPlayerMoveToRoom(roomId);
  };

  const planSummary =
    planOrder.length === 0
      ? 'No moves planned.'
      : planOrder
          .map((pieceId) => {
            const roomId = plannedMoves[pieceId];
            return roomId === undefined
              ? `${pieceConfig[pieceId].label}@R?`
              : `${pieceConfig[pieceId].label}@R${roomId}`;
          })
          .join(', ');
  const previewDisplay = (() => {
    if (!gameState) {
      return {
        message: 'Preview unavailable.',
        tokens: [] as PreviewToken[],
      };
    }
    const rawPreview = gameState.previewTurnPlan(JSON.stringify(plannedEntries));
    return toPreviewDisplay(rawPreview, 'Invalid plan.');
  })();
  const aiSuggestionIsCurrent = aiSuggestion ? aiSuggestion.sourceTurnCounter === turnCounter : false;
  const aiPreviewDisplay = (() => {
    if (!aiSuggestion) {
      return {
        message: analysisIsRunning ? 'Analyzing...' : 'Run Think to get a suggested turn.',
        tokens: [] as PreviewToken[],
      };
    }

    if (!aiSuggestion.bestTurn.isValid) {
      return {
        message: aiSuggestion.bestTurn.validationMessage || 'No suggested turn found.',
        tokens: [] as PreviewToken[],
      };
    }

    if (!aiSuggestion.previewRaw) {
      return {
        message: 'Preview unavailable.',
        tokens: [] as PreviewToken[],
      };
    }

    return toPreviewDisplay(aiSuggestion.previewRaw, 'Suggested preview unavailable.');
  })();
  const aiStatusText = analysisIsRunning
    ? `L${analysisRunningLevel ?? '?'}, ${formatWholeSeconds(analysisCurrentLevelElapsedMs)}/${formatWholeSeconds(analysisElapsedMs)}`
    : (analysisStatusMessage ?? (aiSuggestion ? 'Analysis ready.' : 'Idle'));
  const aiCanDoIt = Boolean(aiSuggestion && aiSuggestion.bestTurn.isValid && aiSuggestionIsCurrent);
  const aiSuggestedTurnText =
    aiSuggestion && aiSuggestion.bestTurn.isValid
      ? formatSuggestedTurnText(aiSuggestion.bestTurn)
      : 'No suggestion yet.';
  const aiStatsText =
    aiSuggestion && aiSuggestion.bestTurn.isValid
      ? `L${aiSuggestion.analysisLevel}, ${formatHeuristicScore(aiSuggestion.bestTurn.heuristicScore)}, ${formatElapsedTime(aiSuggestion.levelElapsedMs)}`
      : '-';
  const aiStaleMessage = aiSuggestion && !aiSuggestionIsCurrent ? 'Suggestion is stale. Run Think again.' : null;
  const aiShowOnBoardEnabledForCurrentPlayer =
    currentPlayerPieceId === 'player1' ? aiShowOnBoardP1 : currentPlayerPieceId === 'player2' ? aiShowOnBoardP3 : false;
  const analysisMaxTimeMs = (analysisMaxTimeOptions[analysisMaxTimeIndex] ?? analysisMaxTimeOptions[0]).ms;
  const aiSuggestionBoardText = (() => {
    if (hasWinner || !aiShowOnBoardEnabledForCurrentPlayer) {
      return null;
    }
    const runningTimeText = `(${formatWholeSeconds(analysisElapsedMs)}/${formatWholeSeconds(analysisMaxTimeMs)})`;
    if (analysisIsRunning && !aiSuggestion) {
      return `L${analysisRunningLevel ?? '?'}: thinking ${runningTimeText}`;
    }
    if (!aiSuggestion || !aiSuggestionIsCurrent) {
      return null;
    }
    if (!aiSuggestion.bestTurn.isValid) {
      return null;
    }
    const suggestedTurnTextForBoard = formatSuggestedTurnTextForBoard(aiSuggestion.bestTurn);
    if (!suggestedTurnTextForBoard) {
      return null;
    }
    const statusText = analysisIsRunning ? runningTimeText : '(done)';
    return `L${aiSuggestion.analysisLevel}: ${suggestedTurnTextForBoard} ${statusText}`;
  })();

  if (!initialAutoAnalysisQueuedRef.current && gameState && !hasWinner) {
    initialAutoAnalysisQueuedRef.current = true;
    queueMicrotask(() => {
      startBestTurnAnalysis(false, turnCounterRef.current);
    });
  }

  const selectedLabel = selectedPieceId ? pieceConfig[selectedPieceId].label : 'None';
  const selectedSuffix = selectedPieceId && plannedMoves[selectedPieceId] !== undefined ? ' (update)' : '';
  const selectedRoomId = selectedPieceId ? pieceRoomMap.get(selectedPieceId) : undefined;
  const distanceByRoom = selectedRoomId !== undefined ? buildRoomDistanceMap(selectedRoomId) : null;
  const movePossibleByRoom = (() => {
    if (!selectedPieceId || selectedRoomId === undefined || !distanceByRoom || !gameState) {
      return null;
    }
    const nextOrder = planOrder.includes(selectedPieceId) ? planOrder : [...planOrder, selectedPieceId];
    const byRoom = new Map<number, boolean>();
    distanceByRoom.forEach((_distance, roomId) => {
      if (roomId === selectedRoomId) {
        return;
      }
      const nextMoves = { ...plannedMoves, [selectedPieceId]: roomId };
      const nextEntries = nextOrder
        .map((pieceId) => {
          const plannedRoomId = nextMoves[pieceId];
          if (plannedRoomId === undefined) {
            return null;
          }
          return { pieceId, roomId: plannedRoomId };
        })
        .filter((entry): entry is TurnPlanEntry => entry !== null);
      const validation = gameState.validateTurnPlan(JSON.stringify(nextEntries));
      byRoom.set(roomId, !validation);
    });
    return byRoom;
  })();
  const aiSuggestionOverlayVisible = Boolean(aiSuggestionBoardText && !animatedPieces && !animationRef.current);
  const boardOverlayText = actionOverlay ?? (aiSuggestionOverlayVisible ? aiSuggestionBoardText : null);
  const actionOverlayLayout = boardOverlayText ? buildActionOverlayLayout(boardOverlayText) : null;
  const aiSuggestionBoardDoButtonVisible =
    actionOverlay === null && aiSuggestionOverlayVisible && aiCanDoIt && !hasWinner;
  const aiSuggestionBoardDoButtonLayout =
    aiSuggestionBoardDoButtonVisible && actionOverlayLayout
      ? (() => {
          const buttonHeight = Math.round(actionOverlayLayout.boxHeight * 1.5);
          const buttonWidth = Math.round(buttonHeight * 1.45);
          const gap = 8;
          const margin = 10;
          const desiredX = actionOverlayLayout.boxX + actionOverlayLayout.boxWidth + gap;
          const maxX = boardWidth - margin - buttonWidth;
          const x = Math.min(Math.max(desiredX, margin), maxX);
          const desiredY = actionOverlayLayout.boxY + (actionOverlayLayout.boxHeight - buttonHeight) / 2;
          const maxY = boardHeight - margin - buttonHeight;
          const y = Math.min(Math.max(desiredY, margin), maxY);
          return {
            x,
            y,
            width: buttonWidth,
            height: buttonHeight,
          };
        })()
      : null;
  const actionOverlayBoxClassName =
    actionOverlay === null && aiSuggestionOverlayVisible
      ? 'action-overlay-box action-overlay-box--ai-suggestion'
      : 'action-overlay-box';
  const winnerOverlayLayout = winnerOverlayText ? buildWinnerOverlayLayout(winnerOverlayText) : null;
  const showWinnerOverlay = hasWinner && !animatedPieces;

  const stopAnimation = (options?: { executeQueuedAutoSubmit?: boolean }) => {
    const queuedAutoSubmit = options?.executeQueuedAutoSubmit ? queuedAutoSubmitRef.current : null;
    queuedAutoSubmitRef.current = null;
    const current = animationRef.current;
    if (current && current.rafId !== null) {
      cancelAnimationFrame(current.rafId);
    }
    animationRef.current = null;
    setAnimatedPieces(null);
    setActionOverlay(null);
    setActionHighlightPieceId(null);
    if (!queuedAutoSubmit) {
      return;
    }
    if (queuedAutoSubmit.sourceTurnCounter !== turnCounterRef.current) {
      return;
    }
    submitPlan(queuedAutoSubmit.moves, queuedAutoSubmit.order, { animateFromCurrentState: true });
  };

  const buildPositionsForRooms = (roomIds: number[]) => {
    const roomTokens = new Map<number, PieceId[]>();
    pieceOrder.forEach((pieceId, index) => {
      const roomId = roomIds[index];
      if (roomId === undefined) {
        return;
      }
      const list = roomTokens.get(roomId) ?? [];
      list.push(pieceId);
      roomTokens.set(roomId, list);
    });

    const positionsByPiece = new Map<
      PieceId,
      { pieceId: PieceId; roomId: number; x: number; y: number; size: number }
    >();
    roomTokens.forEach((pieceIds, roomId) => {
      const room = boardRoomById.get(roomId);
      if (!room) {
        return;
      }
      const orderedPieceIds = pieceOrder.filter((pieceId) => pieceIds.includes(pieceId));
      const roomRect = getRoomRect(room.coords);
      const { size, positions } = getPiecePositionsInRoom(orderedPieceIds.length, roomRect);
      orderedPieceIds.forEach((pieceId, index) => {
        const placement = positions[index];
        if (!placement) {
          return;
        }
        positionsByPiece.set(pieceId, {
          pieceId,
          roomId,
          x: placement.x,
          y: placement.y,
          size,
        });
      });
    });

    return pieceOrder
      .map((pieceId) => positionsByPiece.get(pieceId))
      .filter(
        (piece): piece is { pieceId: PieceId; roomId: number; x: number; y: number; size: number } =>
          piece !== undefined,
      );
  };

  const startAnimationFromState = (initialRoomsOverride?: number[] | null, options?: { force?: boolean }) => {
    if (!gameState || (!animationEnabled && !options?.force)) {
      return;
    }
    const framesRaw = gameState.animationFrames();
    if (!framesRaw || framesRaw.length === 0) {
      return;
    }
    const frameCount = Math.floor(framesRaw.length / pieceOrder.length);
    if (frameCount <= 1) {
      return;
    }
    const frameRooms = Array.from({ length: frameCount }, (_, frameIndex) =>
      pieceOrder.map((_pieceId, index) => framesRaw[frameIndex * pieceOrder.length + index]),
    );
    const frames = frameRooms.map((rooms) => buildPositionsForRooms(rooms));
    const summaryText = gameState.prevTurnSummaryVerbose();
    const summaryActions = parseActionSummaries(summaryText);
    const actionTexts = summaryActions.map((action, index) => {
      if (!action) {
        return null;
      }
      const pieceIndex = pieceOrder.indexOf(action.actor);
      const rooms = frameRooms[index + 1];
      if (pieceIndex < 0 || !rooms) {
        return null;
      }
      const roomId = rooms[pieceIndex];
      const label = pieceConfig[action.actor].label;
      return action.kind === 'loot' ? `${label} loots R${roomId}` : `${label} attacks in R${roomId}`;
    });
    const actionHighlights = summaryActions.map((action) => {
      if (!action) {
        return null;
      }
      return action.kind === 'attack' ? 'doctor' : action.actor;
    });
    const segments: Array<{
      from: Array<{ pieceId: PieceId; roomId: number; x: number; y: number; size: number }>;
      to: Array<{ pieceId: PieceId; roomId: number; x: number; y: number; size: number }>;
      actionText: string | null;
      highlightPieceId: PieceId | null;
    }> = [];
    for (let index = 0; index < frames.length - 1; index += 1) {
      const startRooms = frameRooms[index];
      const endRooms = frameRooms[index + 1];
      const actionRooms = [startRooms[0], ...endRooms.slice(1)];
      const actionText = actionTexts[index] ?? null;
      const startEqualsAction = startRooms.every((roomId, roomIndex) => roomId === actionRooms[roomIndex]);
      const actionEqualsEnd = actionRooms.every((roomId, roomIndex) => roomId === endRooms[roomIndex]);
      const startFrame = frames[index];
      const endFrame = frames[index + 1];
      const actionFrame = startEqualsAction
        ? startFrame
        : actionEqualsEnd
          ? endFrame
          : buildPositionsForRooms(actionRooms);

      if (!startEqualsAction) {
        segments.push({ from: startFrame, to: actionFrame, actionText: null, highlightPieceId: null });
      }
      if (actionText) {
        segments.push({
          from: actionFrame,
          to: actionFrame,
          actionText,
          highlightPieceId: actionHighlights[index] ?? null,
        });
      }
      if (!actionEqualsEnd) {
        segments.push({ from: actionFrame, to: endFrame, actionText: null, highlightPieceId: null });
      }
    }

    if (initialRoomsOverride && initialRoomsOverride.length === pieceOrder.length) {
      const hasAnyDiff = initialRoomsOverride.some((roomId, index) => roomId !== frameRooms[0][index]);
      if (hasAnyDiff) {
        const initialFrame = buildPositionsForRooms(initialRoomsOverride);
        if (initialFrame.length > 0) {
          segments.unshift({
            from: initialFrame,
            to: frames[0],
            actionText: null,
            highlightPieceId: null,
          });
        }
      }
    }

    stopAnimation();

    if (segments.length === 0) {
      return;
    }

    const animationState = {
      segments,
      segmentIndex: 0,
      startTime: performance.now(),
      durationMs: 1000 / animationSpeed,
      speed: animationSpeed,
      rafId: null as number | null,
    };

    const tick = (now: number) => {
      if (!animationRef.current) {
        return;
      }
      const current = animationRef.current;
      const segment = current.segments[current.segmentIndex];
      const progress = Math.min(1, (now - current.startTime) / current.durationMs);
      const from = segment.from;
      const to = segment.to;
      const interpolated = from.map((piece, index) => {
        const target = to[index] ?? piece;
        return {
          pieceId: piece.pieceId,
          roomId: target.roomId,
          x: piece.x + (target.x - piece.x) * progress,
          y: piece.y + (target.y - piece.y) * progress,
          size: piece.size + (target.size - piece.size) * progress,
        };
      });

      setAnimatedPieces(interpolated);

      if (progress >= 1) {
        const nextIndex = current.segmentIndex + 1;
        if (nextIndex >= current.segments.length) {
          stopAnimation({ executeQueuedAutoSubmit: true });
          return;
        }
        current.segmentIndex = nextIndex;
        current.startTime = now;
        current.durationMs = 1000 / current.speed;
        setActionOverlay(current.segments[nextIndex].actionText);
        setActionHighlightPieceId(current.segments[nextIndex].highlightPieceId);
      }

      current.rafId = requestAnimationFrame(tick);
    };

    animationRef.current = animationState;
    setAnimatedPieces(segments[0].from);
    setActionOverlay(segments[0].actionText);
    setActionHighlightPieceId(segments[0].highlightPieceId);
    animationRef.current.rafId = requestAnimationFrame(tick);
  };

  const handleAnimationEnabledChange = (checked: boolean) => {
    setAnimationEnabled(checked);
    saveAnimationPrefs({
      animationEnabled: checked,
      animationSpeedIndex,
    });
    if (!checked) {
      stopAnimation();
    }
  };

  const handleSpeedChange = (direction: 'slower' | 'faster') => {
    setAnimationSpeedIndex((prev) => {
      const next = direction === 'slower' ? Math.max(0, prev - 1) : Math.min(animationSpeeds.length - 1, prev + 1);
      saveAnimationPrefs({
        animationEnabled,
        animationSpeedIndex: next,
      });
      if (animationRef.current) {
        animationRef.current.speed = animationSpeeds[next];
      }
      return next;
    });
  };

  if (!gameState) {
    return <div className="play-area-error">Failed to create game state.</div>;
  }

  const handleBoardMouseDown = (event: MouseEvent<SVGSVGElement>) => {
    clearPendingEmptyRoomTouchTap();
    if (hasWinner) {
      return;
    }
    if (event.button !== 1) {
      return;
    }
    if (selectedPieceId) {
      return;
    }
    event.preventDefault();
    handleSubmit();
  };

  const currentPlayerColor = currentPlayerPieceId ? pieceConfig[currentPlayerPieceId].color : 'var(--line)';
  const currentPlayerTextColor = currentPlayerPieceId ? pieceConfig[currentPlayerPieceId].textColor : 'var(--ink)';
  const boardOutlineColor = animatedPieces ? '#8c8c8c' : currentPlayerColor;
  let infoPopupTitle =
    infoPopup === 'rules'
      ? 'Rules'
      : infoPopup === 'turnPlanner'
        ? 'Turn Planner Help'
        : infoPopup === 'ai'
          ? 'AI Help'
          : infoPopup === 'playerInfoBox'
            ? 'Player Info Box Help'
            : 'UNKNOWN3854';
  infoPopupTitle += ' (click anywhere to close)';
  const infoPopupContent =
    infoPopup === 'rules' ? (
      <>
        <p>
          This is basically Kill Doctor Lucky but without any randomness and there are no ties; if the stranger before
          you in the turn order kills the Dr, you win. The teams are [P1,p4] and [P2,p3]. P1 and P3 are normal players.
          p3 and p4 are strangers.
        </p>
        <p>What the cards can do...</p>
        <ul>
          <li>Every move card gives 1 movement point and can be converted 1:1 into clovers for defense.</li>
          <li>Every weapon card gives 2 attack points and can be converted 1:1 into clovers for defense.</li>
          <li>Every failure card gives 2 clovers.</li>
        </ul>
        <p>How to gain and use the cards...</p>
        <ul>
          <li>
            Every time you loot a room as your action, you gain 1/3 of a move card, 1/3 of a weapon card, and 1/3 of a
            failure card.
          </li>
          <li>
            Every time you attack as your action, you use 1 weapon card if you have 1 or more weapon cards. If you have
            less than 1 weapon card, you use the fractional weapon card you have. You can't decline weapon card use.
          </li>
          <li>
            Every time you defend, cards can be fractionally converted into clovers. Cards are converted to clovers as
            needed in this order: failure, weapon, move.
          </li>
        </ul>
        <p>
          And again: if the stranger before you in the turn order kills the Dr, you win; the teams are [P1,p4] and
          [P2,p3]. If P1 or p4 attack, P3 defends. If p2 or P3 attack, P4 defends. Strangers never contribute clovers to
          defend any attack.
        </p>
      </>
    ) : infoPopup === 'turnPlanner' ? (
      <>
        <h4>Movement / Turn Planning</h4>
        <p>
          There are a few ways to choose movements for your piece and the strangers. You can click the "Submit" button
          to submit your plan, but there are other ways via middle clicks and double clicks to submit your plan.
        </p>
        <ul>
          <li>
            The most basic way to choose a movement is to click a piece and then click a destination room. You can
            select pieces and change their destinations multiple times.
          </li>
          <li>
            Once a piece has a planned destination, you will see a "ghost" version of that piece in the destination room
            and the original piece is grayed out a bit.
          </li>
          <li>
            You do not always have to click a piece to select it; if no piece is selected and you click a room with
            movable pieces, it will select the first piece from this list: [yourself, your allied stranger, the opposing
            stranger].
          </li>
          <li>If no piece is selected, middle-clicking in the board will submit the plan.</li>
          <li>
            If a piece is selected, middle-clicking in a room will choose that room as the piece's destination and
            submit your plan.
          </li>
          <li>
            If no piece is selected, double-clicking on a room is the same as choosing that room as the destination for
            your normal player piece and submitting the plan, which can include previously planned moves.
            Double-clicking a room while a piece is selected is interpreted as 2 single clicks.
          </li>
          <li>Reminder: you can not move or select the Dr or the normal opponent piece.</li>
        </ul>
        <h4>Undo/Redo</h4>
        <p>
          Clicking the Undo button will undo everything up to the last submitted plan, which includes all Dr movement
          and stranger turns. Clicking Redo will redo the last undone plan, and you can redo multiple times if you had
          undone multiple times. Anim Redo does the same redo operation but always plays the animation for that redone
          turn.
        </p>
      </>
    ) : infoPopup === 'ai' ? (
      <>
        <h4>AI Controls</h4>
        <ul>
          <li>
            <strong>Think</strong>: runs analysis and updates the suggestion using Min Turn Depth, Max Turn Depth, and
            Max Time.
          </li>
          <li>
            <strong>Do</strong>: submits the current suggested turn if it is valid and not stale.
          </li>
          <li>
            <strong>T&amp;D</strong>: runs analysis, then auto-submits the best suggestion found by the time analysis
            stops.
          </li>
          <li>
            <strong>Cancel</strong>: stops an in-progress analysis run and keeps the best completed level found so far.
          </li>
          <li>
            <strong>Clear Cache</strong>: removes remembered analysis results from memory and localStorage.
          </li>
        </ul>
        <h4>AI Ownership / Display</h4>
        <ul>
          <li>
            <strong>Control (P1/P3)</strong>: lets AI automatically play that normal player when it becomes their turn.
            More specifically, it automatically submits the suggested turn when the analysis completes.
          </li>
          <li>
            <strong>Show On Board (P1/P3)</strong>: shows/hides the suggested move text overlay (and a small Do button)
            on the board for that side.
          </li>
        </ul>
        <h4>Analysis Settings</h4>
        <ul>
          <li>
            <strong>Min Turn Depth</strong>: minimum search depth before the run is allowed to stop from time limits.
          </li>
          <li>
            <strong>Max Turn Depth</strong>: when Min Turn Depth is less than or equal to Max Turn Depth, analysis will
            stop as soon as a result reaches this depth (including a cached result at or above this depth). If Min Turn
            Depth is greater than Max Turn Depth, Max Turn Depth is ignored.
          </li>
          <li>
            <strong>Max Time</strong>: total time budget for one run; analysis will stop when this budget is hit, unless
            we still haven't completed the minimum turn depth analysis.
          </li>
          <li>The +/- buttons next to each field are quick steppers for mobile and desktop.</li>
        </ul>
        <h4>AI Outputs</h4>
        <ul>
          <li>
            <strong>Status</strong>: current run status (idle/analyzing/cancelled/finished), including level and elapsed
            timing while running.
          </li>
          <li>
            <strong>Suggested</strong>: the best move sequence from the latest completed analysis result.
          </li>
          <li>
            <strong>Stats</strong>: <code>L#</code>, heuristic score, and elapsed time for the completed suggestion
            level.
          </li>
          <li>
            <strong>Preview</strong>: predicted result if the suggested turn is executed (next player, attackers,
            winner, etc.).
          </li>
        </ul>
      </>
    ) : infoPopup === 'playerInfoBox' ? (
      <>
        <h4>Player Info Box</h4>
        <p>
          This box with 4 colorful rows, one for each player, shows vital information about each player. The columns...
        </p>
        <ul>
          <li>D: number of rooms/turns until the Dr arrives at the player's current room.</li>
          <li>S: player strength/natural-attack-power.</li>
          <li>M: number of move cards, each one granting 1 move point and convertable to 1 clover.</li>
          <li>W: number of weapon cards, each one granting 2 attack points and convertable to 1 clover.</li>
          <li>F: number of failure cards, each one convertable to 2 clovers.</li>
          <li>C: number of clovers if you were to convert all their cards.</li>
        </ul>
      </>
    ) : null;
  const modalOverlayOpen = setupPopupOpen || Boolean(infoPopup && infoPopupContent);

  return (
    <section className="play-area">
      {modalOverlayOpen && (
        <style>{`
          html, body {
            overflow: hidden;
            overscroll-behavior: none;
          }
        `}</style>
      )}
      <div className="board-column">
        <div className="board-controls">
          <button className="board-control-button" onClick={handleReset}>
            Reset
          </button>
          <button className="board-control-button" onClick={handleSetupOpen}>
            Setup
          </button>
          <button className="board-control-button" onClick={() => handleInfoToggle('rules')}>
            Rules
          </button>
        </div>
        <div className="board-shell" style={{ borderColor: boardOutlineColor }}>
          <div className="board">
            <svg
              viewBox={`0 0 ${boardWidth} ${boardHeight}`}
              role="img"
              aria-label="Kill Doctor Lucky Board Alternate Downstairs"
              preserveAspectRatio="xMidYMid meet"
              onMouseDown={handleBoardMouseDown}
            >
              <image href={boardImageHref} width={boardWidth} height={boardHeight} />
              <g className="room-layer">
                {boardRooms.map((room) => {
                  if (room.coords.length !== 4) {
                    return null;
                  }
                  const [x1, y1, x2, y2] = room.coords;
                  const roomClassName = 'room-hit';
                  return (
                    <rect
                      key={room.id}
                      x={x1}
                      y={y1}
                      width={x2 - x1}
                      height={y2 - y1}
                      className={roomClassName}
                      onClick={(event) => handleRoomClick(room.id, event)}
                      onMouseDown={(event) => handleRoomMouseDown(event, room.id)}
                      onDoubleClick={() => handleRoomDoubleClick(room.id)}
                      aria-label={room.name ?? `Room ${room.id}`}
                    />
                  );
                })}
              </g>
              {distanceByRoom && selectedRoomId !== undefined && (
                <g className="room-distance-layer">
                  {boardRooms.map((room) => {
                    if (room.coords.length !== 4) {
                      return null;
                    }
                    if (room.id === selectedRoomId) {
                      return null;
                    }
                    const distance = distanceByRoom.get(room.id);
                    if (distance === undefined) {
                      return null;
                    }
                    const rect = getRoomRect(room.coords);
                    const boxWidth = 30;
                    const boxHeight = 30;
                    const boxX = rect.x + (rect.width - boxWidth) / 2;
                    const boxY = rect.y + rect.height * 0.2;
                    const textX = boxX + boxWidth / 2;
                    const textY = boxY + boxHeight / 2 + 0.5;
                    const isMovePossible = movePossibleByRoom?.get(room.id) ?? true;
                    const boxClassName = isMovePossible
                      ? 'room-distance-box room-distance-box--possible'
                      : 'room-distance-box room-distance-box--too-far';

                    return (
                      <g key={`distance-${room.id}`}>
                        <rect className={boxClassName} x={boxX} y={boxY} width={boxWidth} height={boxHeight} />
                        <text className="room-distance-text" x={textX} y={textY}>
                          {distance}
                        </text>
                      </g>
                    );
                  })}
                </g>
              )}
              <g className="piece-layer">
                {(animatedPieces ? animatedPieceList : renderPieces.filter((piece) => piece.kind === 'actual')).map(
                  (piece) => {
                    const config = pieceConfig[piece.pieceId];
                    const isSelected = selectedPieceId === piece.pieceId;
                    const isFlashing = actionHighlightPieceId === piece.pieceId;
                    const selectable = isPieceSelectable(piece.pieceId);
                    const isPlannedSource = plannedMoves[piece.pieceId] !== undefined;
                    const className = [
                      'piece',
                      `piece--${config.shape}`,
                      isSelected ? 'piece--selected' : '',
                      selectable ? 'piece--movable' : 'piece--locked',
                      isPlannedSource ? 'piece--planned-source' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    const labelSize = Math.min(piece.size * 0.6, 22);
                    const pieceFill = isPlannedSource ? blendHexColor(config.color, '#9c9c9c', 0.5) : config.color;
                    const pieceStroke = isPlannedSource ? '#8c8c8c' : undefined;
                    const pieceStrokeWidth = isPlannedSource ? 2.4 : undefined;
                    const labelFill = isPlannedSource
                      ? blendHexColor(config.textColor, '#6f6f6f', 0.5)
                      : config.textColor;

                    const commonProps = {
                      className,
                      fill: pieceFill,
                      stroke: pieceStroke,
                      strokeWidth: pieceStrokeWidth,
                      onClick: (event: MouseEvent<SVGElement>) => {
                        event.stopPropagation();
                        handlePieceClick(piece.pieceId);
                      },
                      'aria-label': `${config.label} piece`,
                    };

                    const buildShape = (props: ShapeProps) => {
                      if (config.shape === 'circle') {
                        return (
                          <circle
                            cx={piece.x + piece.size / 2}
                            cy={piece.y + piece.size / 2}
                            r={piece.size / 2}
                            {...props}
                          />
                        );
                      }
                      if (config.shape === 'square') {
                        return <rect x={piece.x} y={piece.y} width={piece.size} height={piece.size} {...props} />;
                      }
                      return <polygon points={getHexPoints(piece.x, piece.y, piece.size)} {...props} />;
                    };
                    const outlineShape = isFlashing
                      ? buildShape({
                          className: 'piece--flash-outline',
                          pointerEvents: 'none',
                          'aria-hidden': true,
                        })
                      : null;
                    const shape = buildShape(commonProps);

                    return (
                      <g key={piece.pieceId}>
                        {outlineShape}
                        {shape}
                        {config.showLabel && (
                          <text
                            className="piece-label"
                            x={piece.x + piece.size / 2}
                            y={piece.y + piece.size / 2}
                            fontSize={labelSize}
                            fill={labelFill}
                          >
                            {config.label}
                          </text>
                        )}
                      </g>
                    );
                  },
                )}
              </g>
              <g className="piece-layer piece-layer--planned">
                {renderPieces
                  .filter((piece) => piece.kind === 'ghost')
                  .map((piece) => {
                    const config = pieceConfig[piece.pieceId];
                    const className = ['piece', `piece--${config.shape}`, 'piece--planned-ghost']
                      .filter(Boolean)
                      .join(' ');
                    const labelSize = Math.min(piece.size * 0.6, 22);
                    const ghostProps = {
                      className,
                      fill: config.color,
                      stroke: '#1f4f7a',
                      strokeWidth: 4,
                      pointerEvents: 'none' as const,
                      'aria-hidden': true,
                    };
                    let shape;
                    if (config.shape === 'circle') {
                      shape = (
                        <circle
                          cx={piece.x + piece.size / 2}
                          cy={piece.y + piece.size / 2}
                          r={piece.size / 2}
                          {...ghostProps}
                        />
                      );
                    } else if (config.shape === 'square') {
                      shape = <rect x={piece.x} y={piece.y} width={piece.size} height={piece.size} {...ghostProps} />;
                    } else {
                      shape = <polygon points={getHexPoints(piece.x, piece.y, piece.size)} {...ghostProps} />;
                    }

                    return (
                      <g key={`ghost-${piece.pieceId}`} pointerEvents="none">
                        {shape}
                        {config.showLabel && (
                          <text
                            className="piece-label piece-label--planned"
                            x={piece.x + piece.size / 2}
                            y={piece.y + piece.size / 2}
                            fontSize={labelSize}
                            fill="#1f4f7a"
                          >
                            {config.label}
                          </text>
                        )}
                      </g>
                    );
                  })}
              </g>
              {boardOverlayText && actionOverlayLayout && (
                <g className="action-overlay">
                  <rect
                    className={actionOverlayBoxClassName}
                    x={actionOverlayLayout.boxX}
                    y={actionOverlayLayout.boxY}
                    width={actionOverlayLayout.boxWidth}
                    height={actionOverlayLayout.boxHeight}
                  />
                  <text
                    className="action-overlay-text"
                    x={actionOverlayLayout.textX}
                    y={actionOverlayLayout.textY}
                    style={{ fontSize: `${actionOverlayLayout.fontSize}px` }}
                  >
                    {boardOverlayText}
                  </text>
                </g>
              )}
              {aiSuggestionBoardDoButtonLayout && (
                <foreignObject
                  className="action-overlay-action"
                  x={aiSuggestionBoardDoButtonLayout.x}
                  y={aiSuggestionBoardDoButtonLayout.y}
                  width={aiSuggestionBoardDoButtonLayout.width}
                  height={aiSuggestionBoardDoButtonLayout.height}
                >
                  <button
                    type="button"
                    className="planner-button planner-button--primary action-overlay-do-button"
                    onMouseDown={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDoSuggestedTurn();
                    }}
                    aria-label="Do suggested turn"
                    title="Do suggested turn"
                    disabled={!aiCanDoIt || hasWinner}
                  >
                    Do
                  </button>
                </foreignObject>
              )}
              {showWinnerOverlay && winnerOverlayText && winnerOverlayLayout && (
                <g className="winner-overlay" aria-hidden>
                  <rect
                    className="winner-overlay-box"
                    x={winnerOverlayLayout.boxX}
                    y={winnerOverlayLayout.boxY}
                    width={winnerOverlayLayout.boxWidth}
                    height={winnerOverlayLayout.boxHeight}
                  />
                  <text className="winner-overlay-text" x={winnerOverlayLayout.textX} y={winnerOverlayLayout.textY}>
                    {winnerOverlayText}
                  </text>
                </g>
              )}
            </svg>
          </div>
        </div>
      </div>
      <div className="side-column">
        <aside className="planner-panel">
          <div className="planner-header">
            <div>
              <h2
                className="planner-title"
                style={{ backgroundColor: currentPlayerColor, color: currentPlayerTextColor }}
              >
                {hasWinner && winnerTurnTitleText ? winnerTurnTitleText : currentTurnTitleText}
              </h2>
            </div>
            <div className="planner-header-actions">
              <button
                type="button"
                className="planner-help-icon-button"
                onClick={() => handleInfoToggle('turnPlanner')}
                aria-label="Turn planner help"
                title="Turn planner help"
              >
                ?
              </button>
            </div>
          </div>
          <div className="planner-line">
            <span className="planner-label planner-label--small">Selected</span>
            <span className="planner-value">{selectedLabel + selectedSuffix}</span>
          </div>
          <div className="planner-line">
            <span className="planner-label planner-label--small">Planned</span>
            <span className="planner-value">{planSummary}</span>
          </div>
          <div className="planner-line">
            <span className="planner-label planner-label--small">Preview</span>
            <span className="planner-value planner-value--preview">
              {previewDisplay.message
                ? previewDisplay.message
                : previewDisplay.tokens.map((token, index) => {
                    if (token.kind === 'winner') {
                      const winnerPieceStyle = token.winnerPieceId
                        ? {
                            backgroundColor: pieceConfig[token.winnerPieceId].color,
                            color: pieceConfig[token.winnerPieceId].textColor,
                          }
                        : undefined;
                      return (
                        <span key={`preview-token-win-${token.winnerText}-${index}`}>
                          {index > 0 && <span className="planner-preview-sep">|</span>}
                          <span className="planner-preview-token planner-preview-token--badge planner-preview-token--win">
                            WIN:
                          </span>
                          <span
                            className={
                              token.winnerPieceId
                                ? 'planner-preview-token planner-preview-token--badge'
                                : 'planner-preview-token'
                            }
                            style={winnerPieceStyle}
                          >
                            {token.winnerText}
                          </span>
                        </span>
                      );
                    }
                    const colorPieceId = token.colorPieceId;
                    const previewTokenStyle = colorPieceId
                      ? {
                          backgroundColor: pieceConfig[colorPieceId].color,
                          color: pieceConfig[colorPieceId].textColor,
                        }
                      : undefined;
                    return (
                      <span key={`preview-token-text-${token.text}-${index}`}>
                        {index > 0 && <span className="planner-preview-sep">|</span>}
                        <span
                          className={
                            colorPieceId
                              ? 'planner-preview-token planner-preview-token--badge'
                              : 'planner-preview-token'
                          }
                          style={previewTokenStyle}
                        >
                          {token.text}
                        </span>
                      </span>
                    );
                  })}
            </span>
          </div>
          <div className="planner-actions planner-actions--turn">
            <button className="planner-button planner-button--primary" onClick={handleSubmit} disabled={hasWinner}>
              Submit
            </button>
            <button className="planner-button" onClick={handleCancel} disabled={!canCancelTurnPlan}>
              Cancel
            </button>
            <button className="planner-button" onClick={handleUndo} disabled={!canUndo}>
              Undo
            </button>
            <button className="planner-button" onClick={handleRedo} disabled={!canRedo}>
              Redo
            </button>
          </div>
          {validationMessage && <p className="planner-error">{validationMessage}</p>}
          <div className="planner-animations">
            <p className="planner-animations-title">Animations</p>
            <div className="planner-animations-row">
              <label className="planner-animations-toggle">
                <input
                  type="checkbox"
                  checked={animationEnabled}
                  onChange={(event) => handleAnimationEnabledChange(event.target.checked)}
                />
                On
              </label>
              <button className="planner-button" onClick={() => handleSpeedChange('slower')} aria-label="Slower">
                -
              </button>
              <button className="planner-button" onClick={() => handleSpeedChange('faster')} aria-label="Faster">
                +
              </button>
              <span className="planner-animations-speed">{animationSpeed.toFixed(2)}x</span>
              <button
                className="planner-button planner-animations-redo-button"
                onClick={() => runRedo({ animateFromCurrentState: true })}
                disabled={!canRedo}
              >
                Anim Redo
              </button>
            </div>
          </div>
        </aside>
        <aside className="planner-panel player-stats-panel" onClick={() => handleInfoToggle('playerInfoBox')}>
          {playerStatsRows.length === 0 ? (
            <p className="player-stats-empty">Stats unavailable.</p>
          ) : (
            <table className="player-stats-table" aria-label="Player stats">
              <thead>
                <tr>
                  <th scope="col">P</th>
                  <th scope="col">D</th>
                  <th scope="col">S</th>
                  <th scope="col">M</th>
                  <th scope="col">W</th>
                  <th scope="col">F</th>
                  <th scope="col">C</th>
                </tr>
              </thead>
              <tbody>
                {playerStatsRows.map((row) => {
                  const config = pieceConfig[row.pieceId];
                  const isNormalPlayerRow = row.pieceId === 'player1' || row.pieceId === 'player2';
                  const numericCellClassName = isNormalPlayerRow ? 'player-stats-cell--bold' : undefined;
                  return (
                    <tr
                      key={`player-stats-${row.pieceId}`}
                      style={{ backgroundColor: config.color, color: config.textColor }}
                    >
                      <th scope="row">{config.label}</th>
                      <td className={numericCellClassName}>{formatPlayerInteger(row.doctorDistance)}</td>
                      <td className={numericCellClassName}>{formatPlayerInteger(row.strength)}</td>
                      <td className={numericCellClassName}>
                        {isNormalPlayerRow ? formatPlayerStatDecimal(row.moveCards) : ''}
                      </td>
                      <td className={numericCellClassName}>
                        {isNormalPlayerRow ? formatPlayerStatDecimal(row.weaponCards) : ''}
                      </td>
                      <td className={numericCellClassName}>
                        {isNormalPlayerRow ? formatPlayerStatDecimal(row.failureCards) : ''}
                      </td>
                      <td className={numericCellClassName}>
                        {isNormalPlayerRow ? formatPlayerStatDecimal(row.equivalentClovers) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </aside>
        <aside className="planner-panel ai-panel">
          <div className="planner-header">
            <h2
              className="planner-title"
              style={{ backgroundColor: currentPlayerColor, color: currentPlayerTextColor }}
            >
              AI
            </h2>
            <div className="planner-header-actions">
              <button
                type="button"
                className="planner-help-icon-button"
                onClick={() => handleInfoToggle('ai')}
                aria-label="AI help"
                title="AI help"
              >
                ?
              </button>
            </div>
          </div>
          <div className="planner-actions ai-actions ai-actions--header">
            <button
              className="planner-button planner-button--primary"
              onClick={handleThink}
              disabled={hasWinner || analysisIsRunning}
            >
              Think
            </button>
            <button
              className="planner-button planner-button--primary"
              onClick={handleDoSuggestedTurn}
              disabled={!aiCanDoIt || hasWinner}
            >
              Do
            </button>
            <button className="planner-button" onClick={handleThinkAndDo} disabled={hasWinner || analysisIsRunning}>
              T&D
            </button>
            <button className="planner-button" onClick={handleAnalysisCancel} disabled={!analysisIsRunning}>
              Cancel
            </button>
          </div>
          <div className="planner-line">
            <span className="planner-label">Control</span>
            <span className="planner-value ai-control-value">
              <label className="ai-control-option">
                <input
                  type="checkbox"
                  checked={aiControlP1}
                  onChange={(event) => handleAiControlChange('player1', event.target.checked)}
                />
                P1
              </label>
              <label className="ai-control-option">
                <input
                  type="checkbox"
                  checked={aiControlP3}
                  onChange={(event) => handleAiControlChange('player2', event.target.checked)}
                />
                P3
              </label>
            </span>
          </div>
          <div className="planner-line">
            <span className="planner-label">Show On Board</span>
            <span className="planner-value ai-control-value">
              <label className="ai-control-option">
                <input
                  type="checkbox"
                  aria-label="ShowOnBoard P1"
                  checked={aiShowOnBoardP1}
                  onChange={(event) => handleAiShowOnBoardChange('player1', event.target.checked)}
                />
                P1
              </label>
              <label className="ai-control-option">
                <input
                  type="checkbox"
                  aria-label="ShowOnBoard P3"
                  checked={aiShowOnBoardP3}
                  onChange={(event) => handleAiShowOnBoardChange('player2', event.target.checked)}
                />
                P3
              </label>
            </span>
          </div>
          <div className="planner-line ai-level-line">
            <label className="planner-label" htmlFor="analysis-min-level">
              Min Turn Depth
            </label>
            {/* Firefox Android hides native number spinners; explicit steppers keep increment/decrement available on mobile. */}
            <div className="number-stepper">
              <input
                id="analysis-min-level"
                className="ai-level-input number-stepper-input"
                type="number"
                min="0"
                step="1"
                value={minAnalysisLevelDraft}
                onChange={(event) => handleAnalysisLevelChange(event.target.value)}
                disabled={analysisIsRunning}
              />
              <button
                type="button"
                className="number-stepper-button"
                onClick={() => handleAnalysisLevelStep('down')}
                aria-label="Decrease min turn depth"
                disabled={analysisIsRunning}
              >
                -
              </button>
              <button
                type="button"
                className="number-stepper-button"
                onClick={() => handleAnalysisLevelStep('up')}
                aria-label="Increase min turn depth"
                disabled={analysisIsRunning}
              >
                +
              </button>
            </div>
          </div>
          <div className="planner-line ai-level-line">
            <label className="planner-label" htmlFor="analysis-max-level">
              Max Turn Depth
            </label>
            <div className="number-stepper">
              <input
                id="analysis-max-level"
                className="ai-level-input number-stepper-input"
                type="number"
                min="0"
                step="1"
                value={maxAnalysisLevelDraft}
                onChange={(event) => handleMaxAnalysisLevelChange(event.target.value)}
                disabled={analysisIsRunning}
              />
              <button
                type="button"
                className="number-stepper-button"
                onClick={() => handleMaxAnalysisLevelStep('down')}
                aria-label="Decrease max turn depth"
                disabled={analysisIsRunning}
              >
                -
              </button>
              <button
                type="button"
                className="number-stepper-button"
                onClick={() => handleMaxAnalysisLevelStep('up')}
                aria-label="Increase max turn depth"
                disabled={analysisIsRunning}
              >
                +
              </button>
            </div>
          </div>
          <div className="planner-line ai-level-line">
            <label className="planner-label" htmlFor="analysis-max-time">
              Max Time
            </label>
            <div className="number-stepper">
              <select
                id="analysis-max-time"
                className="ai-max-time-select number-stepper-input"
                value={analysisMaxTimeIndex.toString()}
                onChange={(event) => handleAnalysisMaxTimeChange(event.target.value)}
                disabled={analysisIsRunning}
              >
                {analysisMaxTimeOptions.map((option, index) => (
                  <option key={`analysis-max-time-${option.label}-${index}`} value={index.toString()}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="number-stepper-button"
                onClick={() => handleAnalysisMaxTimeStep('down')}
                aria-label="Decrease max time"
                disabled={analysisIsRunning}
              >
                -
              </button>
              <button
                type="button"
                className="number-stepper-button"
                onClick={() => handleAnalysisMaxTimeStep('up')}
                aria-label="Increase max time"
                disabled={analysisIsRunning}
              >
                +
              </button>
            </div>
          </div>
          <div className="planner-line">
            <span className="planner-label">Status</span>
            <span className="planner-value">{aiStatusText}</span>
          </div>
          <div className="planner-line">
            <span className="planner-label">Suggested</span>
            <span className="planner-value">{aiSuggestedTurnText}</span>
          </div>
          <div className="planner-line">
            <span className="planner-label">Stats</span>
            <span className="planner-value">{aiStatsText}</span>
          </div>
          <div className="planner-line">
            <span className="planner-label">Preview</span>
            <span className="planner-value planner-value--preview">
              {aiPreviewDisplay.message
                ? aiPreviewDisplay.message
                : aiPreviewDisplay.tokens.map((token, index) => {
                    if (token.kind === 'winner') {
                      const winnerPieceStyle = token.winnerPieceId
                        ? {
                            backgroundColor: pieceConfig[token.winnerPieceId].color,
                            color: pieceConfig[token.winnerPieceId].textColor,
                          }
                        : undefined;
                      return (
                        <span key={`ai-preview-token-win-${token.winnerText}-${index}`}>
                          {index > 0 && <span className="planner-preview-sep">|</span>}
                          <span className="planner-preview-token planner-preview-token--badge planner-preview-token--win">
                            WIN:
                          </span>
                          <span
                            className={
                              token.winnerPieceId
                                ? 'planner-preview-token planner-preview-token--badge'
                                : 'planner-preview-token'
                            }
                            style={winnerPieceStyle}
                          >
                            {token.winnerText}
                          </span>
                        </span>
                      );
                    }
                    const colorPieceId = token.colorPieceId;
                    const previewTokenStyle = colorPieceId
                      ? {
                          backgroundColor: pieceConfig[colorPieceId].color,
                          color: pieceConfig[colorPieceId].textColor,
                        }
                      : undefined;
                    return (
                      <span key={`ai-preview-token-text-${token.text}-${index}`}>
                        {index > 0 && <span className="planner-preview-sep">|</span>}
                        <span
                          className={
                            colorPieceId
                              ? 'planner-preview-token planner-preview-token--badge'
                              : 'planner-preview-token'
                          }
                          style={previewTokenStyle}
                        >
                          {token.text}
                        </span>
                      </span>
                    );
                  })}
            </span>
          </div>
          {aiStaleMessage && <p className="ai-note">{aiStaleMessage}</p>}
          <div className="planner-actions ai-actions ai-actions--footer">
            <button className="planner-button" onClick={handleClearAiResultsCache}>
              Clear Cache
            </button>
          </div>
        </aside>
      </div>
      <div className="play-area-summary">
        <pre className="game-summary">{summary}</pre>
        {prevTurnSummary && <pre className="game-summary">{prevTurnSummary}</pre>}
        {history && <pre className="game-summary game-summary--history">{history}</pre>}
      </div>
      {setupPopupOpen && (
        <div className="info-overlay" role="dialog" aria-modal="true" onClick={handleSetupCancel}>
          <div className="info-popup setup-popup" onClick={(event) => event.stopPropagation()}>
            <h3>Setup</h3>
            <div className="setup-popup-form">
              <label className="setup-popup-row">
                <span>Move Cards (Normal)</span>
                <div className="number-stepper">
                  <input
                    className="number-stepper-input"
                    aria-label="Move cards"
                    type="number"
                    min="0"
                    step="1"
                    value={setupPrefsDraft.moveCards}
                    onChange={(event) => handleSetupDraftChange('moveCards', event.target.value)}
                  />
                  <button
                    type="button"
                    className="number-stepper-button"
                    onClick={() => handleSetupStep('moveCards', 'down')}
                    aria-label="Decrease move cards"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    className="number-stepper-button"
                    onClick={() => handleSetupStep('moveCards', 'up')}
                    aria-label="Increase move cards"
                  >
                    +
                  </button>
                </div>
              </label>
              <label className="setup-popup-row">
                <span>Weapon Cards (Normal)</span>
                <div className="number-stepper">
                  <input
                    className="number-stepper-input"
                    aria-label="Weapon cards"
                    type="number"
                    min="0"
                    step="1"
                    value={setupPrefsDraft.weaponCards}
                    onChange={(event) => handleSetupDraftChange('weaponCards', event.target.value)}
                  />
                  <button
                    type="button"
                    className="number-stepper-button"
                    onClick={() => handleSetupStep('weaponCards', 'down')}
                    aria-label="Decrease weapon cards"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    className="number-stepper-button"
                    onClick={() => handleSetupStep('weaponCards', 'up')}
                    aria-label="Increase weapon cards"
                  >
                    +
                  </button>
                </div>
              </label>
              <label className="setup-popup-row">
                <span>Failure Cards (Normal)</span>
                <div className="number-stepper">
                  <input
                    className="number-stepper-input"
                    aria-label="Failure cards"
                    type="number"
                    min="0"
                    step="1"
                    value={setupPrefsDraft.failureCards}
                    onChange={(event) => handleSetupDraftChange('failureCards', event.target.value)}
                  />
                  <button
                    type="button"
                    className="number-stepper-button"
                    onClick={() => handleSetupStep('failureCards', 'down')}
                    aria-label="Decrease failure cards"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    className="number-stepper-button"
                    onClick={() => handleSetupStep('failureCards', 'up')}
                    aria-label="Increase failure cards"
                  >
                    +
                  </button>
                </div>
              </label>
            </div>
            {setupError && <p className="setup-popup-error">{setupError}</p>}
            <div className="setup-popup-actions">
              <button className="planner-button planner-button--primary" onClick={handleStartNewGameWithSetup}>
                Start New Game
              </button>
              <button className="planner-button" onClick={handleSetupCancel}>
                Cancel
              </button>
              <button className="planner-button" onClick={handleRestoreSetupDefaults}>
                Restore Defaults
              </button>
            </div>
          </div>
        </div>
      )}
      {infoPopup && infoPopupContent && (
        <div className="info-overlay" role="dialog" aria-modal="true" onClick={() => setInfoPopup(null)}>
          <div className="info-popup">
            <h3>{infoPopupTitle}</h3>
            {infoPopupContent}
          </div>
        </div>
      )}
    </section>
  );
}

export default PlayArea;
