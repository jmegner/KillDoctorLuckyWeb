using System.Collections.Generic;
using System.Collections.Immutable;

namespace Kdl.Core
{

    public record SimpleTurn(ImmutableArray<PlayerMove> Moves) : ITurn
    {
        public SimpleTurn()
            : this(ImmutableArray.Create<PlayerMove>(new PlayerMove(RuleHelper.InvalidPlayerId, 0)))
        {
        }

        public SimpleTurn(int playerId, int destRoomId)
            : this(ImmutableArray.Create<PlayerMove>(new PlayerMove(playerId, destRoomId)))
        {
        }

        public SimpleTurn(PlayerMove move)
            : this(ImmutableArray.Create<PlayerMove>(move))
        {
        }

        public SimpleTurn(IEnumerable<PlayerMove> moves)
            : this(moves.ToImmutableArray())
        {
        }

        public static implicit operator ImmutableArray<PlayerMove>(SimpleTurn value) => value.Moves;

        public override string ToString()
            => string.Join<PlayerMove>(" ", Moves) + ';';
    }
}
