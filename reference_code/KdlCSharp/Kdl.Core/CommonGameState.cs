using System;
using System.Collections.Generic;
using Util;

namespace Kdl.Core
{
    public record CommonGameState(
        bool IsLogEnabled,
        Board Board,
        int NumNormalPlayers,
        int NumAllPlayers)
        : IEquatable<CommonGameState>
    {
        public CommonGameState(
            bool isLogEnabled,
            Board board,
            int numNormalPlayers)
            : this(
                isLogEnabled,
                board,
                numNormalPlayers,
                RuleHelper.NumAllPlayers(numNormalPlayers))
        {
        }

        public virtual bool Equals(CommonGameState other)
            => other != null
            && Board.Name == other.Board.Name
            && NumNormalPlayers == other.NumNormalPlayers
            && NumAllPlayers == other.NumAllPlayers;

        public override int GetHashCode() => Board.GetHashCode() ^ NumNormalPlayers.GetHashCode();

        public bool HasStrangers => NumNormalPlayers == RuleHelper.NumNormalPlayersWhenHaveStrangers;

        public PlayerType GetPlayerType(int playerId)
            => NumNormalPlayers == RuleHelper.NumNormalPlayersWhenHaveStrangers && (playerId % 2 == 1)
            ? PlayerType.Stranger
            : PlayerType.Normal;

        public static int ToPlayerId(int playerDisplayNum) => playerDisplayNum - 1;
        public static int ToPlayerDisplayNum(int playerId) => playerId + 1;

        public string PlayerText(int playerId)
            => (GetPlayerType(playerId) == PlayerType.Normal ? "P" : "p")
            + ToPlayerDisplayNum(playerId);

        public IEnumerable<int> PlayerIds => NumAllPlayers.ToRange();

        public int ToNormalPlayerId(int playerId) => RuleHelper.ToNormalPlayerId(playerId, NumNormalPlayers);
    }
}
