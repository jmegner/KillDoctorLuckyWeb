using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;

namespace Kdl.Core
{
    public record Room(
        int Id,
        string Name,
        ImmutableArray<int> Adjacent,
        ImmutableArray<int> Visible)
    {
        public override string ToString()
        {
            var adjacentText = string.Join(',', Adjacent);
            var visibleText = string.Join(',', Visible);
            return $"{Id};{Name};A:{adjacentText};V:{visibleText}";
        }

        public Room WithoutClosed(IEnumerable<int> closedRoomIds)
        {
            var adjacent = Adjacent.Where(roomId => !closedRoomIds.Contains(roomId)).ToImmutableArray();
            var visible = Visible.Where(roomId => !closedRoomIds.Contains(roomId)).ToImmutableArray();
            var room = new Room(Id, Name, adjacent, visible);
            return room;
        }
    }

    public static class RoomExtensions
    {
        public static IEnumerable<int> Ids(this IEnumerable<Room> rooms)
        {
            return rooms.Select(room => room.Id);
        }
    }
}
