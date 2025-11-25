using System;

namespace Kdl.Core
{
    [Flags]
    public enum RuleFlags
    {
        Standard = 0,
        CantMoveVisibleStrangerAndAttackSameTurn = 1 << 0,
        AlternateBoardStairwaysDontGiveSight = 1 << 1,
        FairCards = 1 << 2,
        StrangerAlliedWithNextHuman = 1 << 3,

        // no cards, start with 2 move points, game ends once a player (or player+stranger) has 7 attacks;
        // each attack is 0.75^attackIdx pts, and half points for strangers.
        SuperSimple = 1 << 4,
    }
}
