from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import argparse
import json
import math
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from PIL import Image, ImageTk


ROOM_OUTLINE_COLOR = "#FF00FF"
ROOM_FILL_COLOR = "#FF00FF"
ROOM_SELECTED_COLOR = "#00FF00"
ROOM_PREVIEW_COLOR = "#FF0000"
ROOM_LABEL_COLOR = "#FFFFFF"
ROOM_LABEL_BG = "#000000"
MIN_ZOOM = 0.2
MAX_ZOOM = 6.0
ZOOM_STEP = 1.15
SHIFT_MASK = 0x0001
CONTROL_MASK = 0x0004
WHEEL_PAN_UNITS = 1
HQ_RENDER_DELAY_MS = 90
NUDGE_STEP = 0.5
MIN_ROOM_SIZE = 0.5
DEFAULT_IMAGE_DIR = Path(__file__).resolve().parents[2] / "public"
IMAGE_FILE_TYPES = (
    ("Image files", "*.png *.jpg *.jpeg *.gif *.bmp *.webp"),
    ("All files", "*.*"),
)


@dataclass
class Room:
    id: str
    min_x: float
    min_y: float
    max_x: float
    max_y: float

    @classmethod
    def from_coords(cls, room_id: object, coords: list[object]) -> "Room":
        if len(coords) != 4:
            raise ValueError("coords must contain [minX, minY, maxX, maxY]")
        min_x, min_y, max_x, max_y = (float(value) for value in coords)
        if max_x < min_x:
            min_x, max_x = max_x, min_x
        if max_y < min_y:
            min_y, max_y = max_y, min_y
        return cls(str(room_id), min_x, min_y, max_x, max_y)

    def copy(self) -> "Room":
        return Room(self.id, self.min_x, self.min_y, self.max_x, self.max_y)

    def to_record(self) -> dict[str, object]:
        return {
            "id": self.id,
            "coords": [
                self._json_number(self.min_x),
                self._json_number(self.min_y),
                self._json_number(self.max_x),
                self._json_number(self.max_y),
            ],
        }

    @staticmethod
    def _json_number(value: float) -> int | float:
        if math.isclose(value, round(value), abs_tol=1e-9):
            return int(round(value))
        return round(value, 3)

    @property
    def center(self) -> tuple[float, float]:
        return ((self.min_x + self.max_x) / 2, (self.min_y + self.max_y) / 2)

    def contains(self, x: float, y: float) -> bool:
        return self.min_x <= x <= self.max_x and self.min_y <= y <= self.max_y


class RoomEditDialog:
    def __init__(
        self,
        parent: tk.Tk,
        room: Room,
        image_width: int,
        image_height: int,
        used_ids: set[str],
        on_preview_change: Callable[[Room | None], None] | None = None,
    ) -> None:
        self.result: tuple[str, Room | None] | None = None
        self._room = room.copy()
        self._image_width = image_width
        self._image_height = image_height
        self._used_ids = used_ids
        self._on_preview_change = on_preview_change

        self.window = tk.Toplevel(parent)
        self.window.title("Edit Room")
        self.window.transient(parent)
        self.window.resizable(False, False)
        self.window.protocol("WM_DELETE_WINDOW", self.on_cancel)

        frame = ttk.Frame(self.window, padding=12)
        frame.grid(row=0, column=0, sticky="nsew")

        ttk.Label(frame, text="ID").grid(row=0, column=0, sticky="w", padx=(0, 8), pady=4)
        self.id_var = tk.StringVar(value=room.id)
        self.id_entry = ttk.Entry(frame, textvariable=self.id_var, width=18)
        self.id_entry.grid(row=0, column=1, sticky="ew", pady=4)

        self.min_x_var = self._add_coord_row(frame, 1, "Min X", room.min_x, self._image_width)
        self.min_y_var = self._add_coord_row(frame, 2, "Min Y", room.min_y, self._image_height)
        self.max_x_var = self._add_coord_row(frame, 3, "Max X", room.max_x, self._image_width)
        self.max_y_var = self._add_coord_row(frame, 4, "Max Y", room.max_y, self._image_height)

        ttk.Label(frame, text="Coords").grid(row=5, column=0, sticky="w", padx=(0, 8), pady=4)
        self.coords_var = tk.StringVar()
        self.coords_entry = ttk.Entry(frame, textvariable=self.coords_var, width=38, state="readonly")
        self.coords_entry.grid(row=5, column=1, sticky="ew", pady=4)

        button_row = ttk.Frame(frame)
        button_row.grid(row=6, column=0, columnspan=2, sticky="ew", pady=(12, 0))
        for column in range(3):
            button_row.columnconfigure(column, weight=1)
        ttk.Button(button_row, text="OK", command=self.on_ok).grid(row=0, column=0, padx=3, sticky="ew")
        ttk.Button(button_row, text="Cancel", command=self.on_cancel).grid(row=0, column=1, padx=3, sticky="ew")
        ttk.Button(button_row, text="Delete", command=self.on_delete).grid(row=0, column=2, padx=3, sticky="ew")

        self.window.bind("<Return>", lambda _event: self.on_ok())
        self.window.bind("<Escape>", lambda _event: self.on_cancel())
        self.window.bind("<Home>", self._on_home_submit)
        self.window.bind("<Left>", self._on_arrow_nudge)
        self.window.bind("<Right>", self._on_arrow_nudge)
        self.window.bind("<Up>", self._on_arrow_nudge)
        self.window.bind("<Down>", self._on_arrow_nudge)

        for variable in (self.id_var, self.min_x_var, self.min_y_var, self.max_x_var, self.max_y_var):
            variable.trace_add("write", self._on_fields_changed)

        self._refresh_coords_text()
        self.id_entry.focus_set()
        self.id_entry.selection_range(0, "end")
        self.window.wait_visibility()
        self.window.lift()
        self.window.after_idle(self._emit_preview)

    def _add_coord_row(
        self,
        frame: ttk.Frame,
        row: int,
        label: str,
        value: float,
        size_limit: int,
    ) -> tk.StringVar:
        ttk.Label(frame, text=label).grid(row=row, column=0, sticky="w", padx=(0, 8), pady=4)
        variable = tk.StringVar(value=self._format_coord(value))
        coord_row = ttk.Frame(frame)
        coord_row.grid(row=row, column=1, sticky="ew", pady=4)
        entry = ttk.Entry(coord_row, textvariable=variable, width=18)
        entry.grid(row=0, column=0, sticky="ew")
        ttk.Button(
            coord_row,
            text="-",
            width=3,
            command=lambda: self._nudge_coord(variable, -NUDGE_STEP, size_limit),
        ).grid(row=0, column=1, padx=(4, 2))
        ttk.Button(
            coord_row,
            text="+",
            width=3,
            command=lambda: self._nudge_coord(variable, NUDGE_STEP, size_limit),
        ).grid(row=0, column=2, padx=(2, 0))
        return variable

    def show(self) -> tuple[str, Room | None] | None:
        self.window.wait_window()
        return self.result

    def on_ok(self) -> None:
        updated = self._build_room_from_inputs(show_errors=True)
        if updated is None:
            return
        self.result = ("save", updated)
        self.window.destroy()

    def on_cancel(self) -> None:
        self.result = ("cancel", None)
        self.window.destroy()

    def on_delete(self) -> None:
        self.result = ("delete", None)
        self.window.destroy()

    def get_preview_room(self) -> Room | None:
        return self._build_room_from_inputs(show_errors=False)

    def _on_home_submit(self, _event: tk.Event) -> str:
        self.on_ok()
        return "break"

    def _on_arrow_nudge(self, event: tk.Event) -> str:
        state = int(getattr(event, "state", 0))
        alter_max = bool(state & SHIFT_MASK)
        if event.keysym == "Left":
            self._nudge_coord(self.max_x_var if alter_max else self.min_x_var, -NUDGE_STEP, self._image_width)
            return "break"
        if event.keysym == "Right":
            self._nudge_coord(self.max_x_var if alter_max else self.min_x_var, NUDGE_STEP, self._image_width)
            return "break"
        if event.keysym == "Up":
            self._nudge_coord(self.max_y_var if alter_max else self.min_y_var, -NUDGE_STEP, self._image_height)
            return "break"
        if event.keysym == "Down":
            self._nudge_coord(self.max_y_var if alter_max else self.min_y_var, NUDGE_STEP, self._image_height)
            return "break"
        return ""

    def _nudge_coord(self, variable: tk.StringVar, delta: float, size_limit: int) -> None:
        try:
            current = float(variable.get().strip())
        except ValueError:
            current = 0.0
        max_value = max(0.0, size_limit - NUDGE_STEP)
        next_value = self._snap_to_half(max(0.0, min(max_value, current + delta)))
        variable.set(self._format_coord(next_value))

    @staticmethod
    def _snap_to_half(value: float) -> float:
        return round(value / NUDGE_STEP) * NUDGE_STEP

    @staticmethod
    def _format_coord(value: float) -> str:
        if math.isclose(value, round(value), abs_tol=1e-9):
            return str(int(round(value)))
        return f"{value:.1f}"

    def _on_fields_changed(self, *_args: object) -> None:
        self._refresh_coords_text()
        self._emit_preview()

    def _refresh_coords_text(self) -> None:
        try:
            values = [
                self._format_coord(float(self.min_x_var.get().strip())),
                self._format_coord(float(self.min_y_var.get().strip())),
                self._format_coord(float(self.max_x_var.get().strip())),
                self._format_coord(float(self.max_y_var.get().strip())),
            ]
            self.coords_var.set(f"[{', '.join(values)}]")
        except ValueError:
            self.coords_var.set("[invalid]")

    def _emit_preview(self) -> None:
        if self._on_preview_change is None:
            return
        self._on_preview_change(self._build_room_from_inputs(show_errors=False))

    def _build_room_from_inputs(self, *, show_errors: bool) -> Room | None:
        raw_id = self.id_var.get().strip()
        if not raw_id:
            if show_errors:
                messagebox.showerror("Invalid room id", "Room ID is required.", parent=self.window)
            return None
        if raw_id in self._used_ids:
            if show_errors:
                messagebox.showerror("Duplicate room id", f'Room ID "{raw_id}" already exists.', parent=self.window)
            return None

        try:
            min_x = float(self.min_x_var.get().strip())
            min_y = float(self.min_y_var.get().strip())
            max_x = float(self.max_x_var.get().strip())
            max_y = float(self.max_y_var.get().strip())
        except ValueError:
            if show_errors:
                messagebox.showerror("Invalid coordinates", "Room coordinates must be numbers.", parent=self.window)
            return None

        if max_x < min_x:
            min_x, max_x = max_x, min_x
        if max_y < min_y:
            min_y, max_y = max_y, min_y

        if max_x - min_x < MIN_ROOM_SIZE or max_y - min_y < MIN_ROOM_SIZE:
            if show_errors:
                messagebox.showerror("Invalid rectangle", "Room rectangle must have width and height.", parent=self.window)
            return None

        if not (0 <= min_x < self._image_width and 0 <= max_x < self._image_width):
            if show_errors:
                messagebox.showerror(
                    "X coordinates out of bounds",
                    f"X coordinates must be inside image bounds: 0..{self._image_width - 1}.",
                    parent=self.window,
                )
            return None
        if not (0 <= min_y < self._image_height and 0 <= max_y < self._image_height):
            if show_errors:
                messagebox.showerror(
                    "Y coordinates out of bounds",
                    f"Y coordinates must be inside image bounds: 0..{self._image_height - 1}.",
                    parent=self.window,
                )
            return None

        return Room(raw_id, min_x, min_y, max_x, max_y)


class RoomHelperApp:
    def __init__(self, root: tk.Tk, image_path: Path) -> None:
        self.root = root
        self.root.title("KDL Room Helper")
        self.root.geometry("1200x800")

        self.image_path = image_path.resolve()
        if not self.image_path.exists():
            raise FileNotFoundError(f"Image not found: {self.image_path}")
        self.rooms_path = self.image_path.with_name(f"{self.image_path.stem}_rooms.jsonl")

        self.image_original = Image.open(self.image_path).convert("RGB")
        self.image_width, self.image_height = self.image_original.size

        self.zoom = 1.0
        self.tk_image: ImageTk.PhotoImage | None = None
        self.canvas_image_id: int | None = None
        self.overlay_item_ids: list[int] = []
        self._scaled_width = self.image_width
        self._scaled_height = self.image_height
        self._hq_render_after_id: str | None = None
        self.edit_preview_target: int | None = None
        self.edit_preview_room: Room | None = None
        self.active_edit_dialog: RoomEditDialog | None = None
        self.active_edit_preview_target: int | None = None
        self.drag_start: tuple[float, float] | None = None
        self.drag_preview_room: Room | None = None

        self.rooms = self._load_rooms()
        self.last_created_room_id = self._highest_positive_room_id()

        self.status_var = tk.StringVar()
        self._build_ui()
        self._render_image_and_overlays()
        self._update_status("Ready")

    def _build_ui(self) -> None:
        self.root.rowconfigure(0, weight=1)
        self.root.columnconfigure(0, weight=1)

        outer = ttk.Frame(self.root, padding=6)
        outer.grid(row=0, column=0, sticky="nsew")
        outer.rowconfigure(1, weight=1)
        outer.columnconfigure(0, weight=1)

        toolbar = ttk.Frame(outer)
        toolbar.grid(row=0, column=0, sticky="ew", pady=(0, 6))
        ttk.Button(toolbar, text="Zoom In", command=lambda: self._zoom_canvas(1.0, 1.0, ZOOM_STEP, relative_to_center=True)).pack(
            side="left"
        )
        ttk.Button(
            toolbar,
            text="Zoom Out",
            command=lambda: self._zoom_canvas(1.0, 1.0, 1 / ZOOM_STEP, relative_to_center=True),
        ).pack(side="left", padx=(4, 0))
        ttk.Button(toolbar, text="Reset Zoom", command=self._reset_zoom).pack(side="left", padx=(4, 0))
        ttk.Button(toolbar, text="Save", command=self._save_rooms).pack(side="left", padx=(12, 0))
        ttk.Label(toolbar, text=str(self.rooms_path)).pack(side="left", padx=(12, 0))

        canvas_frame = ttk.Frame(outer)
        canvas_frame.grid(row=1, column=0, sticky="nsew")
        canvas_frame.rowconfigure(0, weight=1)
        canvas_frame.columnconfigure(0, weight=1)

        self.canvas = tk.Canvas(canvas_frame, background="black", highlightthickness=0)
        self.canvas.grid(row=0, column=0, sticky="nsew")

        x_scroll = ttk.Scrollbar(canvas_frame, orient="horizontal", command=self.canvas.xview)
        y_scroll = ttk.Scrollbar(canvas_frame, orient="vertical", command=self.canvas.yview)
        x_scroll.grid(row=1, column=0, sticky="ew")
        y_scroll.grid(row=0, column=1, sticky="ns")
        self.canvas.configure(xscrollcommand=x_scroll.set, yscrollcommand=y_scroll.set)

        status = ttk.Label(outer, textvariable=self.status_var, anchor="w", padding=(2, 4))
        status.grid(row=2, column=0, sticky="ew", pady=(6, 0))

        self.canvas.bind("<ButtonPress-1>", self._on_left_drag_start)
        self.canvas.bind("<B1-Motion>", self._on_left_drag_motion)
        self.canvas.bind("<ButtonRelease-1>", self._on_left_drag_end)
        self.canvas.bind("<Button-3>", self._on_right_click)
        self.canvas.bind("<Control-ButtonPress-1>", self._on_ctrl_pan_start)
        self.canvas.bind("<Control-B1-Motion>", self._on_ctrl_pan_drag)
        self.canvas.bind("<Control-ButtonRelease-1>", self._on_ctrl_pan_end)
        self.canvas.bind("<MouseWheel>", self._on_mouse_wheel)
        self.canvas.bind("<Configure>", self._on_canvas_configure)

        self.root.bind("+", lambda _event: self._zoom_canvas(1.0, 1.0, ZOOM_STEP, relative_to_center=True))
        self.root.bind("-", lambda _event: self._zoom_canvas(1.0, 1.0, 1 / ZOOM_STEP, relative_to_center=True))
        self.root.bind("0", lambda _event: self._reset_zoom())
        self.root.bind_all("<Home>", self._on_global_home_key, add="+")
        self.root.bind_all("<Escape>", self._on_global_escape_key, add="+")

        self.canvas.focus_set()

    def _load_rooms(self) -> list[Room]:
        rooms: list[Room] = []
        if not self.rooms_path.exists():
            return rooms

        for line_number, raw_line in enumerate(self.rooms_path.read_text(encoding="utf-8").splitlines(), start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
                if not isinstance(record, dict):
                    raise ValueError("record is not an object")
                room_id = record.get("id", record.get("Id"))
                coords = record.get("coords", record.get("Coords"))
                if room_id is None or not isinstance(coords, list):
                    raise ValueError("missing id/coords")
                rooms.append(Room.from_coords(room_id, coords))
            except Exception as exc:  # noqa: BLE001
                print(f"Skipping invalid line in {self.rooms_path.name}:{line_number}: {exc}")
        return rooms

    def _save_rooms(self) -> None:
        self.rooms_path.parent.mkdir(parents=True, exist_ok=True)
        with self.rooms_path.open("w", encoding="utf-8", newline="\n") as handle:
            for room in sorted(self.rooms, key=self._room_sort_key):
                handle.write(json.dumps(room.to_record(), ensure_ascii=True))
                handle.write("\n")
        self._update_status(f"Saved {self.rooms_path.name}")

    @staticmethod
    def _room_sort_key(room: Room) -> tuple[int, int | str]:
        try:
            return (0, int(room.id))
        except ValueError:
            return (1, room.id)

    def _render_image_and_overlays(self, *, high_quality: bool = True) -> None:
        self._scaled_width = max(1, int(round(self.image_width * self.zoom)))
        self._scaled_height = max(1, int(round(self.image_height * self.zoom)))
        if high_quality:
            resample = Image.Resampling.LANCZOS if self.zoom >= 1 else Image.Resampling.BILINEAR
        else:
            resample = Image.Resampling.BILINEAR
        scaled = self.image_original.resize((self._scaled_width, self._scaled_height), resample)
        self.tk_image = ImageTk.PhotoImage(scaled)

        if self.canvas_image_id is None:
            self.canvas_image_id = self.canvas.create_image(0, 0, image=self.tk_image, anchor="nw")
        else:
            self.canvas.itemconfigure(self.canvas_image_id, image=self.tk_image)

        self.canvas.configure(scrollregion=(0, 0, self._scaled_width, self._scaled_height))
        self._redraw_overlays()
        self._update_status()

    def _redraw_overlays(self) -> None:
        for item_id in self.overlay_item_ids:
            self.canvas.delete(item_id)
        self.overlay_item_ids.clear()

        display_rooms: list[tuple[tuple[str, int | str], Room, str]] = []
        for index, room in enumerate(self.rooms):
            if self.edit_preview_target == index and self.edit_preview_room is not None:
                display_rooms.append((("room", index), self.edit_preview_room, ROOM_PREVIEW_COLOR))
            else:
                display_rooms.append((("room", index), room, ROOM_OUTLINE_COLOR))
        if self.edit_preview_target is None and self.edit_preview_room is not None:
            display_rooms.append((("preview", "edit"), self.edit_preview_room, ROOM_PREVIEW_COLOR))
        if self.drag_preview_room is not None:
            display_rooms.append((("preview", "drag"), self.drag_preview_room, ROOM_PREVIEW_COLOR))

        for key, room, color in display_rooms:
            width = 3 if key[0] == "preview" or color == ROOM_PREVIEW_COLOR else 2
            if self.active_edit_preview_target == key[1]:
                color = ROOM_SELECTED_COLOR
                width = 3
            self._draw_room(room, color, width)

    def _draw_room(self, room: Room, color: str, width: int) -> None:
        x1 = room.min_x * self.zoom
        y1 = room.min_y * self.zoom
        x2 = room.max_x * self.zoom
        y2 = room.max_y * self.zoom
        self.overlay_item_ids.append(
            self.canvas.create_rectangle(
                x1,
                y1,
                x2,
                y2,
                outline=color,
                width=width,
                fill=ROOM_FILL_COLOR,
                stipple="gray75",
            )
        )
        center_x, center_y = room.center
        label_x = center_x * self.zoom
        label_y = center_y * self.zoom
        font_size = -max(9, min(96, int(round(12 * self.zoom))))
        label_bg = self.canvas.create_rectangle(0, 0, 0, 0, fill=ROOM_LABEL_BG, outline="")
        label_text = self.canvas.create_text(
            label_x,
            label_y,
            text=room.id,
            fill=ROOM_LABEL_COLOR,
            font=("Segoe UI", font_size, "bold"),
        )
        bbox = self.canvas.bbox(label_text)
        if bbox is not None:
            padding = max(2, int(round(3 * self.zoom)))
            self.canvas.coords(label_bg, bbox[0] - padding, bbox[1] - padding, bbox[2] + padding, bbox[3] + padding)
            self.canvas.tag_lower(label_bg, label_text)
        self.overlay_item_ids.extend([label_bg, label_text])

    def _set_edit_preview(self, index: int, room: Room | None) -> None:
        self.edit_preview_target = index
        self.edit_preview_room = room.copy() if room is not None else None
        self._redraw_overlays()

    def _set_new_room_preview(self, room: Room | None) -> None:
        self.edit_preview_target = None
        self.edit_preview_room = room.copy() if room is not None else None
        self._redraw_overlays()

    def _clear_edit_preview(self) -> None:
        if self.edit_preview_target is None and self.edit_preview_room is None:
            return
        self.edit_preview_target = None
        self.edit_preview_room = None
        self._redraw_overlays()

    def _run_room_dialog(self, room: Room, *, preview_target: int | None = None) -> tuple[str, Room | None] | None:
        if preview_target is None:
            self._set_new_room_preview(room)
            preview_callback = self._set_new_room_preview
            used_ids = {existing.id for existing in self.rooms}
        else:
            self._set_edit_preview(preview_target, room)
            preview_callback = lambda preview_room: self._set_edit_preview(preview_target, preview_room)
            used_ids = {existing.id for index, existing in enumerate(self.rooms) if index != preview_target}

        dialog = RoomEditDialog(
            parent=self.root,
            room=room,
            image_width=self.image_width,
            image_height=self.image_height,
            used_ids=used_ids,
            on_preview_change=preview_callback,
        )
        self.active_edit_dialog = dialog
        self.active_edit_preview_target = preview_target
        try:
            return dialog.show()
        finally:
            self.active_edit_dialog = None
            self.active_edit_preview_target = None
            self._clear_edit_preview()

    def _update_status(self, prefix: str | None = None) -> None:
        message = (
            f"Zoom: {self.zoom:.2f}x | Rooms: {len(self.rooms)} | "
            "Left-drag: draw room, Right-click: edit room, "
            "Wheel: pan vertical, Shift+Wheel: pan horizontal, Ctrl+Wheel: zoom, Ctrl+Drag: pan, "
            "Dialog arrows: nudge min coords 0.5px, Shift+arrows: nudge max coords"
        )
        if prefix:
            message = f"{prefix} | {message}"
        self.status_var.set(message)

    def _is_focus_inside_active_dialog(self) -> bool:
        if self.active_edit_dialog is None:
            return False
        focused = self.root.focus_get()
        if focused is None:
            return False
        try:
            return focused.winfo_toplevel() == self.active_edit_dialog.window
        except tk.TclError:
            return False

    def _on_global_home_key(self, _event: tk.Event) -> str | None:
        if self.active_edit_dialog is None or self._is_focus_inside_active_dialog():
            return None
        self.active_edit_dialog.on_ok()
        return "break"

    def _on_global_escape_key(self, _event: tk.Event) -> str | None:
        if self.active_edit_dialog is None or self._is_focus_inside_active_dialog():
            return None
        self.active_edit_dialog.on_cancel()
        return "break"

    def _on_canvas_configure(self, _event: tk.Event) -> None:
        self._update_status()

    def _on_mouse_wheel(self, event: tk.Event) -> str:
        if not getattr(event, "delta", 0):
            return "break"

        steps = max(1, int(round(abs(event.delta) / 120)))
        direction = -1 if event.delta > 0 else 1
        state = int(getattr(event, "state", 0))

        if state & CONTROL_MASK:
            factor = ZOOM_STEP if event.delta > 0 else (1 / ZOOM_STEP)
            self._zoom_canvas(event.x, event.y, factor, relative_to_center=False, fast_preview=True)
            return "break"
        if state & SHIFT_MASK:
            self.canvas.xview_scroll(direction * steps * WHEEL_PAN_UNITS, "units")
            self._update_status()
            return "break"

        self.canvas.yview_scroll(direction * steps * WHEEL_PAN_UNITS, "units")
        self._update_status()
        return "break"

    def _on_ctrl_pan_start(self, event: tk.Event) -> str:
        self.canvas.scan_mark(event.x, event.y)
        self.canvas.configure(cursor="fleur")
        self._update_status()
        return "break"

    def _on_ctrl_pan_drag(self, event: tk.Event) -> str:
        self.canvas.scan_dragto(event.x, event.y, gain=1)
        return "break"

    def _on_ctrl_pan_end(self, _event: tk.Event) -> str:
        self.canvas.configure(cursor="")
        self._update_status()
        return "break"

    def _reset_zoom(self) -> None:
        if abs(self.zoom - 1.0) < 1e-9:
            return
        self._cancel_deferred_hq_render()
        self.zoom = 1.0
        self._render_image_and_overlays()
        self.canvas.xview_moveto(0)
        self.canvas.yview_moveto(0)

    def _zoom_canvas(
        self,
        view_x: float,
        view_y: float,
        factor: float,
        *,
        relative_to_center: bool,
        fast_preview: bool = False,
    ) -> None:
        new_zoom = max(MIN_ZOOM, min(MAX_ZOOM, self.zoom * factor))
        if math.isclose(new_zoom, self.zoom, rel_tol=1e-9, abs_tol=1e-9):
            return

        if relative_to_center:
            view_x = self.canvas.winfo_width() / 2
            view_y = self.canvas.winfo_height() / 2

        old_canvas_x = self.canvas.canvasx(view_x)
        old_canvas_y = self.canvas.canvasy(view_y)
        image_x = old_canvas_x / self.zoom
        image_y = old_canvas_y / self.zoom

        self.zoom = new_zoom
        self._render_image_and_overlays(high_quality=not fast_preview)

        new_canvas_x = image_x * self.zoom
        new_canvas_y = image_y * self.zoom
        self._scroll_to_keep_point(view_x, view_y, new_canvas_x, new_canvas_y)

        if fast_preview:
            self._schedule_high_quality_render()
        else:
            self._cancel_deferred_hq_render()

    def _schedule_high_quality_render(self) -> None:
        self._cancel_deferred_hq_render()
        self._hq_render_after_id = self.root.after(HQ_RENDER_DELAY_MS, self._run_deferred_high_quality_render)

    def _cancel_deferred_hq_render(self) -> None:
        if self._hq_render_after_id is None:
            return
        self.root.after_cancel(self._hq_render_after_id)
        self._hq_render_after_id = None

    def _run_deferred_high_quality_render(self) -> None:
        self._hq_render_after_id = None
        self._render_image_and_overlays(high_quality=True)

    def _scroll_to_keep_point(self, view_x: float, view_y: float, canvas_x: float, canvas_y: float) -> None:
        left = canvas_x - view_x
        top = canvas_y - view_y

        if self._scaled_width > 0:
            self.canvas.xview_moveto(max(0.0, min(1.0, left / self._scaled_width)))
        if self._scaled_height > 0:
            self.canvas.yview_moveto(max(0.0, min(1.0, top / self._scaled_height)))

    @staticmethod
    def _snap_to_half(value: float) -> float:
        return round(value / NUDGE_STEP) * NUDGE_STEP

    def _event_to_image_coords(self, event: tk.Event, *, snap_to_half: bool = False) -> tuple[float, float] | None:
        canvas_x = self.canvas.canvasx(event.x)
        canvas_y = self.canvas.canvasy(event.y)
        image_x = canvas_x / self.zoom
        image_y = canvas_y / self.zoom

        if snap_to_half:
            max_x = max(0.0, self.image_width - NUDGE_STEP)
            max_y = max(0.0, self.image_height - NUDGE_STEP)
            image_x = max(0.0, min(max_x, self._snap_to_half(image_x)))
            image_y = max(0.0, min(max_y, self._snap_to_half(image_y)))
            return image_x, image_y

        if not (0 <= image_x < self.image_width and 0 <= image_y < self.image_height):
            return None
        return image_x, image_y

    def _on_right_click(self, event: tk.Event) -> str:
        if int(getattr(event, "state", 0)) & CONTROL_MASK:
            return "break"
        if self.active_edit_dialog is not None:
            self._update_status("Finish or cancel the current edit before editing another room")
            return "break"
        coords = self._event_to_image_coords(event, snap_to_half=False)
        if coords is None:
            return "break"
        nearest = self._find_room_at_or_near(coords[0], coords[1])
        if nearest is None:
            self._update_status("No room at click")
            return "break"
        self._open_existing_room_editor(nearest)
        return "break"

    def _open_existing_room_editor(self, index: int) -> None:
        result = self._run_room_dialog(self.rooms[index], preview_target=index)
        if result is None:
            return

        action, updated_room = result
        if action == "cancel":
            self._update_status("Edit canceled")
            return
        if action == "delete":
            removed = self.rooms.pop(index)
            self._save_rooms()
            self._redraw_overlays()
            self._update_status(f"Deleted room {removed.id}")
            return
        if action == "save" and updated_room is not None:
            self.rooms[index] = updated_room
            self._save_rooms()
            self._redraw_overlays()
            self._update_status(f"Saved room {updated_room.id} @ {updated_room.to_record()['coords']}")

    def _on_left_drag_start(self, event: tk.Event) -> str:
        if int(getattr(event, "state", 0)) & CONTROL_MASK:
            return ""
        if self.active_edit_dialog is not None:
            self._update_status("Finish or cancel the current edit before drawing another room")
            return "break"
        coords = self._event_to_image_coords(event, snap_to_half=True)
        if coords is None:
            return "break"
        self.drag_start = coords
        self.drag_preview_room = Room(self._next_room_id(), coords[0], coords[1], coords[0] + MIN_ROOM_SIZE, coords[1] + MIN_ROOM_SIZE)
        self._redraw_overlays()
        return "break"

    def _on_left_drag_motion(self, event: tk.Event) -> str:
        if self.drag_start is None:
            return "break"
        coords = self._event_to_image_coords(event, snap_to_half=True)
        if coords is None:
            return "break"
        self.drag_preview_room = self._room_from_drag(self.drag_start, coords)
        self._redraw_overlays()
        return "break"

    def _on_left_drag_end(self, event: tk.Event) -> str:
        if self.drag_start is None:
            return "break"
        coords = self._event_to_image_coords(event, snap_to_half=True)
        start = self.drag_start
        self.drag_start = None
        self.drag_preview_room = None
        self._redraw_overlays()
        if coords is None:
            return "break"

        room = self._room_from_drag(start, coords)
        if room.max_x - room.min_x < MIN_ROOM_SIZE or room.max_y - room.min_y < MIN_ROOM_SIZE:
            self._update_status("Draw a larger rectangle to create a room")
            return "break"

        result = self._run_room_dialog(room)
        if result is None:
            return "break"
        action, updated_room = result
        if action in {"cancel", "delete"}:
            self._update_status("Room creation canceled")
            return "break"
        if action == "save" and updated_room is not None:
            self.rooms.append(updated_room)
            self._note_created_room_id(updated_room.id)
            self._save_rooms()
            self._redraw_overlays()
            self._update_status(f"Added room {updated_room.id} @ {updated_room.to_record()['coords']}")
        return "break"

    def _room_from_drag(self, start: tuple[float, float], end: tuple[float, float]) -> Room:
        min_x = min(start[0], end[0])
        min_y = min(start[1], end[1])
        max_x = max(start[0], end[0])
        max_y = max(start[1], end[1])
        if math.isclose(min_x, max_x, abs_tol=1e-9):
            max_x = min(self.image_width - NUDGE_STEP, min_x + MIN_ROOM_SIZE)
        if math.isclose(min_y, max_y, abs_tol=1e-9):
            max_y = min(self.image_height - NUDGE_STEP, min_y + MIN_ROOM_SIZE)
        return Room(self._next_room_id(), min_x, min_y, max_x, max_y)

    def _find_room_at_or_near(self, x: float, y: float) -> int | None:
        containing = [index for index, room in enumerate(self.rooms) if room.contains(x, y)]
        if containing:
            return min(containing, key=lambda index: self._room_area(self.rooms[index]))
        if not self.rooms:
            return None
        return min(range(len(self.rooms)), key=lambda index: self._distance_sq_to_room_center(self.rooms[index], x, y))

    @staticmethod
    def _room_area(room: Room) -> float:
        return (room.max_x - room.min_x) * (room.max_y - room.min_y)

    @staticmethod
    def _distance_sq_to_room_center(room: Room, x: float, y: float) -> float:
        center_x, center_y = room.center
        return ((center_x - x) ** 2) + ((center_y - y) ** 2)

    def _highest_positive_room_id(self) -> int:
        highest = 0
        for room in self.rooms:
            try:
                room_id = int(room.id)
            except ValueError:
                continue
            if room_id > highest:
                highest = room_id
        return highest

    def _note_created_room_id(self, room_id: str) -> None:
        try:
            numeric_id = int(room_id)
        except ValueError:
            return
        if numeric_id > 0:
            self.last_created_room_id = numeric_id

    def _next_room_id(self) -> str:
        used: set[int] = set()
        for room in self.rooms:
            try:
                room_id = int(room.id)
            except ValueError:
                continue
            if room_id > 0:
                used.add(room_id)
        candidate = max(1, self.last_created_room_id + 1)
        while candidate in used:
            candidate += 1
        return str(candidate)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Capture KDL room rectangle coordinates for a board image.")
    parser.add_argument("image_path", type=Path, nargs="?", help="Optional path to the board image to annotate.")
    return parser.parse_args()


def choose_image_path(root: tk.Tk, provided_path: Path | None) -> Path | None:
    if provided_path is not None:
        return provided_path

    initial_dir = DEFAULT_IMAGE_DIR if DEFAULT_IMAGE_DIR.exists() else Path.cwd()
    root.withdraw()
    selected_path = filedialog.askopenfilename(
        parent=root,
        title="Open board image",
        initialdir=str(initial_dir),
        filetypes=IMAGE_FILE_TYPES,
    )
    if not selected_path:
        root.destroy()
        return None
    root.deiconify()
    return Path(selected_path)


def main() -> None:
    args = parse_args()
    root = tk.Tk()
    image_path = choose_image_path(root, args.image_path)
    if image_path is None:
        return
    try:
        RoomHelperApp(root, image_path)
    except Exception as exc:  # noqa: BLE001
        root.withdraw()
        messagebox.showerror("Room Helper Error", str(exc))
        root.destroy()
        raise
    root.mainloop()


if __name__ == "__main__":
    main()
