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
  attackers: string[];
  currentPlayerLoots: boolean;
  doctorRoomId: number;
  movedStrangers: Array<{
    pieceId: string;
    roomId: number;
  }>;
};

type PreviewToken = {
  text: string;
  colorPieceId: PieceId | null;
};

type PreviewDisplay = {
  message: string | null;
  tokens: PreviewToken[];
};

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
  bestTurn: BestTurnResponse;
  previewRaw: string;
  elapsedMs: number;
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
const isPieceId = (value: string): value is PieceId => pieceOrder.includes(value as PieceId);
const animationPrefsStorageKey = 'kdl.settings.v1';
const setupPrefsStorageKey = 'kdl.setup.v1';
const gameStateStorageKey = 'kdl.gameState.v1';
const fallbackSetupPrefs = {
  moveCards: 2,
  weaponCards: 2,
  failureCards: 4,
};

type AnimationPrefs = {
  animationEnabled: boolean;
  animationSpeedIndex: number;
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

type StepDirection = 'down' | 'up';

const clampAnimationSpeedIndex = (value: number) => Math.min(animationSpeeds.length - 1, Math.max(0, value));
const isFiniteNonNegative = (value: number) => Number.isFinite(value) && value >= 0;
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
      console.warn(`Saved game ignored: ${importError}`);
      return;
    }
    const setupFromGame = parseSetupPrefsJson(gameState.currentNormalSetupJson(), fallbackSetupPrefs);
    saveSetupPrefs(setupFromGame);
  } catch {
    try {
      window.localStorage.removeItem(gameStateStorageKey);
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

const pieceSizeTarget = 60;
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
  const fontSize = 18;
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
  const tokens: PreviewToken[] = [{ text: `Next:${nextText}`, colorPieceId: nextPieceId }];

  if (parsed.attackers.length > 0) {
    const attackerLabels = parsed.attackers.map((pieceId) =>
      isPieceId(pieceId) ? pieceConfig[pieceId].label : pieceId,
    );
    tokens.push({ text: `Atk:${attackerLabels.join(',')}`, colorPieceId: null });
  }

  if (parsed.currentPlayerLoots) {
    tokens.push({ text: 'Loot', colorPieceId: null });
  }

  parsed.movedStrangers.forEach((entry) => {
    const pieceId = isPieceId(entry.pieceId) ? entry.pieceId : null;
    const pieceText = pieceId ? pieceConfig[pieceId].label : entry.pieceId;
    const roomText = Number.isFinite(entry.roomId) ? entry.roomId : '?';
    const colorPieceId = pieceId === 'stranger1' || pieceId === 'stranger2' ? pieceId : null;
    tokens.push({ text: `${pieceText}:R${roomText}`, colorPieceId });
  });

  const doctorRoomText = Number.isFinite(parsed.doctorRoomId) ? parsed.doctorRoomId : '?';
  tokens.push({ text: `Dr:R${doctorRoomText}`, colorPieceId: null });

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
  const [infoPopup, setInfoPopup] = useState<'rules' | 'ui' | null>(null);
  const [setupPopupOpen, setSetupPopupOpen] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupPrefsDraft, setSetupPrefsDraft] = useState<SetupPrefsDraft>(() =>
    toSetupPrefsDraft(loadSetupPrefs(currentSetupPrefs)),
  );
  const [redoStateStack, setRedoStateStack] = useState<string[]>([]);
  const [turnCounter, setTurnCounter] = useState(0);
  const turnCounterRef = useRef(turnCounter);
  turnCounterRef.current = turnCounter;
  const [analysisLevelDraft, setAnalysisLevelDraft] = useState('2');
  const [analysisIsRunning, setAnalysisIsRunning] = useState(false);
  const [analysisElapsedMs, setAnalysisElapsedMs] = useState(0);
  const [analysisStatusMessage, setAnalysisStatusMessage] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const analysisTimerRef = useRef<number | null>(null);
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
  const animationSpeed = animationSpeeds[animationSpeedIndex];
  const summary = gameState ? gameState.summary(0) : 'Failed to create game state.';
  const prevTurnSummary = gameState ? gameState.prevTurnSummaryVerbose() : '';
  const history = gameState ? gameState.normalTurnHistory() : '';
  const hasWinner = gameState ? gameState.hasWinner() : false;
  const canUndo = history.trim().length > 0;
  const canRedo = redoStateStack.length > 0;
  const canCancelTurnPlan = selectedPieceId !== null || planOrder.length > 0 || validationMessage !== null;
  const winnerPieceIdRaw = gameState ? gameState.winnerPieceId() : '';
  const winnerPieceId =
    winnerPieceIdRaw === 'player1' || winnerPieceIdRaw === 'player2' ? (winnerPieceIdRaw as PieceId) : null;
  const winnerOverlayText = winnerPieceId ? `${pieceConfig[winnerPieceId].label} wins!` : null;
  const currentPlayerPieceId = gameState ? (gameState.currentPlayerPieceId() as PieceId) : null;
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

  const handlePieceClick = (pieceId: PieceId) => {
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
    if (event?.detail && event.detail > 1 && !selectedPieceId) {
      return;
    }
    if (!selectedPieceId) {
      const preferredPiece = getPreferredSelectablePieceInRoom(roomId);
      if (preferredPiece) {
        setSelectedPieceId(preferredPiece);
        setValidationMessage(null);
        return;
      }
      setValidationMessage('Select a piece, then choose a destination room.');
      return;
    }
    if (pieceRoomMap.get(selectedPieceId) === roomId) {
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
    setAnalysisStatusMessage(statusMessage);
  };

  const resetAiOutputs = () => {
    setAiSuggestion(null);
    setAnalysisElapsedMs(0);
    setAnalysisStatusMessage(null);
  };

  const submitPlan = (
    moves: Partial<Record<PieceId, number>>,
    order: PieceId[],
    options?: {
      animateFromCurrentState?: boolean;
    },
  ) => {
    if (hasWinner) {
      return;
    }
    const initialRoomsForAnimation =
      options?.animateFromCurrentState && gameState
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
    const validation = gameState?.validateTurnPlan(JSON.stringify(planEntries));
    if (validation) {
      setPlannedMoves(moves);
      setPlanOrder(order);
      setValidationMessage(validation);
      return;
    }
    const applyError = gameState?.applyTurnPlan(JSON.stringify(planEntries)) ?? '';
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
    saveGameStateSnapshot(gameState);
    setTurnCounter((prev) => prev + 1);
    startAnimationFromState(initialRoomsForAnimation);
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

  const startBestTurnAnalysis = (autoSubmit: boolean) => {
    if (!gameState) {
      setAnalysisStatusMessage('Analysis unavailable.');
      return;
    }
    if (hasWinner) {
      setAnalysisStatusMessage('Game already has a winner.');
      return;
    }

    const parsedLevel = Number(analysisLevelDraft);
    if (!Number.isFinite(parsedLevel) || parsedLevel < 0) {
      setAnalysisStatusMessage('Analysis level must be a number >= 0.');
      return;
    }

    const analysisLevel = Math.trunc(parsedLevel);
    setAnalysisLevelDraft(analysisLevel.toString());
    analysisRunIdRef.current += 1;
    const runId = analysisRunIdRef.current;
    const sourceTurnCounter = turnCounterRef.current;

    stopAnalysisTimer();
    if (analysisIsRunning) {
      stopAnalysisWorker();
    }
    setAiSuggestion(null);
    setAnalysisIsRunning(true);
    setAnalysisStatusMessage(autoSubmit ? 'Analyzing and auto-submitting...' : 'Analyzing...');
    setAnalysisElapsedMs(0);

    const timerStart = performance.now();
    analysisTimerRef.current = window.setInterval(() => {
      setAnalysisElapsedMs(performance.now() - timerStart);
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

    worker.onmessage = (event: MessageEvent<TreeSearchWorkerResponse>) => {
      if (runId !== analysisRunIdRef.current) {
        return;
      }
      const completedElapsedMs = Math.max(0, performance.now() - timerStart);

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
      if (!bestTurn.isValid) {
        setAiSuggestion(null);
        stopAnalysisRun(bestTurn.validationMessage || 'No suggested turn found.', { terminateWorker: false });
        return;
      }

      setAiSuggestion({
        sourceTurnCounter,
        bestTurn,
        previewRaw: message.previewRaw,
        elapsedMs: completedElapsedMs,
      });

      if (!autoSubmit) {
        stopAnalysisRun('Analysis complete.', { terminateWorker: false });
        return;
      }

      if (sourceTurnCounter !== turnCounterRef.current) {
        stopAnalysisRun('Analysis complete. Auto-submit skipped because the position changed.', {
          terminateWorker: false,
        });
        return;
      }

      stopAnalysisRun('Analysis complete. Suggested turn submitted.', { terminateWorker: false });
      const planned = entriesToMovesAndOrder(bestTurn.suggestedTurn);
      submitPlan(planned.moves, planned.order, { animateFromCurrentState: true });
    };

    worker.onerror = () => {
      if (runId !== analysisRunIdRef.current) {
        return;
      }
      stopAnalysisRun('Analysis worker failed.');
    };

    const request: TreeSearchWorkerRequest = {
      type: 'analyze',
      runId,
      stateJson: gameState.exportStateJson(),
      analysisLevel,
    };
    worker.postMessage(request);
  };

  const handleAnalysisCancel = () => {
    if (!analysisIsRunning) {
      return;
    }
    analysisRunIdRef.current += 1;
    stopAnalysisRun('Analysis cancelled.');
  };

  const handleThink = () => {
    startBestTurnAnalysis(false);
  };

  const handleThinkAndDo = () => {
    startBestTurnAnalysis(true);
  };

  const handleDoSuggestedTurn = () => {
    if (!aiSuggestion || analysisIsRunning || hasWinner) {
      return;
    }

    if (aiSuggestion.sourceTurnCounter !== turnCounterRef.current) {
      setAnalysisStatusMessage('Suggested turn is stale. Run Think again.');
      return;
    }

    const planned = entriesToMovesAndOrder(aiSuggestion.bestTurn.suggestedTurn);
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
    setRedoStateStack((prev) => [...prev, snapshotBeforeUndo]);
    stopAnimation();
    setPlannedMoves({});
    setPlanOrder([]);
    setSelectedPieceId(null);
    setValidationMessage(null);
    resetAiOutputs();
    saveGameStateSnapshot(gameState);
    setTurnCounter((prev) => prev + 1);
  };

  const handleRedo = () => {
    if (!gameState) {
      return;
    }
    if (redoStateStack.length === 0) {
      setValidationMessage('No undone turn to redo.');
      return;
    }
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

    setRedoStateStack((prev) => prev.slice(0, -1));
    stopAnimation();
    setPlannedMoves({});
    setPlanOrder([]);
    setSelectedPieceId(null);
    setValidationMessage(null);
    resetAiOutputs();
    saveGameStateSnapshot(gameState);
    setTurnCounter((prev) => prev + 1);
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
    saveGameStateSnapshot(gameState);
    setTurnCounter((prev) => prev + 1);
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
    setAnalysisLevelDraft((prev) => stepNonNegativeIntegerText(prev, direction));
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
    saveGameStateSnapshot(gameState);
    setTurnCounter((prev) => prev + 1);
  };

  const handleCancel = () => {
    stopAnimation();
    setPlannedMoves({});
    setPlanOrder([]);
    setSelectedPieceId(null);
    setValidationMessage(null);
  };

  const handleInfoToggle = (kind: 'rules' | 'ui') => {
    setInfoPopup((prev) => (prev === kind ? null : kind));
  };

  const handleRoomMouseDown = (event: MouseEvent<SVGRectElement>, roomId: number) => {
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
    if (hasWinner) {
      return;
    }
    if (selectedPieceId) {
      return;
    }
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
    ? `Analyzing... ${formatElapsedTime(analysisElapsedMs)}`
    : (analysisStatusMessage ?? (aiSuggestion ? 'Analysis ready.' : 'Idle'));
  const aiCanDoIt = Boolean(
    aiSuggestion && aiSuggestion.bestTurn.isValid && aiSuggestionIsCurrent && !analysisIsRunning,
  );
  const aiSuggestedTurnText =
    aiSuggestion && aiSuggestion.bestTurn.isValid
      ? aiSuggestion.bestTurn.suggestedTurnText || '(none)'
      : 'No suggestion yet.';
  const aiStatsText =
    aiSuggestion && aiSuggestion.bestTurn.isValid
      ? `${formatHeuristicScore(aiSuggestion.bestTurn.heuristicScore)}, ${formatElapsedTime(aiSuggestion.elapsedMs)}, ${aiSuggestion.bestTurn.numStatesVisited} states`
      : '-';
  const aiStaleMessage = aiSuggestion && !aiSuggestionIsCurrent ? 'Suggestion is stale. Run Think again.' : null;

  const selectedLabel = selectedPieceId ? pieceConfig[selectedPieceId].label : 'None';
  const selectedSuffix = selectedPieceId && plannedMoves[selectedPieceId] !== undefined ? ' (update)' : '';
  const selectedRoomId = selectedPieceId ? pieceRoomMap.get(selectedPieceId) : undefined;
  const distanceByRoom = selectedRoomId !== undefined ? buildRoomDistanceMap(selectedRoomId) : null;
  const actionOverlayLayout = actionOverlay ? buildActionOverlayLayout(actionOverlay) : null;
  const winnerOverlayLayout = winnerOverlayText ? buildWinnerOverlayLayout(winnerOverlayText) : null;

  const stopAnimation = () => {
    const current = animationRef.current;
    if (current && current.rafId !== null) {
      cancelAnimationFrame(current.rafId);
    }
    animationRef.current = null;
    setAnimatedPieces(null);
    setActionOverlay(null);
    setActionHighlightPieceId(null);
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

  const startAnimationFromState = (initialRoomsOverride?: number[] | null) => {
    if (!gameState || !animationEnabled) {
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
          stopAnimation();
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

  const handleAnimationEnabled = (enabled: boolean) => {
    setAnimationEnabled(enabled);
    saveAnimationPrefs({
      animationEnabled: enabled,
      animationSpeedIndex,
    });
    if (!enabled) {
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
  let infoPopupTitle = infoPopup === 'rules' ? 'Rules' : infoPopup === 'ui' ? 'UI Info' : 'UNKNOWN3854';
  infoPopupTitle += ' (click anywhere to close)';
  const infoPopupContent =
    infoPopup === 'rules' ? (
      <p>The rules: TODO</p>
    ) : infoPopup === 'ui' ? (
      <>
        <p>Select your piece or a stranger, then click a room to set a destination.</p>
        <p>Click a planned piece again to update its destination. Submit validates the plan.</p>
        <p>Opponent pieces and the doctor cannot be moved.</p>
      </>
    ) : null;

  return (
    <section className="play-area">
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
          <button className="board-control-button" onClick={() => handleInfoToggle('ui')}>
            UI Info
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

                    return (
                      <g key={`distance-${room.id}`}>
                        <rect className="room-distance-box" x={boxX} y={boxY} width={boxWidth} height={boxHeight} />
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
              {actionOverlay && actionOverlayLayout && (
                <g className="action-overlay">
                  <rect
                    className="action-overlay-box"
                    x={actionOverlayLayout.boxX}
                    y={actionOverlayLayout.boxY}
                    width={actionOverlayLayout.boxWidth}
                    height={actionOverlayLayout.boxHeight}
                  />
                  <text className="action-overlay-text" x={actionOverlayLayout.textX} y={actionOverlayLayout.textY}>
                    {actionOverlay}
                  </text>
                </g>
              )}
              {hasWinner && winnerOverlayText && winnerOverlayLayout && (
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
                {hasWinner && winnerOverlayText
                  ? winnerOverlayText
                  : `Current: ${currentPlayerPieceId ? pieceConfig[currentPlayerPieceId].label : '??'}`}
              </h2>
            </div>
          </div>
          <div className="planner-line">
            <span className="planner-label">Selected</span>
            <span className="planner-value">{selectedLabel + selectedSuffix}</span>
          </div>
          <div className="planner-line">
            <span className="planner-label">Planned</span>
            <span className="planner-value">{planSummary}</span>
          </div>
          <div className="planner-line">
            <span className="planner-label">Preview</span>
            <span className="planner-value planner-value--preview">
              {previewDisplay.message
                ? previewDisplay.message
                : previewDisplay.tokens.map((token, index) => {
                    const colorPieceId = token.colorPieceId;
                    const previewTokenStyle = colorPieceId
                      ? {
                          backgroundColor: pieceConfig[colorPieceId].color,
                          color: pieceConfig[colorPieceId].textColor,
                        }
                      : undefined;
                    return (
                      <span key={`preview-token-${token.text}-${index}`}>
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
              <button
                className={`planner-button ${animationEnabled ? '' : 'is-active'}`}
                onClick={() => handleAnimationEnabled(false)}
              >
                Off
              </button>
              <button
                className={`planner-button ${animationEnabled ? 'is-active' : ''}`}
                onClick={() => handleAnimationEnabled(true)}
              >
                On
              </button>
              <button className="planner-button" onClick={() => handleSpeedChange('slower')} aria-label="Slower">
                -
              </button>
              <button className="planner-button" onClick={() => handleSpeedChange('faster')} aria-label="Faster">
                +
              </button>
              <span className="planner-animations-speed">{animationSpeed.toFixed(2)}x</span>
            </div>
          </div>
        </aside>
        <aside className="planner-panel player-stats-panel">
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
            <h2 className="planner-title">AI</h2>
          </div>
          <div className="planner-line ai-level-line">
            <label className="planner-label" htmlFor="analysis-level">
              Analysis
            </label>
            {/* Firefox Android hides native number spinners; explicit steppers keep increment/decrement available on mobile. */}
            <div className="number-stepper">
              <input
                id="analysis-level"
                className="ai-level-input number-stepper-input"
                type="number"
                min="0"
                step="1"
                value={analysisLevelDraft}
                onChange={(event) => setAnalysisLevelDraft(event.target.value)}
                disabled={analysisIsRunning}
              />
              <button
                type="button"
                className="number-stepper-button"
                onClick={() => handleAnalysisLevelStep('down')}
                aria-label="Decrease analysis level"
                disabled={analysisIsRunning}
              >
                -
              </button>
              <button
                type="button"
                className="number-stepper-button"
                onClick={() => handleAnalysisLevelStep('up')}
                aria-label="Increase analysis level"
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
                    const colorPieceId = token.colorPieceId;
                    const previewTokenStyle = colorPieceId
                      ? {
                          backgroundColor: pieceConfig[colorPieceId].color,
                          color: pieceConfig[colorPieceId].textColor,
                        }
                      : undefined;
                    return (
                      <span key={`ai-preview-token-${token.text}-${index}`}>
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
          <div className="planner-actions ai-actions">
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
          {aiStaleMessage && <p className="ai-note">{aiStaleMessage}</p>}
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
