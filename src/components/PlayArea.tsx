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

const boardLayout = boardData as BoardLayout;
const boardWidth = 1480;
const boardHeight = 965;
const boardImageHref = `${import.meta.env.BASE_URL}${boardLayout.ImagePath.replace(/^\//, '')}`;

function PlayArea() {
  return (
    <div className="board">
      <svg
        viewBox={`0 0 ${boardWidth} ${boardHeight}`}
        role="img"
        aria-label="Kill Doctor Lucky Board Alternate Downstairs"
        preserveAspectRatio="xMidYMid meet"
        style={{ maxWidth: '100%', height: 'auto', width: '100%', display: 'block' }}
      >
        <image href={boardImageHref} width={boardWidth} height={boardHeight} />
        {boardLayout.Rooms.map((room) => {
          if (room.Coords.length !== 4) {
            return null;
          }
          const [x1, y1, x2, y2] = room.Coords;
          return (
            <rect
              key={room.Id}
              x={x1}
              y={y1}
              width={x2 - x1}
              height={y2 - y1}
              fill="transparent"
              cursor="pointer"
              aria-label={room.Name ?? `Room ${room.Id}`}
            />
          );
        })}
      </svg>
    </div>
  );
}

export default PlayArea;
