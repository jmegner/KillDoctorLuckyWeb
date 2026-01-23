import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { newDefaultGameState, type GameStateHandle } from '@/KdlRust/pkg/kill_doctor_lucky_rust';
import boardData from '../data/boards/BoardAltDown.json';

type BoardRoom = {
  Id: string | number;
  Name?: string;
  Coords: number[];
};

type BoardLayout = {
  ImagePath: string;
  Rooms: BoardRoom[];
};

type PiecePosition = {
  pieceId: string;
  kind: 'doctor' | 'player' | 'stranger';
  roomId: number;
};

type PlannedMove = {
  pieceId: string;
  roomId: number;
};

const boardLayout = boardData as BoardLayout;
const boardWidth = 1480;
const boardHeight = 965;
const boardImageHref = `${import.meta.env.BASE_URL}${boardLayout.ImagePath.replace(/^\//, '')}`;
const pieceOrder = ['Doctor', 'P1', 'P2', 'S1', 'S2'];
const pieceColors: Record<string, string> = {
  Doctor: '#111111',
  P1: '#d92b2b',
  P2: '#2b9e39',
  S1: '#f08c1a',
  S2: '#f2d23c',
};

const roomRects = boardLayout.Rooms.map((room) => {
  const [x1, y1, x2, y2] = room.Coords;
  return {
    id: Number(room.Id),
    name: room.Name,
    x1,
    y1,
    x2,
    y2,
    width: x2 - x1,
    height: y2 - y1,
  };
});

const smallestRoom = roomRects.reduce(
  (acc, room) => ({
    width: Math.min(acc.width, room.width),
    height: Math.min(acc.height, room.height),
  }),
  { width: Infinity, height: Infinity },
);
const pieceGap = 4;
const piecePadding = 6;
const pieceSize = Math.max(
  14,
  Math.floor(
    Math.min(
      26,
      (smallestRoom.width - piecePadding * 2 - pieceGap * 2) / 3,
      (smallestRoom.height - piecePadding * 2 - pieceGap) / 2,
    ),
  ),
);
const gridWidth = pieceSize * 3 + pieceGap * 2;
const gridHeight = pieceSize * 2 + pieceGap;

const hexPoints = (cx: number, cy: number, r: number) => {
  const points = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i + Math.PI / 6;
    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return points.join(' ');
};

function PlayArea() {
  const [gameState, setGameState] = useState<GameStateHandle | null>(null);
  const [summary, setSummary] = useState<string>('');
  const [piecePositions, setPiecePositions] = useState<PiecePosition[]>([]);
  const [currentPlayerPieceId, setCurrentPlayerPieceId] = useState<string>('');
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [plannedMoves, setPlannedMoves] = useState<Record<string, number>>({});
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [reachableRooms, setReachableRooms] = useState<Set<number>>(new Set());
  const [isInfoOpen, setIsInfoOpen] = useState(false);

  const roomById = useMemo(() => {
    const map = new Map<number, (typeof roomRects)[number]>();
    roomRects.forEach((room) => {
      map.set(room.id, room);
    });
    return map;
  }, []);

  useEffect(() => {
    try {
      const state = newDefaultGameState();
      setGameState(state);
      setSummary(state.summary(0));
      setPiecePositions(state.piecePositions() as PiecePosition[]);
      setCurrentPlayerPieceId(state.currentPlayerPieceId());
    } catch (error) {
      setSummary(`Failed to create game state: ${String(error)}`);
    }
  }, []);

  useEffect(() => {
    if (gameState) {
      setSummary(gameState.summary(0));
      setPiecePositions(gameState.piecePositions() as PiecePosition[]);
      setCurrentPlayerPieceId(gameState.currentPlayerPieceId());
    }
  }, [gameState]);

  useEffect(() => {
    if (!gameState || !selectedPieceId) {
      setReachableRooms(new Set());
      return;
    }
    try {
      const rooms = gameState.reachableRooms(selectedPieceId, 1) as number[];
      setReachableRooms(new Set(rooms));
    } catch {
      setReachableRooms(new Set());
    }
  }, [gameState, selectedPieceId]);

  const plannedMoveSummary = useMemo(() => {
    const entries = Object.entries(plannedMoves).sort(
      ([pieceA], [pieceB]) => pieceOrder.indexOf(pieceA) - pieceOrder.indexOf(pieceB),
    );
    if (entries.length === 0) {
      return 'No moves selected';
    }
    return entries.map(([pieceId, roomId]) => `${pieceId}@R${roomId}`).join(', ');
  }, [plannedMoves]);

  const groupedPieces = useMemo(() => {
    const groups = new Map<number, PiecePosition[]>();
    piecePositions.forEach((piece) => {
      const list = groups.get(piece.roomId) ?? [];
      list.push(piece);
      groups.set(piece.roomId, list);
    });
    groups.forEach((list) => {
      list.sort((a, b) => pieceOrder.indexOf(a.pieceId) - pieceOrder.indexOf(b.pieceId));
    });
    return groups;
  }, [piecePositions]);

  const refreshState = (state: GameStateHandle) => {
    setSummary(state.summary(0));
    setPiecePositions(state.piecePositions() as PiecePosition[]);
    setCurrentPlayerPieceId(state.currentPlayerPieceId());
  };

  const handlePieceClick = (piece: PiecePosition) => {
    const isMovable = piece.kind === 'stranger' || piece.pieceId === currentPlayerPieceId;
    if (!isMovable) {
      setValidationMessage('You can only move your piece or the strangers.');
      return;
    }
    setValidationMessage(null);
    setSelectedPieceId(piece.pieceId);
  };

  const handleRoomClick = (roomId: number) => {
    if (!selectedPieceId) {
      return;
    }
    setPlannedMoves((prev) => ({
      ...prev,
      [selectedPieceId]: roomId,
    }));
    setSelectedPieceId(null);
    setValidationMessage(null);
  };

  const handleSubmit = () => {
    if (!gameState) {
      return;
    }
    const planned = Object.entries(plannedMoves).map(([pieceId, roomId]) => ({
      pieceId,
      roomId,
    }));
    try {
      gameState.validateTurnPlan(planned as PlannedMove[]);
      gameState.applyTurnPlan(planned as PlannedMove[]);
      refreshState(gameState);
      setPlannedMoves({});
      setSelectedPieceId(null);
      setValidationMessage(null);
    } catch (error) {
      setValidationMessage(String(error));
    }
  };

  const handleCancel = () => {
    setPlannedMoves({});
    setSelectedPieceId(null);
    setValidationMessage(null);
  };

  return (
    <>
      <div className="play-area">
        <div className="board">
          <svg
            viewBox={`0 0 ${boardWidth} ${boardHeight}`}
            role="img"
            aria-label="Kill Doctor Lucky Board Alternate Downstairs"
            preserveAspectRatio="xMidYMid meet"
            style={{ maxWidth: '100%', height: 'auto', width: '100%', display: 'block' }}
          >
            <image href={boardImageHref} width={boardWidth} height={boardHeight} />
            {roomRects.map((room) => {
              const highlightClass =
                selectedPieceId && reachableRooms.size > 0
                  ? reachableRooms.has(room.id)
                    ? 'room-target is-reachable'
                    : 'room-target is-unreachable'
                  : 'room-target';
              return (
                <rect
                  key={room.id}
                  x={room.x1}
                  y={room.y1}
                  width={room.width}
                  height={room.height}
                  className={highlightClass}
                  cursor="pointer"
                  onClick={() => handleRoomClick(room.id)}
                  aria-label={room.name ?? `Room ${room.id}`}
                />
              );
            })}
            {[...groupedPieces.entries()].map(([roomId, pieces]) => {
              const room = roomById.get(roomId);
              if (!room) {
                return null;
              }
              return pieces.map((piece) => {
                const slotIndex = Math.max(0, pieceOrder.indexOf(piece.pieceId));
                const column = slotIndex % 3;
                const row = Math.floor(slotIndex / 3);
                const slotX =
                  room.x1 + (room.width - gridWidth) / 2 + column * (pieceSize + pieceGap);
                const slotY =
                  room.y1 + (room.height - gridHeight) / 2 + row * (pieceSize + pieceGap);
                const centerX = slotX + pieceSize / 2;
                const centerY = slotY + pieceSize / 2;
                const isSelected = selectedPieceId === piece.pieceId;
                const isMovable = piece.kind === 'stranger' || piece.pieceId === currentPlayerPieceId;
                const className = [
                  'piece',
                  isSelected ? 'is-selected' : '',
                  isMovable ? 'is-movable' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                const commonProps = {
                  key: `${piece.pieceId}-${roomId}`,
                  className,
                  fill: pieceColors[piece.pieceId] ?? '#777777',
                  onClick: (event: MouseEvent<SVGElement>) => {
                    event.stopPropagation();
                    handlePieceClick(piece);
                  },
                  role: 'button',
                  'aria-label': piece.pieceId,
                };
                if (piece.kind === 'doctor') {
                  return <circle {...commonProps} cx={centerX} cy={centerY} r={pieceSize / 2} />;
                }
                if (piece.kind === 'stranger') {
                  return (
                    <polygon
                      {...commonProps}
                      points={hexPoints(centerX, centerY, pieceSize / 2)}
                    />
                  );
                }
                return (
                  <rect
                    {...commonProps}
                    x={slotX}
                    y={slotY}
                    width={pieceSize}
                    height={pieceSize}
                    rx={3}
                  />
                );
              });
            })}
          </svg>
        </div>
        <aside className="turn-panel">
          <h4>Turn Planner</h4>
          <p className="turn-panel__status">Current player: {currentPlayerPieceId || '...'}</p>
          <p className="turn-panel__plan">{plannedMoveSummary}</p>
          {selectedPieceId ? (
            <p className="turn-panel__selection">Select a room for {selectedPieceId}.</p>
          ) : (
            <p className="turn-panel__selection">Select a piece to plan a move.</p>
          )}
          {validationMessage ? (
            <p className="turn-panel__error" role="alert">
              {validationMessage}
            </p>
          ) : null}
          <div className="turn-panel__buttons">
            <button type="button" onClick={handleSubmit}>
              Submit
            </button>
            <button type="button" onClick={handleCancel}>
              Cancel
            </button>
            <button type="button" onClick={() => setIsInfoOpen((prev) => !prev)}>
              Info
            </button>
          </div>
          {isInfoOpen ? (
            <div className="turn-panel__info">
              <p>
                Plan moves by clicking your piece or a stranger, then a destination room. You can
                update a planned move by clicking the same piece again.
              </p>
              <p>Submit to validate and apply moves, or cancel to clear the plan.</p>
            </div>
          ) : null}
        </aside>
      </div>
      <pre className="game-summary">{summary}</pre>
    </>
  );
}

export default PlayArea;
