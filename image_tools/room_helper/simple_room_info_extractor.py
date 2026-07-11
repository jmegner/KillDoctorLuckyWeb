from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import argparse
import json
from pathlib import Path
import sys
import tkinter as tk
from tkinter import filedialog, messagebox

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_IMAGE_DIR = REPO_ROOT / "public"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "src" / "data" / "boards"
IMAGE_FILE_TYPES = (
    ("Image files", "*.png *.jpg *.jpeg"),
    ("All files", "*.*"),
)

MIN_ROOM_AREA = 1000
MIN_LABEL_BLOB_AREA = 80
MAX_LABEL_BLOB_AREA = 5000
DARK_LABEL_THRESHOLD = 95
WALL_THRESHOLD = 48
DOORWAY_GAP_TOLERANCE = 2

DIGIT_TEMPLATES = {
    "0": (
        "...#####..",
        ".########.",
        ".###...###",
        "###....###",
        "###.....##",
        "##......##",
        "##......##",
        "##......##",
        "##......##",
        "###.....##",
        "###.....##",
        ".##....###",
        ".########.",
        "..######..",
    ),
    "1": (
        "...####...",
        "#######...",
        "#######...",
        "##..###...",
        "....###...",
        "....###...",
        "....###...",
        "....###...",
        "....###...",
        "....###...",
        "....###...",
        "....###...",
        "##########",
        "##########",
    ),
    "2": (
        "..######..",
        ".#########",
        "###....###",
        ".#.....###",
        ".......###",
        ".......###",
        "......###.",
        "....####..",
        "...####...",
        "..####....",
        ".###......",
        "###.......",
        "##########",
        "##########",
    ),
    "3": (
        "..######..",
        ".########.",
        ".##...####",
        ".......###",
        ".......###",
        "......###.",
        "...#####..",
        "...######.",
        ".......###",
        "........##",
        ".#......##",
        "###....###",
        ".#########",
        "..#######.",
    ),
    "4": (
        ".....###..",
        "....####..",
        "....####..",
        "...#####..",
        "..###.##..",
        "..##..##..",
        ".###..##..",
        ".##...##..",
        "###...##..",
        "##########",
        "##########",
        "......###.",
        "......##..",
        "......##..",
    ),
    "5": (
        ".#########",
        ".#########",
        ".###......",
        ".##.......",
        ".##.......",
        ".##.#####.",
        "##########",
        "####...###",
        ".......###",
        ".......###",
        ".#.....###",
        "###....###",
        "##########",
        ".########.",
    ),
    "6": (
        "...######.",
        "..########",
        ".###...##.",
        "###.......",
        "###.......",
        "###.#####.",
        "##########",
        "####...###",
        "###....###",
        "###.....##",
        "###....###",
        ".###...###",
        ".#########",
        "..#######.",
    ),
    "7": (
        "##########",
        "##########",
        ".......###",
        ".......###",
        "......###.",
        "......###.",
        ".....###..",
        ".....###..",
        "....###...",
        "....###...",
        "...####...",
        "...###....",
        "..####....",
        "..###.....",
    ),
    "8": (
        "..######..",
        ".########.",
        ".###..####",
        "###....###",
        ".##....###",
        ".###..###.",
        "..#######.",
        ".#########",
        "####...###",
        "###.....##",
        "###.....##",
        "###....###",
        "##########",
        ".########.",
    ),
    "9": (
        "..######..",
        ".########.",
        "####..####",
        "###....###",
        "###....###",
        "###....###",
        "###...####",
        ".#########",
        "..####..##",
        ".......###",
        ".......###",
        "###...###.",
        ".########.",
        "..######..",
    ),
}

NUMBER_WORDS = {
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
    9: "nine",
    10: "ten",
    11: "eleven",
    12: "twelve",
    13: "thirteen",
    14: "fourteen",
    15: "fifteen",
    16: "sixteen",
    17: "seventeen",
    18: "eighteen",
    19: "nineteen",
    20: "twenty",
    21: "twenty one",
    22: "twenty two",
    23: "twenty three",
    24: "twenty four",
    25: "twenty five",
    26: "twenty six",
    27: "twenty seven",
    28: "twenty eight",
    29: "twenty nine",
    30: "thirty",
}


@dataclass
class Component:
    color: tuple[int, int, int]
    area: int
    min_x: int
    min_y: int
    max_x: int
    max_y: int


@dataclass
class RoomInfo:
    id: int
    coords: tuple[int, int, int, int]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract KDL room rectangles, adjacency, and visibility from a simple color-coded board image."
    )
    parser.add_argument("image_path", type=Path, nargs="?", help="Board image path. Opens a file dialog when omitted.")
    parser.add_argument("-o", "--output", type=Path, help="Output JSON path. Defaults to src/data/boards/Board<Name>.json.")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing output file without prompting.")
    return parser.parse_args()


def choose_image_path(provided_path: Path | None = None) -> Path | None:
    if provided_path is not None:
        return provided_path

    root = tk.Tk()
    root.withdraw()
    initial_dir = DEFAULT_IMAGE_DIR if DEFAULT_IMAGE_DIR.exists() else Path.cwd()
    selected_path = filedialog.askopenfilename(
        title="Open simple KDL board image",
        initialdir=str(initial_dir),
        filetypes=IMAGE_FILE_TYPES,
    )
    root.destroy()
    return Path(selected_path) if selected_path else None


def is_exact_room_color(color: tuple[int, int, int]) -> bool:
    r, g, b = color
    return r != g or g != b


def is_dark(color: tuple[int, int, int]) -> bool:
    return max(color) < DARK_LABEL_THRESHOLD


def is_wall(color: tuple[int, int, int]) -> bool:
    return max(color) <= WALL_THRESHOLD


def find_room_components(image: Image.Image) -> list[Component]:
    width, height = image.size
    pixels = image.load()
    visited = bytearray(width * height)
    components: list[Component] = []

    for y in range(height):
        for x in range(width):
            index = y * width + x
            if visited[index]:
                continue
            color = pixels[x, y]
            if not is_exact_room_color(color):
                visited[index] = 1
                continue

            queue = deque([(x, y)])
            visited[index] = 1
            area = 0
            min_x = max_x = x
            min_y = max_y = y
            while queue:
                cx, cy = queue.popleft()
                area += 1
                min_x = min(min_x, cx)
                max_x = max(max_x, cx)
                min_y = min(min_y, cy)
                max_y = max(max_y, cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if not (0 <= nx < width and 0 <= ny < height):
                        continue
                    next_index = ny * width + nx
                    if visited[next_index] or pixels[nx, ny] != color:
                        continue
                    visited[next_index] = 1
                    queue.append((nx, ny))

            if area >= MIN_ROOM_AREA:
                components.append(Component(color, area, min_x, min_y, max_x, max_y))

    return components


def find_dark_blobs(image: Image.Image, bounds: tuple[int, int, int, int]) -> list[tuple[int, int, int, int, int]]:
    min_x, min_y, max_x, max_y = bounds
    width, height = image.size
    pixels = image.load()
    left = max(0, min_x + 4)
    top = max(0, min_y + 4)
    right = min(width - 1, max_x - 4)
    bottom = min(height - 1, max_y - 4)
    visited: set[tuple[int, int]] = set()
    blobs: list[tuple[int, int, int, int, int]] = []

    for y in range(top, bottom + 1):
        for x in range(left, right + 1):
            if (x, y) in visited or not is_dark(pixels[x, y]):
                continue
            queue = deque([(x, y)])
            visited.add((x, y))
            area = 0
            blob_min_x = blob_max_x = x
            blob_min_y = blob_max_y = y
            while queue:
                cx, cy = queue.popleft()
                area += 1
                blob_min_x = min(blob_min_x, cx)
                blob_max_x = max(blob_max_x, cx)
                blob_min_y = min(blob_min_y, cy)
                blob_max_y = max(blob_max_y, cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if not (left <= nx <= right and top <= ny <= bottom):
                        continue
                    if (nx, ny) in visited or not is_dark(pixels[nx, ny]):
                        continue
                    visited.add((nx, ny))
                    queue.append((nx, ny))
            if MIN_LABEL_BLOB_AREA <= area <= MAX_LABEL_BLOB_AREA:
                blobs.append((blob_min_x, blob_min_y, blob_max_x, blob_max_y, area))

    return blobs


def template_bits(template: tuple[str, ...]) -> list[int]:
    return [1 if char == "#" else 0 for row in template for char in row]


TEMPLATE_BITS = {digit: template_bits(template) for digit, template in DIGIT_TEMPLATES.items()}


def classify_digit(image: Image.Image, blob: tuple[int, int, int, int, int]) -> tuple[str, float]:
    min_x, min_y, max_x, max_y, _area = blob
    crop = image.crop((min_x, min_y, max_x + 1, max_y + 1)).convert("L").resize((10, 14), Image.Resampling.BILINEAR)
    bits = [1 if crop.getpixel((x, y)) < DARK_LABEL_THRESHOLD else 0 for y in range(14) for x in range(10)]
    best_digit = "?"
    best_score = 10**9
    for digit, template in TEMPLATE_BITS.items():
        score = sum(1 for actual, expected in zip(bits, template) if actual != expected)
        if score < best_score:
            best_digit = digit
            best_score = score
    return best_digit, best_score / len(bits)


def read_room_id(image: Image.Image, component: Component) -> int:
    blobs = find_dark_blobs(image, (component.min_x, component.min_y, component.max_x, component.max_y))
    room_height = component.max_y - component.min_y + 1
    plausible = [
        blob
        for blob in blobs
        if 10 <= blob[2] - blob[0] + 1 <= 60
        and 16 <= blob[3] - blob[1] + 1 <= min(90, max(20, room_height // 2))
    ]
    if not plausible:
        raise ValueError(f"No room number found in room bounds {component_bounds(component)}")

    plausible.sort(key=lambda blob: (blob[1], blob[0]))
    first_line_y = plausible[0][1]
    line = [blob for blob in plausible if abs(blob[1] - first_line_y) <= 8]
    line.sort(key=lambda blob: blob[0])

    digits = []
    scores = []
    for blob in line:
        digit, score = classify_digit(image, blob)
        digits.append(digit)
        scores.append(score)
    if any(digit == "?" for digit in digits) or any(score > 0.32 for score in scores):
        raise ValueError(f"Could not confidently read room number in room bounds {component_bounds(component)}")
    return int("".join(digits))


def component_bounds(component: Component) -> tuple[int, int, int, int]:
    return (component.min_x, component.min_y, component.max_x, component.max_y)


def build_room_label_map(size: tuple[int, int], rooms: list[RoomInfo]) -> list[int]:
    width, height = size
    labels = [0] * (width * height)
    for room in rooms:
        min_x, min_y, max_x, max_y = room.coords
        for y in range(min_y, max_y + 1):
            offset = y * width
            for x in range(min_x, max_x + 1):
                labels[offset + x] = room.id
    return labels


def build_passable_map(image: Image.Image) -> list[bool]:
    width, height = image.size
    pixels = image.load()
    passable = [False] * (width * height)
    for y in range(height):
        for x in range(width):
            passable[y * width + x] = not is_wall(pixels[x, y])

    if DOORWAY_GAP_TOLERANCE <= 0:
        return passable

    # Doorway art sometimes leaves a 1-2px dark sliver. Bridge tiny wall runs that
    # are directly between passable pixels on the same row or column.
    for y in range(height):
        x = 0
        while x < width:
            index = y * width + x
            if passable[index]:
                x += 1
                continue
            start = x
            while x < width and not passable[y * width + x]:
                x += 1
            end = x - 1
            if end - start + 1 <= DOORWAY_GAP_TOLERANCE and start > 0 and x < width:
                if passable[y * width + start - 1] and passable[y * width + x]:
                    for fill_x in range(start, x):
                        passable[y * width + fill_x] = True

    for x in range(width):
        y = 0
        while y < height:
            index = y * width + x
            if passable[index]:
                y += 1
                continue
            start = y
            while y < height and not passable[y * width + x]:
                y += 1
            end = y - 1
            if end - start + 1 <= DOORWAY_GAP_TOLERANCE and start > 0 and y < height:
                if passable[(start - 1) * width + x] and passable[y * width + x]:
                    for fill_y in range(start, y):
                        passable[fill_y * width + x] = True

    return passable


def compute_adjacency(size: tuple[int, int], rooms: list[RoomInfo], labels: list[int], passable: list[bool]) -> dict[int, list[int]]:
    width, height = size
    room_ids = {room.id for room in rooms}
    adjacency: dict[int, set[int]] = {room.id: set() for room in rooms}

    for room in rooms:
        visited = bytearray(width * height)
        queue: deque[tuple[int, int]] = deque()
        min_x, min_y, max_x, max_y = room.coords
        for y in range(min_y, max_y + 1):
            for x in range(min_x, max_x + 1):
                index = y * width + x
                if passable[index] and labels[index] == room.id:
                    visited[index] = 1
                    queue.append((x, y))

        while queue:
            cx, cy = queue.popleft()
            for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                if not (0 <= nx < width and 0 <= ny < height):
                    continue
                index = ny * width + nx
                if visited[index] or not passable[index]:
                    continue
                label = labels[index]
                if label in room_ids and label != room.id:
                    adjacency[room.id].add(label)
                    continue
                visited[index] = 1
                queue.append((nx, ny))

    return {room_id: sorted(values) for room_id, values in adjacency.items()}


def compute_visibility(size: tuple[int, int], rooms: list[RoomInfo], labels: list[int], passable: list[bool]) -> dict[int, list[int]]:
    width, height = size
    visible: dict[int, set[int]] = {room.id: set() for room in rooms}

    def add_segment(room_ids: set[int]) -> None:
        if len(room_ids) < 2:
            return
        for room_id in room_ids:
            visible[room_id].update(other for other in room_ids if other != room_id)

    for y in range(height):
        x = 0
        while x < width:
            while x < width and not passable[y * width + x]:
                x += 1
            segment_rooms: set[int] = set()
            while x < width and passable[y * width + x]:
                label = labels[y * width + x]
                if label:
                    segment_rooms.add(label)
                x += 1
            add_segment(segment_rooms)

    for x in range(width):
        y = 0
        while y < height:
            while y < height and not passable[y * width + x]:
                y += 1
            segment_rooms = set()
            while y < height and passable[y * width + x]:
                label = labels[y * width + x]
                if label:
                    segment_rooms.add(label)
                y += 1
            add_segment(segment_rooms)

    return {room_id: sorted(values) for room_id, values in visible.items()}


def board_name_from_image(image_path: Path) -> str:
    stem = image_path.stem
    if stem.lower().startswith("board") and len(stem) > len("Board"):
        return stem[len("Board") :]
    return stem[:1].upper() + stem[1:]


def number_to_words(value: int) -> str:
    if value in NUMBER_WORDS:
        return NUMBER_WORDS[value]
    return str(value)


def build_board_json(image_path: Path, image: Image.Image, rooms: list[RoomInfo]) -> dict[str, object]:
    width, height = image.size
    name = board_name_from_image(image_path)
    json_name = f"Board{name}"
    labels = build_room_label_map((width, height), rooms)
    passable = build_passable_map(image)
    adjacent = compute_adjacency((width, height), rooms, labels, passable)
    visible = compute_visibility((width, height), rooms, labels, passable)

    return {
        "ImagePath": f"/{image_path.name}",
        "JsonName": json_name,
        "Name": name,
        "Description": f"Kill Doctor Lucky Board {name}",
        "UiLayout": {
            "BoardWidth": width,
            "BoardHeight": height,
            "BoardOverlayFontSizePx": 27,
            "PieceSizeTarget": 80,
            "WinnerOverlayFontSizePx": 52,
            "RoomDistanceBoxWidth": 30,
            "RoomDistanceBoxHeight": 30,
            "RoomDistanceBoxTopRatio": 0.2,
            "ActionDisplayBounds": {
                "MinXAfterRoomId": -1,
                "MaxXBeforeRoomId": -1,
                "MinYBelowRoomId": -1,
            },
        },
        "PlayerStartRoomIds": [1],
        "DoctorStartRoomIds": [1],
        "CatStartRoomIds": [1],
        "DogStartRoomIds": [1],
        "Wings": [],
        "Rooms": [
            {
                "Id": str(room.id),
                "Name": number_to_words(room.id),
                "Coords": list(room.coords),
                "Adjacent": adjacent[room.id],
                "Visible": visible[room.id],
            }
            for room in sorted(rooms, key=lambda room: room.id)
        ],
    }


def default_output_path(image_path: Path) -> Path:
    name = board_name_from_image(image_path)
    return DEFAULT_OUTPUT_DIR / f"Board{name}.json"


def default_rooms_jsonl_path(image_path: Path) -> Path:
    return image_path.with_name(f"{image_path.stem}_rooms.jsonl")


def confirm_overwrite(paths: list[Path]) -> bool:
    existing_paths = [path for path in paths if path.exists()]
    if not existing_paths:
        return True
    root = tk.Tk()
    root.withdraw()
    path_list = "\n".join(str(path) for path in existing_paths)
    result = messagebox.askyesno("Overwrite output?", f"These output files already exist:\n\n{path_list}\n\nOverwrite them?")
    root.destroy()
    return result


def write_rooms_jsonl(path: Path, rooms: list[RoomInfo]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for room in sorted(rooms, key=lambda room: room.id):
            handle.write(json.dumps({"id": str(room.id), "coords": list(room.coords)}, ensure_ascii=True))
            handle.write("\n")


def is_simple_json_value(value: object) -> bool:
    return value is None or isinstance(value, str | int | float | bool)


def format_board_json(value: object, indent_level: int = 0) -> str:
    indent = " " * indent_level
    child_indent = " " * (indent_level + 2)

    if isinstance(value, dict):
        if not value:
            return "{}"
        lines = ["{"]
        items = list(value.items())
        for index, (key, item_value) in enumerate(items):
            suffix = "," if index < len(items) - 1 else ""
            lines.append(
                f"{child_indent}{json.dumps(key, ensure_ascii=True)}: "
                f"{format_board_json(item_value, indent_level + 2)}{suffix}"
            )
        lines.append(f"{indent}}}")
        return "\n".join(lines)

    if isinstance(value, list):
        if not value or all(is_simple_json_value(item) for item in value):
            return json.dumps(value, ensure_ascii=True)
        lines = ["["]
        for index, item in enumerate(value):
            suffix = "," if index < len(value) - 1 else ""
            lines.append(f"{child_indent}{format_board_json(item, indent_level + 2)}{suffix}")
        lines.append(f"{indent}]")
        return "\n".join(lines)

    return json.dumps(value, ensure_ascii=True)


def show_done(board_json_path: Path, rooms_jsonl_path: Path, room_count: int, warnings: list[str]) -> None:
    root = tk.Tk()
    root.withdraw()
    message = f"Wrote {board_json_path}\nWrote {rooms_jsonl_path}\n\nRooms: {room_count}"
    if warnings:
        message += "\n\nWarnings:\n" + "\n".join(warnings)
    messagebox.showinfo("Simple Room Info Extractor", message)
    root.destroy()


def extract_rooms(image: Image.Image) -> list[RoomInfo]:
    components = find_room_components(image)
    rooms: list[RoomInfo] = []
    seen_ids: set[int] = set()
    for component in components:
        room_id = read_room_id(image, component)
        if room_id in seen_ids:
            raise ValueError(f"Duplicate room id {room_id} found")
        seen_ids.add(room_id)
        rooms.append(RoomInfo(room_id, component_bounds(component)))
    return rooms


def main() -> int:
    args = parse_args()
    image_path = choose_image_path(args.image_path)
    if image_path is None:
        return 0

    image_path = image_path.resolve()
    if image_path.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
        raise ValueError("Input image must be a PNG or JPG file.")
    with Image.open(image_path) as loaded:
        image = loaded.convert("RGB")

    rooms = extract_rooms(image)
    if not rooms:
        raise ValueError("No rooms were found.")

    output_path = (args.output or default_output_path(image_path)).resolve()
    rooms_jsonl_path = default_rooms_jsonl_path(image_path).resolve()
    if not args.force and not confirm_overwrite([output_path, rooms_jsonl_path]):
        return 0
    output_path.parent.mkdir(parents=True, exist_ok=True)

    board_json = build_board_json(image_path, image, rooms)
    output_path.write_text(format_board_json(board_json) + "\n", encoding="utf-8")
    write_rooms_jsonl(rooms_jsonl_path, rooms)

    warnings: list[str] = []
    ids = sorted(room.id for room in rooms)
    expected_ids = list(range(1, len(ids) + 1))
    if ids != expected_ids:
        warnings.append(f"Room ids are {ids}; expected contiguous ids {expected_ids}.")

    if args.image_path is None:
        show_done(output_path, rooms_jsonl_path, len(rooms), warnings)
    else:
        print(f"Wrote {output_path}")
        print(f"Wrote {rooms_jsonl_path}")
        print(f"Rooms: {len(rooms)}")
        for warning in warnings:
            print(f"Warning: {warning}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        if not sys.stdout or not sys.stdout.isatty():
            root = tk.Tk()
            root.withdraw()
            messagebox.showerror("Simple Room Info Extractor Error", str(exc))
            root.destroy()
        raise
