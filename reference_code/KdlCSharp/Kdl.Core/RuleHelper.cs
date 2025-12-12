using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Util;

namespace Kdl.Core
{
    public class RuleHelper
    {
        public class Simple
        {
            public const double JustOverOneThird = 11.0 / 32.0;

            public const double PlayerStartingMoveCards = 2.0; //2.5;
            public const double MoveCardsPerLoot = JustOverOneThird;
            public const double CloversPerMoveCard = 1.0;

            public const double PlayerStartingWeapons = 2.0;
            public const double WeaponsPerLoot = JustOverOneThird;
            public const double StrengthPerWeapon = 53.0 / 24.0;
            public const double CloversPerWeapon = 1.0;

            public const double PlayerStartingFailures = 4.0;
            public const double FailuresPerLoot = JustOverOneThird;
            public const double CloversPerFailure = 50.0 / 24.0;

            public const double CloversContributedPerStranger = 1.0;

            public const bool StrangersAreNosy = false;

        }

        public const int PlayerStartingStrength = 1;
        public const int NormalPlayerNumStartingCards = 6;
        public const int NumNormalPlayersWhenHaveStrangers = 2;
        public const int NumAllPlayersWhenHaveStrangers = 4;

        public const int InvalidPlayerId = -1;

        public const int NormalPlayerIdFirst = 0;
        public const int StrangerPlayerIdFirst = 1;
        public const int NormalPlayerIdSecond = 2;
        public const int StrangerPlayerIdSecond = 3;

        public const int SideANormalPlayerId = 0;
        public const int SideBStrangerPlayerId = 1;
        public const int SideBNormalPlayerId = 2;
        public const int SideAStrangerPlayerId = 3;

        public const double HeuristicScoreWin = double.MaxValue;
        public const double HeuristicScoreLoss = double.MinValue;

        public RuleFlags RuleFlags { get; set; }

        #if false
        public RuleHelper(RuleFlags ruleFlags)
        {
            RuleFlags = ruleFlags;
        }
        #endif

        public static IDeck NewDeck(RuleFlags ruleFlags, string cardsPath, Random rng)
        {
            if(ruleFlags.HasFlag(RuleFlags.SuperSimple))
            {
                return new SuperSimpleDeck();
            }
            else if(ruleFlags.HasFlag(RuleFlags.FairCards))
            {
                return new FairDeck();
            }
            else
            {
                return NormalDeck.FromJson(cardsPath, rng);
            }
        }

        public static int NumAllPlayers(int numNormalPlayers)
            => numNormalPlayers == NumNormalPlayersWhenHaveStrangers ? NumAllPlayersWhenHaveStrangers : numNormalPlayers;

        public static int ToNormalPlayerId(int playerId, int numNormalPlayers = NumNormalPlayersWhenHaveStrangers)
        {
            if(numNormalPlayers != NumNormalPlayersWhenHaveStrangers)
            {
                return playerId;
            }

            return (playerId == SideANormalPlayerId || playerId == SideAStrangerPlayerId)
                ? SideANormalPlayerId : SideBNormalPlayerId;
        }

        // only for two-player games
        public static int AlliedStranger(int playerId)
            => playerId switch
            {
                SideANormalPlayerId   => SideAStrangerPlayerId,
                SideAStrangerPlayerId => SideAStrangerPlayerId,
                SideBNormalPlayerId   => SideBStrangerPlayerId,
                SideBStrangerPlayerId => SideBStrangerPlayerId,
                _ => RuleHelper.InvalidPlayerId,
            };

        // only for two-player games
        public static int OpposingNormalPlayer(int playerId)
            => playerId == SideANormalPlayerId || playerId == SideAStrangerPlayerId
            ? SideBNormalPlayerId : SideANormalPlayerId;

        // only for two-player games
        public static int OpposingStranger(int playerId)
            => AlliedStranger(OpposingNormalPlayer(playerId));

    }
}
