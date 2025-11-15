/* A lightweight, immutable Room “record”*/

export class Room {
    /** Unique identifier (matches JSON-schema `Id`) */
    readonly id: number;
    /** Display name */
    readonly name: string;
    /** Room ids that can be entered directly */
    readonly adjacent: ReadonlyArray<number>;
    /** Room ids that can be seen into (line-of-sight) */
    readonly visible: ReadonlyArray<number>;

    constructor(
      id: number,
      name: string,
      adjacent: ReadonlyArray<number>,
      visible: ReadonlyArray<number>
    ) {
      this.id = id;
      this.name = name;
      this.adjacent = adjacent;
      this.visible = visible;
      Object.freeze(this);
    }

    /** example: `Id;A:1,2;V:3,4` */
    toString(): string {
      return `${this.id};A:${this.adjacent.join(",")};V:${this.visible.join(",")}`;
    }

    /**
     * Return a new Room with any `closedRoomIds` removed from both
     * `adjacent` and `visible`.  Original object stays untouched.
     */
    withoutClosed(closedRoomIds: Iterable<number>): Room {
      const closed = new Set(closedRoomIds);
      const filter = (ids: ReadonlyArray<number>) => ids.filter(id => !closed.has(id));
      return new Room(this.id, this.name, filter(this.adjacent), filter(this.visible));
    }

    /* ---------- static utilities ---------- */

    /** Extract just the room ids from an iterable of Room objects */
    static ids(rooms: Iterable<Room>): number[] {
      return [...rooms].map(r => r.id);
    }
  }
