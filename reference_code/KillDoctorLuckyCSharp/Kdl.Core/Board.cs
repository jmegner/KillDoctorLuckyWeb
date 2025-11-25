using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.IO;
using System.Linq;
using Util;

namespace Kdl.Core
{
    public class Board
    {
        #region types

        public record BoardSpecification(
            string Name,
            ImmutableArray<int> PlayerStartRoomIds,
            ImmutableArray<int> DoctorStartRoomIds,
            ImmutableArray<int> CatStartRoomIds,
            ImmutableArray<int> DogStartRoomIds,
            ImmutableArray<Wing> Wings,
            ImmutableArray<Room> Rooms);

        #endregion
        #region public properties and fields

        public string Name { get; init; }
        public ImmutableDictionary<int, Room> Rooms { get; init; } // key is roomId
        public ImmutableArray<int> RoomIds { get; init; } // sorted
        public bool[,] Adjacency { get; init; } // double-indexed by roomId
        public bool[,] Sight { get; init; } // double-indexed by roomId
        public int[,] Distance { get; init; } // double-indexed by roomId
        public int[] AdjacencyCount { get; init; } // indexed by roomId
        public Dictionary<int,HashSet<int>> StrangerLoopRoomIds { get; init; } // indexed by enemy room id then allied stranger room id
        public int PlayerStartRoomId { get; init; }
        public int DoctorStartRoomId { get; init; }
        public int CatStartRoomId { get; init; }
        public int DogStartRoomId { get; init; }
        public BoardSpecification Spec { get; init; }

        #endregion
        #region constructors and static factory methods

        public Board(
            string name,
            IEnumerable<Room> rooms,
            int playerStartRoomId,
            int doctorStartRoomId,
            int catStartRoomId,
            int dogStartRoomId,
            BoardSpecification spec = null)
        {
            Name = name;
            Rooms = rooms.ToImmutableDictionary(room => room.Id);
            RoomIds = Rooms.Keys.ToImmutableSortedSet().ToImmutableArray();
            PlayerStartRoomId = playerStartRoomId;
            DoctorStartRoomId = doctorStartRoomId;
            CatStartRoomId = catStartRoomId;
            DogStartRoomId = dogStartRoomId;
            Spec = spec;

            var matrixDim = Rooms.Keys.Max() + 1;
            Adjacency = new bool[matrixDim, matrixDim];
            Sight = new bool[matrixDim, matrixDim];
            AdjacencyCount = new int[matrixDim];

            foreach (var room in Rooms.Values)
            {
                Adjacency[room.Id, room.Id] = true;
                Sight[room.Id, room.Id] = true;
                AdjacencyCount[room.Id] = room.Adjacent.Length;

                foreach(var adjacentRoomId in room.Adjacent)
                {
                    Adjacency[room.Id, adjacentRoomId] = true;
                }

                foreach(var visibleRoomId in room.Visible)
                {
                    Sight[room.Id, visibleRoomId] = true;
                }
            }

            Distance = AdjacencyToDistance(Adjacency);
            StrangerLoopRoomIds = DistanceToStrangerLoopInfo(RoomIds, Distance, Sight);
        }

        protected static Dictionary<int,HashSet<int>> DistanceToStrangerLoopInfo(IList<int> roomIds, int[,] dist, bool[,] sight)
        {
            var enemyRooms = new SortedSet<int>();
            var allyRooms = new SortedSet<int>();

            foreach(var roomId in roomIds)
            {
                var plus1 = NextRoomId(roomId, 1, roomIds);
                var plus2 = NextRoomId(roomId, 2, roomIds);
                var plus3 = NextRoomId(roomId, 3, roomIds);

                if(dist[roomId, plus2] <= 1)
                {
                    enemyRooms.Add(plus1);
                }

                if(dist[roomId, plus3] <= 1 && !sight[plus1, plus3])
                {
                    allyRooms.Add(plus1);
                }
            }

            var info = new Dictionary<int, HashSet<int>>();

            foreach(var enemyRoom in enemyRooms)
            {
                var enemyMinus1 = NextRoomId(enemyRoom, -1, roomIds);
                var enemyMinus2 = NextRoomId(enemyRoom, -2, roomIds);
                var workingAllyRooms = new HashSet<int>();

                foreach(var allyRoom in allyRooms)
                {
                    if(!sight[allyRoom, enemyRoom]
                        && !sight[allyRoom, enemyMinus1]
                        && allyRoom != enemyMinus2)
                    {
                        workingAllyRooms.Add(allyRoom);
                    }
                }

                if(workingAllyRooms.Any())
                {
                    info.Add(enemyRoom, workingAllyRooms);
                }
            }

            return info;
        }

        protected static int[,] AdjacencyToDistance(bool[,] adjacency)
        {
            var dim = adjacency.GetLength(0);
            var distance = new int[dim, dim];

            for(int i = 0; i < distance.Length; i++)
            {
                var r = i / dim;
                var c = i % dim;
                int initialDist;

                if(r == c)
                {
                    initialDist = 0;
                }
                else if(adjacency[r, c])
                {
                    initialDist = 1;
                }
                else
                {
                    initialDist = 999;
                }

                distance[r, c] = initialDist;
            }

            var isImprovingDistance = true;
            while(isImprovingDistance)
            {
                isImprovingDistance = false;

                for(int source = 1; source < dim; source++)
                {
                    for(int destination = 1; destination < dim; destination++)
                    {
                        if(source == destination)
                        {
                            continue;
                        }

                        for(int intermediate = 1; intermediate < dim; intermediate++)
                        {
                            var distanceViaIntermediate = distance[source, intermediate] + distance[intermediate, destination];

                            if(distanceViaIntermediate < distance[source, destination])
                            {
                                distance[source, destination] = distanceViaIntermediate;
                                isImprovingDistance = true;
                            }
                        }
                    }
                }
            }

            return distance;
        }

        public static Board FromJsonFile(string boardPath)
        {
            return FromJsonFile(boardPath, Enumerable.Empty<string>(), "");
        }

        public static Board FromJsonFile(string boardPath, IEnumerable<string> closedWingNames, string boardNameSuffix = "")
        {
            var boardText = File.ReadAllText(boardPath);
            var boardSpec = JsonHelper.Deserialize<BoardSpecification>(boardText);
            ImmutableArray<Room> openRooms;

            if(closedWingNames.Any())
            {
                var closedRoomIds = boardSpec.Wings
                    .Where(wing => closedWingNames.Contains(wing.Name, StringComparer.OrdinalIgnoreCase))
                    .SelectMany(wing => wing.RoomIds)
                    .ToImmutableSortedSet();
                openRooms = boardSpec.Rooms
                    .Where(room => !closedRoomIds.Contains(room.Id))
                    .Select(room => room.WithoutClosed(closedRoomIds))
                    .ToImmutableArray();
            }
            else
            {
                openRooms = boardSpec.Rooms;
            }

            var openRoomIdSet = openRooms.Ids().ToHashSet();
            int chooseFirstOpen(IEnumerable<int> desiredRoomIds)
                => desiredRoomIds.First(id => openRoomIdSet.Contains(id));

            var board = new Board(
                name:              boardSpec.Name + boardNameSuffix,
                rooms:             openRooms,
                playerStartRoomId: chooseFirstOpen(boardSpec.PlayerStartRoomIds),
                doctorStartRoomId: chooseFirstOpen(boardSpec.DoctorStartRoomIds),
                catStartRoomId:    chooseFirstOpen(boardSpec.CatStartRoomIds),
                dogStartRoomId:    chooseFirstOpen(boardSpec.DogStartRoomIds));

            return board;
        }

        public static Board FromJsonResource(string boardPath, string boardNameSuffix, IEnumerable<string> closedWingNames)
        {
            var boardText = File.ReadAllText(boardPath);
            var boardSpec = JsonHelper.Deserialize<BoardSpecification>(boardText);
            ImmutableArray<Room> openRooms;

            if(closedWingNames.Any())
            {
                var closedRoomIds = boardSpec.Wings
                    .Where(wing => closedWingNames.Contains(wing.Name, StringComparer.OrdinalIgnoreCase))
                    .SelectMany(wing => wing.RoomIds)
                    .ToImmutableSortedSet();
                openRooms = boardSpec.Rooms
                    .Where(room => !closedRoomIds.Contains(room.Id))
                    .Select(room => room.WithoutClosed(closedRoomIds))
                    .ToImmutableArray();
            }
            else
            {
                openRooms = boardSpec.Rooms;
            }

            var openRoomIdSet = openRooms.Ids().ToHashSet();
            int chooseFirstOpen(IEnumerable<int> desiredRoomIds)
                => desiredRoomIds.First(id => openRoomIdSet.Contains(id));

            var board = new Board(
                name:              boardSpec.Name + boardNameSuffix,
                rooms:             openRooms,
                playerStartRoomId: chooseFirstOpen(boardSpec.PlayerStartRoomIds),
                doctorStartRoomId: chooseFirstOpen(boardSpec.DoctorStartRoomIds),
                catStartRoomId:    chooseFirstOpen(boardSpec.CatStartRoomIds),
                dogStartRoomId:    chooseFirstOpen(boardSpec.DogStartRoomIds));

            return board;
        }

        #endregion
        #region public methods

        public bool IsValid(out List<string> mistakes)
        {
            mistakes = new();

            if(PlayerStartRoomId <= 0 || DoctorStartRoomId <= 0 || CatStartRoomId <= 0 || DogStartRoomId <= 0)
            {
                mistakes.Add("bad start room id");
            }

            foreach(var room in Rooms.Values)
            {
                if(room.Adjacent.Contains(room.Id))
                {
                    mistakes.Add($"room {room.Id} is in own adjacent list");
                }
                if(room.Visible.Contains(room.Id))
                {
                    mistakes.Add($"room {room.Id} is in own visible list");
                }

                var nonexistentAdjacentRooms = room.Adjacent.Where(adjRoomId => !RoomIds.Contains(adjRoomId));
                if(nonexistentAdjacentRooms.Any())
                {
                    mistakes.Add($"room {room.Id} lists nonexistent adjacent rooms {string.Join(", ", nonexistentAdjacentRooms)}");
                }

                var nonexistentVisibleRooms = room.Visible.Where(visibleRoomId => !RoomIds.Contains(visibleRoomId));
                if(nonexistentVisibleRooms.Any())
                {
                    mistakes.Add($"room {room.Id} lists nonexistent adjacent rooms {string.Join(", ", nonexistentVisibleRooms)}");
                }
            }

            int maxRoomId = Adjacency.GetLength(0);

            foreach(var r1 in maxRoomId.ToRange())
            {
                foreach(var r2 in maxRoomId.ToRange())
                {
                    if(Adjacency[r1, r2] != Adjacency[r2, r1])
                    {
                        mistakes.Add($"Adjacency[{r1},{r2}] contradiction");
                    }

                    if(Sight[r1, r2] != Sight[r2, r1])
                    {
                        mistakes.Add($"Visibility[{r1},{r2}] contradiction");
                    }
                }
            }

            return !mistakes.Any();
        }

        public bool RoomIsSeenBy(int roomOfConcern, IEnumerable<int> roomsWithOtherPeople)
            => roomsWithOtherPeople.Any(roomId => Sight[roomOfConcern, roomId]);

        public int NextRoomId(int roomId, int delta) => NextRoomId(roomId, delta, RoomIds);

        public static int NextRoomId(int roomId, int delta, IList<int> roomIds)
        {
            var idx = roomIds.IndexOf(roomId);
            var nextIdx = (idx + delta).PositiveRemainder(roomIds.Count());
            var nextRoomId = roomIds[nextIdx];
            return nextRoomId;
        }

        public List<int> RoomIdsInDoctorVisitOrder(int startRoomId)
        {
            var startIdx = RoomIds.IndexOf(startRoomId);
            var roomIds = RoomIds.Length.ToRange()
                .Select(i => RoomIds[(startIdx + i) % RoomIds.Length])
                .ToList();
            return roomIds;
        }

        #endregion
    }
}
