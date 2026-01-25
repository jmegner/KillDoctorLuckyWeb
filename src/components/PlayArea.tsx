import { useState, type MouseEvent } from 'react';
import { newDefaultGameState, type GameStateHandle } from '@/KdlRust/pkg/kill_doctor_lucky_rust';
import boardData from '../data/boards/BoardAltDown.json';

type PieceId = 'doctor' | 'player1' | 'player2' | 'stranger1' | 'stranger2';

type TurnPlanEntry = {
  pieceId: PieceId;
  roomId: number;
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

const pieceOrder: PieceId[] = ['doctor', 'player1', 'player2', 'stranger1', 'stranger2'];

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
  doctor: { label: 'Dr', shape: 'circle', color: '#1b1b1b', textColor: '#fefbf5', showLabel: false },
  player1: { label: 'P1', shape: 'square', color: '#d93b30', textColor: '#fefbf5', showLabel: true },
  player2: { label: 'P2', shape: 'square', color: '#3a7d44', textColor: '#fefbf5', showLabel: true },
  stranger1: { label: 'S1', shape: 'hex', color: '#f08a24', textColor: '#1b1b1b', showLabel: true },
  stranger2: { label: 'S2', shape: 'hex', color: '#f2c14e', textColor: '#1b1b1b', showLabel: true },
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
    return { cols: 2, rows: 1, slots: [{ col: 0, row: 0 }, { col: 1, row: 0 }] };
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

function PlayArea() {
  const [gameState] = useState<GameStateHandle | null>(() => {
    try {
      return newDefaultGameState();
    } catch {
      return null;
    }
  });
  const [selectedPieceId, setSelectedPieceId] = useState<PieceId | null>(null);
  const [plannedMoves, setPlannedMoves] = useState<Partial<Record<PieceId, number>>>({});
  const [planOrder, setPlanOrder] = useState<PieceId[]>([]);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [, setTurnCounter] = useState(0);
  const summary = gameState ? gameState.summary(0) : 'Failed to create game state.';
  const currentPlayerPieceId = gameState
    ? (gameState.currentPlayerPieceId() as PieceId)
    : null;
  const pieceRooms = gameState ? gameState.piecePositions() : null;
  const reachableRooms =
    gameState && selectedPieceId ? gameState.reachableRooms(selectedPieceId, 1) : null;
  const reachableRoomSet = new Set(reachableRooms ?? []);
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
  const renderPieces = (() => {
    const pieces: Array<{
      pieceId: PieceId;
      roomId: number;
      x: number;
      y: number;
      size: number;
    }> = [];

    boardRooms.forEach((room) => {
      const piecesHere = pieceOrder.filter((pieceId) => pieceRoomMap.get(pieceId) === room.id);
      if (piecesHere.length === 0) {
        return;
      }
      const roomRect = getRoomRect(room.coords);
      const { size, positions } = getPiecePositionsInRoom(piecesHere.length, roomRect);
      piecesHere.forEach((pieceId, index) => {
        const placement = positions[index];
        if (!placement) {
          return;
        }
        pieces.push({ pieceId, roomId: room.id, x: placement.x, y: placement.y, size });
      });
    });

    return pieces;
  })();

  const isPieceSelectable = (pieceId: PieceId) =>
    currentPlayerPieceId !== null &&
    (pieceId === currentPlayerPieceId || pieceId === 'stranger1' || pieceId === 'stranger2');

  const handlePieceClick = (pieceId: PieceId) => {
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

  const handleRoomClick = (roomId: number) => {
    if (!selectedPieceId) {
      setValidationMessage('Select a piece, then choose a destination room.');
      return;
    }
    setPlannedMoves((prev) => ({ ...prev, [selectedPieceId]: roomId }));
    setPlanOrder((prev) => (prev.includes(selectedPieceId) ? prev : [...prev, selectedPieceId]));
    setSelectedPieceId(null);
    setValidationMessage(null);
  };

  const handleSubmit = () => {
    if (!gameState) {
      return;
    }
    const planEntries = planOrder
      .map((pieceId) => {
        const roomId = plannedMoves[pieceId];
        if (roomId === undefined) {
          return null;
        }
        return { pieceId, roomId };
      })
      .filter((entry): entry is TurnPlanEntry => entry !== null);
    const validation = gameState.validateTurnPlan(JSON.stringify(planEntries));
    if (validation) {
      setValidationMessage(validation);
      return;
    }
    const applyError = gameState.applyTurnPlan(JSON.stringify(planEntries));
    if (applyError) {
      setValidationMessage(applyError);
      return;
    }
    setPlannedMoves({});
    setPlanOrder([]);
    setSelectedPieceId(null);
    setValidationMessage(null);
    setTurnCounter((prev) => prev + 1);
  };

  const handleCancel = () => {
    setPlannedMoves({});
    setPlanOrder([]);
    setSelectedPieceId(null);
    setValidationMessage(null);
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

  const selectedLabel = selectedPieceId ? pieceConfig[selectedPieceId].label : 'None';
  const selectedSuffix =
    selectedPieceId && plannedMoves[selectedPieceId] !== undefined ? ' (update)' : '';

  if (!gameState) {
    return <div className="play-area-error">Failed to create game state.</div>;
  }

  return (
    <section className="play-area">
      <div className="board-shell">
        <div className="board">
          <svg
            viewBox={`0 0 ${boardWidth} ${boardHeight}`}
            role="img"
            aria-label="Kill Doctor Lucky Board Alternate Downstairs"
            preserveAspectRatio="xMidYMid meet"
          >
            <image href={boardImageHref} width={boardWidth} height={boardHeight} />
            <g className="room-layer">
              {boardRooms.map((room) => {
                if (room.coords.length !== 4) {
                  return null;
                }
                const [x1, y1, x2, y2] = room.coords;
                const isReachable = selectedPieceId ? reachableRoomSet.has(room.id) : false;
                const roomClassName = selectedPieceId
                  ? isReachable
                    ? 'room-hit room-hit--reachable'
                    : 'room-hit room-hit--blocked'
                  : 'room-hit';
                return (
                  <rect
                    key={room.id}
                    x={x1}
                    y={y1}
                    width={x2 - x1}
                    height={y2 - y1}
                    className={roomClassName}
                    onClick={() => handleRoomClick(room.id)}
                    aria-label={room.name ?? `Room ${room.id}`}
                  />
                );
              })}
            </g>
            <g className="piece-layer">
              {renderPieces.map((piece) => {
                const config = pieceConfig[piece.pieceId];
                const isSelected = selectedPieceId === piece.pieceId;
                const selectable = isPieceSelectable(piece.pieceId);
                const className = [
                  'piece',
                  `piece--${config.shape}`,
                  isSelected ? 'piece--selected' : '',
                  selectable ? 'piece--movable' : 'piece--locked',
                ]
                  .filter(Boolean)
                  .join(' ');
                const labelSize = Math.min(piece.size * 0.5, 18);

                const commonProps = {
                  className,
                  fill: config.color,
                  onClick: (event: MouseEvent<SVGElement>) => {
                    event.stopPropagation();
                    handlePieceClick(piece.pieceId);
                  },
                  'aria-label': `${config.label} piece`,
                };

                let shape;
                if (config.shape === 'circle') {
                  shape = (
                    <circle
                      cx={piece.x + piece.size / 2}
                      cy={piece.y + piece.size / 2}
                      r={piece.size / 2}
                      {...commonProps}
                    />
                  );
                } else if (config.shape === 'square') {
                  shape = (
                    <rect
                      x={piece.x}
                      y={piece.y}
                      width={piece.size}
                      height={piece.size}
                      rx={3}
                      {...commonProps}
                    />
                  );
                } else {
                  shape = (
                    <polygon
                      points={getHexPoints(piece.x, piece.y, piece.size)}
                      {...commonProps}
                    />
                  );
                }

                return (
                  <g key={piece.pieceId}>
                    {shape}
                    {config.showLabel && (
                      <text
                        className="piece-label"
                        x={piece.x + piece.size / 2}
                        y={piece.y + piece.size / 2}
                        fontSize={labelSize}
                        fill={config.textColor}
                      >
                        {config.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>
      <aside className="planner-panel">
        <div className="planner-header">
          <div>
            <p className="planner-kicker">Turn Planner</p>
            <h2 className="planner-title">
              Current: {currentPlayerPieceId ? pieceConfig[currentPlayerPieceId].label : '??'}
            </h2>
          </div>
          <button className="planner-info-button" onClick={() => setInfoOpen((prev) => !prev)}>
            {infoOpen ? 'Close' : 'Info'}
          </button>
        </div>
        <div className="planner-line">
          <span className="planner-label">Selected</span>
          <span className="planner-value">{selectedLabel + selectedSuffix}</span>
        </div>
        <div className="planner-line">
          <span className="planner-label">Planned</span>
          <span className="planner-value">{planSummary}</span>
        </div>
        <div className="planner-actions">
          <button className="planner-button planner-button--primary" onClick={handleSubmit}>
            Submit
          </button>
          <button className="planner-button" onClick={handleCancel}>
            Cancel
          </button>
        </div>
        {validationMessage && <p className="planner-error">{validationMessage}</p>}
        {infoOpen && (
          <div className="planner-info">
            <h3>How to plan a turn</h3>
            <p>Select your piece or a stranger, then click a room to set a destination.</p>
            <p>Click a planned piece again to update its destination. Submit validates the plan.</p>
            <p>Opponent pieces and the doctor cannot be moved.</p>
          </div>
        )}
      </aside>
      <div className="play-area-summary">
        <pre className="game-summary">{summary}</pre>
      </div>
    </section>
  );
}

export default PlayArea;
