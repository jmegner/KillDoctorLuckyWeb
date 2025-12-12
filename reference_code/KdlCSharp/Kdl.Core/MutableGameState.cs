using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Util;

namespace Kdl.Core
{
    public class MutableGameState
        : IGameState<SimpleTurn,MutableGameState>, IEquatable<MutableGameState>
    {
        public CommonGameState Common { get; init; }
        public int TurnId { get; set; }
        public int CurrentPlayerId { get; set; }
        public int DoctorRoomId { get; set; }
        public int[] PlayerRoomIds { get; set; }
        public double[] PlayerMoveCards { get; set; }
        public double[] PlayerWeapons { get; set; }
        public double[] PlayerFailures { get; set; }
        public int[] PlayerStrengths { get; set; }
        public List<int> AttackerHist { get; set; }
        public int Winner { get; set; }
        public SimpleTurn PrevTurn { get; set; }
        public MutableGameState PrevState { get; set; }

        public static MutableGameState AtStart(CommonGameState common)
        {
            T[] playerVals<T>(T val) => common.NumAllPlayers.Times(val).ToArray();
            var game = new MutableGameState()
            {
                Common = common,
                TurnId = 1,
                CurrentPlayerId = 0,
                DoctorRoomId = common.Board.DoctorStartRoomId,
                PlayerRoomIds = playerVals(common.Board.PlayerStartRoomId),
                PlayerMoveCards = playerVals(RuleHelper.Simple.PlayerStartingMoveCards),
                PlayerWeapons = playerVals(RuleHelper.Simple.PlayerStartingWeapons),
                PlayerFailures = playerVals(RuleHelper.Simple.PlayerStartingFailures),
                PlayerStrengths = playerVals(RuleHelper.PlayerStartingStrength),
                AttackerHist = new(),
                Winner = RuleHelper.InvalidPlayerId,
                PrevTurn = new SimpleTurn(0, 0),
                PrevState = null,
            };
            return game;
        }

        public MutableGameState Copy()
        {
            return new MutableGameState()
            {
                Common = Common,
                TurnId = TurnId,
                CurrentPlayerId = CurrentPlayerId,
                DoctorRoomId = DoctorRoomId,
                PlayerRoomIds = PlayerRoomIds.ToArray(),
                PlayerMoveCards = PlayerMoveCards.ToArray(),
                PlayerWeapons = PlayerWeapons.ToArray(),
                PlayerFailures = PlayerFailures.ToArray(),
                PlayerStrengths = PlayerStrengths.ToArray(),
                AttackerHist = AttackerHist.ToList(),
                Winner = Winner,
                PrevTurn = PrevTurn,
                PrevState = PrevState,
            };
        }

        public override bool Equals(object other) => Equals(other as MutableGameState);

        public bool Equals(MutableGameState other)
        {
            return other != null
                && Common.Equals(other.Common)
                && CurrentPlayerId == other.CurrentPlayerId
                && DoctorRoomId == other.DoctorRoomId
                && PlayerRoomIds.SequenceEqual(other.PlayerRoomIds)
                && PlayerMoveCards.SequenceEqual(other.PlayerMoveCards)
                && PlayerWeapons.SequenceEqual(other.PlayerWeapons)
                && PlayerFailures.SequenceEqual(other.PlayerFailures)
                && PlayerStrengths.SequenceEqual(other.PlayerStrengths)
                && Winner == other.Winner;
        }

        public override int GetHashCode()
            => Common.GetHashCode()
            ^ CurrentPlayerId
            ^ (DoctorRoomId << 3)
            ^ (Winner << 8)
            ^ PlayerRoomIds.GetHashCode()
            ;

        public override string ToString()
            => "T" + TurnId
            + "," + PlayerText(CurrentPlayerId)
            + ",[" + DoctorRoomId
            + "," + string.Join(',', PlayerRoomIds)
            + "]" + (PrevTurn == null ? "" : "," + PrevTurn)
            //+ ",PPHS=" + PrevPlayerHeuristicScore().ToString("F3")
            ;

        public bool IsMutable => true;
        public int NumPlayers => Common.NumNormalPlayers;
        public bool HasWinner => Winner != RuleHelper.InvalidPlayerId;
        public bool IsNormalTurn => Common.GetPlayerType(CurrentPlayerId) == PlayerType.Normal;

        public int Ply()
        {
            int ply = 0;
            var state = this.PrevState;

            while(state != null)
            {
                if(state.IsNormalTurn)
                {
                    ply++;
                }

                state = state.PrevState;
            }

            return ply;
        }

        public PlayerType CurrentPlayerType => Common.GetPlayerType(CurrentPlayerId);
        public string PlayerText() => PlayerText(CurrentPlayerId);
        public string PlayerText(int playerId) => Common.PlayerText(playerId);

        public string PlayerTextLong(int playerId)
            => Common.PlayerText(playerId)
            + "(R" + PlayerRoomIds[playerId].ToString("D2")
            + ",S" + PlayerStrengths[playerId]
            + (Common.GetPlayerType(playerId) == PlayerType.Stranger
                ? ""
                : ",M" + PlayerMoveCards[playerId].ToString("N1")
                    + ",W" + PlayerWeapons[playerId].ToString("N1")
                    + ",F" + PlayerFailures[playerId].ToString("N1")
                )
            + ")";

        public bool PlayerSeesPlayer(int playerId1, int playerId2)
            => Common.Board.Sight[PlayerRoomIds[playerId1], PlayerRoomIds[playerId2]];

        public double NumDefensiveClovers()
        {
            var clovers = 0.0;
            var attackingSide = RuleHelper.ToNormalPlayerId(CurrentPlayerId, Common.NumNormalPlayers);

            for(int pid = 0; pid < Common.NumNormalPlayers; pid++)
            {
                if(pid != CurrentPlayerId)
                {
                    if(Common.GetPlayerType(pid) == PlayerType.Normal)
                    {
                        if(pid != attackingSide)
                        {
                            clovers
                                += PlayerFailures[pid] * RuleHelper.Simple.CloversPerWeapon
                                + PlayerWeapons[pid] * RuleHelper.Simple.CloversPerWeapon
                                + PlayerMoveCards[pid] * RuleHelper.Simple.CloversPerMoveCard;
                        }
                    }
                    else // else stranger
                    {
                        clovers++;
                    }
                }
            }

            return clovers;
        }

        public string Summary(int indentationLevel)
        {
            return StateSummary(Util.Print.Indentation(indentationLevel));
        }

        public string StateSummary(string leadingText = "")
        {
            var sb = new StringBuilder();
            sb.Append($"{leadingText}Turn {TurnId}, {PlayerText()}, HeuScore={HeuristicScore(CurrentPlayerId):F2}");
            sb.Append($"\n{leadingText}  AttackHist={{{string.Join(',', AttackerHist.Select(CommonGameState.ToPlayerDisplayNum))}}}");
            sb.Append($"\n{leadingText}  Dr@R{DoctorRoomId}");

            var playersWhoCanSeeDoctor = Common.PlayerIds.Zip(PlayerRoomIds)
                .Where(x => Common.Board.Sight[x.Second, DoctorRoomId])
                .Select(x => CommonGameState.ToPlayerDisplayNum(x.First));

            if (playersWhoCanSeeDoctor.Any())
            {
                sb.Append(", seen by players{" + string.Join(',', playersWhoCanSeeDoctor) + "}");
            }
            else
            {
                sb.Append(", unseen by players");
            }

            for (int playerId = 0; playerId < Common.NumAllPlayers; playerId++)
            {
                sb.Append($"\n{leadingText}  {PlayerTextLong(playerId)}");

                if (playerId == CurrentPlayerId)
                {
                    sb.Append(" *");
                }

                if(PlayerRoomIds[playerId] == DoctorRoomId)
                {
                    sb.Append(" D");
                }
            }

            var text = sb.ToString();
            return text;
        }

        public bool CheckNormalTurn(SimpleTurn turn, out string errorMsg)
        {
            foreach(var move in turn.Moves)
            {
                if(move.PlayerId >= Common.NumAllPlayers)
                {
                    errorMsg = $"invalid playerId {move.PlayerId} (displayed {PlayerText(move.PlayerId)}";
                    return false;
                }
                else if(!Common.Board.RoomIds.Contains(move.DestRoomId))
                {
                    errorMsg = $"invalid roomId {move.DestRoomId}";
                    return false;
                }
            }
            var totalDist = turn.Moves.Sum(move => Common.Board.Distance[PlayerRoomIds[move.PlayerId], move.DestRoomId]);

            if (PlayerMoveCards[CurrentPlayerId] < totalDist - 1)
            {
                errorMsg = $"player {PlayerText()} used too many move points ({totalDist})";
                return false;
            }

            var movingPlayerIds = new List<int>();

            foreach (var move in turn.Moves)
            {
                if(move.PlayerId >= PlayerRoomIds.Length)
                {
                    errorMsg = $"invalid player ({PlayerText(move.PlayerId)} in move";
                    return false;
                }

                if (move.PlayerId != CurrentPlayerId && Common.GetPlayerType(move.PlayerId) != PlayerType.Stranger)
                {
                    errorMsg = $"player {PlayerText()} tried to move non-stranger {PlayerText(move.PlayerId)}";
                    return false;
                }
            }

            errorMsg = null;
            return true;
        }

        public MutableGameState AfterTurn(SimpleTurn turn, bool mustReturnNewObject)
            => (mustReturnNewObject ? Copy() : this).AfterNormalTurn(turn);

        public MutableGameState AfterNormalTurn(SimpleTurn turn, bool wantLog = false)
        {
            // no turn validity checking; that is done in other method
            if(wantLog)
            {
                PrevState = Copy();
            }

            PrevTurn = turn;

            // move phase ======================================================

            var totalDist = turn.Moves.Sum(move => Common.Board.Distance[PlayerRoomIds[move.PlayerId], move.DestRoomId]);
            var moveCardsUsed = Math.Max(0, totalDist - 1);
            PlayerMoveCards[CurrentPlayerId] -= moveCardsUsed;

            bool movedStrangerThatSawDoctor = false;

            foreach(var move in turn.Moves)
            {
                if(move.PlayerId != CurrentPlayerId && Common.Board.Sight[PlayerRoomIds[move.PlayerId], DoctorRoomId])
                {
                    movedStrangerThatSawDoctor = true;
                }

                PlayerRoomIds[move.PlayerId] = move.DestRoomId;
            }

            // action phase (attack or loot) ===================================

            var action = BestActionAllowed(movedStrangerThatSawDoctor);

            if(action == PlayerAction.Attack)
            {
                if(ProcessAttack())
                {
                    Winner = CurrentPlayerId;
                }
            }
            else if(action == PlayerAction.Loot)
            {
                PlayerMoveCards[CurrentPlayerId] += RuleHelper.Simple.MoveCardsPerLoot;
                PlayerWeapons[CurrentPlayerId] += RuleHelper.Simple.WeaponsPerLoot;
                PlayerFailures[CurrentPlayerId] += RuleHelper.Simple.FailuresPerLoot;
            }

            // doctor phase ====================================================

            if(!HasWinner)
            {
                DoDoctorPhase();
            }

            // wrap-up phase ===================================================
            TurnId++;

            if(wantLog)
            {
                Console.WriteLine(PrevTurnSummary(true));
            }

            if(!HasWinner && !IsNormalTurn)
            {
                // could avoid newState allocation and pass underlying variables directly
                return AfterStrangerTurn(turn, wantLog);
            }

            return this;
        }

        public MutableGameState AfterStrangerTurn(SimpleTurn normalTurn, bool wantLog)
        {
            if(wantLog)
            {
                PrevState = Copy();
            }

            var bestAction = BestActionAllowed(false);

            // move phase ======================================================

            // stranger moves if and only if it can not attack the doctor
            var newRoomId = bestAction == PlayerAction.Attack
                ? PlayerRoomIds[CurrentPlayerId]
                : Common.Board.NextRoomId(PlayerRoomIds[CurrentPlayerId], -1);
            PlayerRoomIds[CurrentPlayerId] = newRoomId;

            // check for attack again after move
            if(bestAction != PlayerAction.Attack)
            {
                bestAction = BestActionAllowed(false);
            }

            // action phase ====================================================

            if(bestAction == PlayerAction.Attack)
            {
                if(ProcessAttack())
                {
                    CurrentPlayerId = Common.ToNormalPlayerId(CurrentPlayerId);
                    Winner = CurrentPlayerId;
                }
            }

            // doctor phase ====================================================
            if(!HasWinner)
            {
                DoDoctorPhase();
            }

            // wrap-up phase ===================================================
            TurnId++;

            if(wantLog)
            {
                Console.WriteLine(PrevTurnSummary(true));
            }

            if(!HasWinner && !IsNormalTurn)
            {
                // could avoid newState allocation and pass underlying variables directly
                return AfterStrangerTurn(normalTurn, wantLog);
            }

            return this;
        }

        // returns whether attack was successful and thus attacker is winner
        protected bool ProcessAttack()
        {
            var attackStrength = (double)PlayerStrengths[CurrentPlayerId];

            PlayerStrengths[CurrentPlayerId]++;
            AttackerHist.Add(CurrentPlayerId);

            if(Common.HasStrangers)
            {
                var strangerClovers = 1; // (IsNormalTurn ? 2 : 1) * RuleHelper.Simple.CloversContributedPerStranger;
                attackStrength -= strangerClovers;

                if(attackStrength < 0)
                {
                    return false;
                }

                // if normal player is attacking and attack actually requires normal players to defend
                if(IsNormalTurn)
                {
                    useWeapon(ref attackStrength);
                }

                // player id of normal defender
                var defender = RuleHelper.OpposingNormalPlayer(CurrentPlayerId);

                defendWithCardType(defender, ref attackStrength, PlayerFailures, RuleHelper.Simple.CloversPerFailure);
                defendWithCardType(defender, ref attackStrength, PlayerWeapons, RuleHelper.Simple.CloversPerWeapon);
                defendWithCardType(defender, ref attackStrength, PlayerMoveCards, RuleHelper.Simple.CloversPerMoveCard);

                return attackStrength > 0;
            }
            else
            {
                var numDefensiveClovers = NumDefensiveClovers();

                if(numDefensiveClovers <= 2 * attackStrength)
                {
                    useWeapon(ref attackStrength);
                }

                if(numDefensiveClovers < attackStrength)
                {
                    return true;
                }

                var defender = CurrentPlayerId;

                while(attackStrength > 0)
                {
                    defender = (defender - 1).PositiveRemainder(Common.NumAllPlayers);

                    if(defender == CurrentPlayerId)
                    {
                        return true;
                    }

                    defendWithCardType(defender, ref attackStrength, PlayerFailures, RuleHelper.Simple.CloversPerFailure);
                    defendWithCardType(defender, ref attackStrength, PlayerWeapons, RuleHelper.Simple.CloversPerWeapon);
                    defendWithCardType(defender, ref attackStrength, PlayerMoveCards, RuleHelper.Simple.CloversPerMoveCard);
                }

                return false;
            }

            void useWeapon(ref double attackStrength)
            {
                if(PlayerWeapons[CurrentPlayerId] >= 1)
                {
                    attackStrength += RuleHelper.Simple.StrengthPerWeapon;
                    PlayerWeapons[CurrentPlayerId]--;
                }
            }

            void defendWithCardType(
                int defender,
                ref double attackStrength,
                double[] playerCards,
                double cloversPerCard)
            {
                if(attackStrength > 0 && playerCards[defender] > 0)
                {
                    var numUsedCards = Math.Min(playerCards[defender], attackStrength / cloversPerCard);
                    playerCards[defender] -= numUsedCards;
                    attackStrength -= numUsedCards * cloversPerCard;
                }
            }
        }

        protected void DoDoctorPhase()
        {
            DoctorRoomId = Common.Board.NextRoomId(DoctorRoomId, 1);

            // normal next player progression
            var prevPlayerId = CurrentPlayerId;
            CurrentPlayerId = (CurrentPlayerId + 1) % Common.NumAllPlayers;

            // doctor activation may override;
            if (TurnId >= Common.NumAllPlayers)
            {
                for (int playerOffset = 0; playerOffset < Common.NumAllPlayers; playerOffset++)
                {
                    int playerId = (CurrentPlayerId + playerOffset) % Common.NumAllPlayers;
                    if (PlayerRoomIds[playerId] == DoctorRoomId)
                    {
                        CurrentPlayerId = playerId;
                        break;
                    }
                }
            }
        }

        public PlayerAction BestActionAllowed(bool movedStrangerThatSawDoctor)
        {
            var seenByOtherPlayers = false;
            var currentPlayerRoomId = PlayerRoomIds[CurrentPlayerId];

            for(int playerId = 0; playerId < PlayerRoomIds.Length; playerId++)
            {
                if(playerId != CurrentPlayerId && Common.Board.Sight[currentPlayerRoomId, PlayerRoomIds[playerId]])
                {
                    seenByOtherPlayers = true;
                    break;
                }
            }

            if(seenByOtherPlayers)
            {
                return PlayerAction.None;
            }

            if(currentPlayerRoomId == DoctorRoomId
                && (!RuleHelper.Simple.StrangersAreNosy || !movedStrangerThatSawDoctor))
            {
                return PlayerAction.Attack;
            }

            return Common.Board.Sight[currentPlayerRoomId, DoctorRoomId]
                ? PlayerAction.None
                : PlayerAction.Loot;
        }

        public string NormalTurnHist()
        {
            var sb = new StringBuilder();
            var states = new List<MutableGameState>();
            var stateForTraversal = this;

            while(stateForTraversal != null)
            {
                states.Add(stateForTraversal);
                stateForTraversal = stateForTraversal.PrevState;
            }

            states.Reverse();

            foreach(var state in states.Skip(1))
            {
                var prevState = state.PrevState;

                if(!prevState.IsNormalTurn)
                {
                    continue;
                }

                sb.Append(state.PrevTurnSummary() + ' ');
            }

            var text = sb.ToString();
            return text;
        }

        protected string PrevTurnSummary(bool verbose = false)
        {
            if(PrevState == null)
            {
                return "PrevStateNull";
            }

            // non-verbose summary: (P1MA)1@24(21)

            var prevPlayer = PrevState.CurrentPlayerId;
            var verboseMoveTexts = new List<string>();
            var shortMoveTexts = new List<string>();
            var totalDist = 0;

            foreach(var playerId in Common.PlayerIds)
            {
                var prevRoomId = PrevState.PlayerRoomIds[playerId];
                var roomId = PlayerRoomIds[playerId];

                if(prevRoomId != roomId)
                {
                    var dist = Common.Board.Distance[prevRoomId, roomId];
                    var distText = dist == 0 ? "" : $" ({dist}mp)";

                    totalDist += dist;
                    shortMoveTexts.Add($"{CommonGameState.ToPlayerDisplayNum(playerId)}@{roomId}({prevRoomId})");
                    verboseMoveTexts.Add($"    MOVE {PlayerText(playerId)}: R{prevRoomId} to R{roomId}{distText}");
                }
            }

            if(!shortMoveTexts.Any())
            {
                var roomId = PlayerRoomIds[prevPlayer];
                shortMoveTexts.Add($"{CommonGameState.ToPlayerDisplayNum(prevPlayer)}@{roomId}({roomId})");
                verboseMoveTexts.Add($"    MOVE {PlayerText(prevPlayer)}: stayed at R{roomId}");
            }

            var action = PlayerAction.None;

            if(PrevState.AttackerHist.Count != AttackerHist.Count)
            {
                action = PlayerAction.Attack;
            }
            else if(PrevState.PlayerMoveCards[prevPlayer] % 1 != PlayerMoveCards[prevPlayer] % 1)
            {
                action = PlayerAction.Loot;
            }

            var moveSignifier = PrevState.IsNormalTurn ? new string('M', Math.Max(0, totalDist - 1)) : "";
            var actionSignifier = action == PlayerAction.None ? "" : action.ToString()[0].ToString();
            var winText = HasWinner ? "(" + PlayerText(Winner) + " won)" : "";

            var shortSummary
                = "(" + PlayerText(prevPlayer) + moveSignifier + actionSignifier
                + ")" + string.Join(' ', shortMoveTexts)
                + winText
                + ";";

            if(!verbose)
            {
                return shortSummary;
            }

            var sb = new StringBuilder();
            var plyText = PrevState.IsNormalTurn ? $"/{PrevState.Ply()}" : "";
            sb.Append($"  Turn{PrevState.TurnId}{plyText}, {shortSummary}");

            verboseMoveTexts.ForEach(x => sb.Append('\n' + x));

            if(action == PlayerAction.Loot)
            {
                sb.Append($"\n    LOOT {PlayerText(prevPlayer)}: now " + PlayerTextLong(prevPlayer));
            }
            else if(action == PlayerAction.Attack)
            {
                var weaponBonus = PrevState.PlayerWeapons[prevPlayer] == PlayerWeapons[prevPlayer]
                    ? 0.0 : RuleHelper.Simple.StrengthPerWeapon;
                var attackStrength = PrevState.PlayerStrengths[prevPlayer] + weaponBonus;
                sb.Append($"\n    ATTACK: strength={attackStrength:F1} hist="
                    + string.Join(',', AttackerHist.Select(CommonGameState.ToPlayerDisplayNum)));
            }

            if(HasWinner)
            {
                sb.Append("\n    WINNER: " + PlayerText(Winner));
            }
            else
            {
                sb.Append($"\n    DR MOVE: R{PrevState.DoctorRoomId} to R{DoctorRoomId}");

                if (DoctorRoomId == PlayerRoomIds[CurrentPlayerId])
                {
                    var otherPlayersInRoom = Common.PlayerIds
                        .Where(pid => pid != CurrentPlayerId && PlayerRoomIds[pid] == DoctorRoomId)
                        .Select(CommonGameState.ToPlayerDisplayNum);
                    var unactivatedPlayersText = otherPlayersInRoom.Any()
                        ? ", unactivated players{" + string.Join(',', otherPlayersInRoom) + "}"
                        : "";
                    sb.Append($"\n    DR ACTIVATE: {PlayerText()}{unactivatedPlayersText}");
                }

                sb.Append("\n    start of next turn...\n");
                sb.Append(StateSummary(Util.Print.Indentation(3)));
            }

            return sb.ToString();
        }

        public double HeuristicScore(int analysisPlayerId)
        {
            if(HasWinner)
            {
                return analysisPlayerId == Common.ToNormalPlayerId(Winner)
                    ? RuleHelper.HeuristicScoreWin
                    : RuleHelper.HeuristicScoreLoss;
            }

            double miscScore(int playerId, int alliedStrength, bool isAlliedTurn, double alliedDoctorAdvantage)
                => alliedStrength
                + 0.5 * alliedStrength * 
                    ( PlayerMoveCards[playerId]
                    + (isAlliedTurn ? 0.95 : 0.0)
                    + alliedDoctorAdvantage * 0.9
                    )
                + 0.5 * PlayerWeapons[playerId]
                + 0.125 * PlayerFailures[playerId];

            // allied attack strength minus opposed attack strength
            var overallScore = 0.0;

            if(Common.HasStrangers)
            {
                var strangerAlly = RuleHelper.AlliedStranger(analysisPlayerId);
                var normalOpponent = RuleHelper.OpposingNormalPlayer(analysisPlayerId);
                var strangerOpponent = RuleHelper.AlliedStranger(normalOpponent);
                var alliedStrength = PlayerStrengths[analysisPlayerId] + PlayerStrengths[strangerAlly];
                var opponentStrength = PlayerStrengths[normalOpponent] + PlayerStrengths[strangerOpponent];
                var isMyTurn = analysisPlayerId == CurrentPlayerId;
                var alliedDoctorAdvantage = DoctorScore(
                    PlayerRoomIds[isMyTurn ? analysisPlayerId : normalOpponent],
                    PlayerRoomIds[isMyTurn ? strangerAlly : strangerOpponent],
                    PlayerRoomIds[isMyTurn ? normalOpponent : analysisPlayerId],
                    PlayerRoomIds[isMyTurn ? strangerOpponent : strangerAlly])
                    * (isMyTurn ? 1 : -1);

                overallScore
                    = miscScore(analysisPlayerId, alliedStrength, isMyTurn, alliedDoctorAdvantage)
                    - miscScore(normalOpponent, opponentStrength, !isMyTurn, -alliedDoctorAdvantage);
            }
            else
            {
                for (int pid = 0; pid < Common.NumAllPlayers; pid++)
                {
                    var weight = RuleHelper.ToNormalPlayerId(pid) == analysisPlayerId ? 1.0 : -1.0 / (Common.NumNormalPlayers - 1);
                    var playerMiscScore =  miscScore(pid, PlayerStrengths[pid], pid == CurrentPlayerId, 0);
                    overallScore += weight * playerMiscScore;
                }
            }

            return overallScore;
        }

        public double DoctorScore() => DoctorScore(
            PlayerRoomIds[CurrentPlayerId],
            PlayerRoomIds[RuleHelper.AlliedStranger(CurrentPlayerId)],
            PlayerRoomIds[RuleHelper.OpposingNormalPlayer(CurrentPlayerId)],
            PlayerRoomIds[RuleHelper.OpposingStranger(CurrentPlayerId)]);

        public double DoctorScore(
            int myRoom,
            int strangerAllyRoom,
            int normalEnemyRoom,
            int strangerEnemyRoom)
        {
            const double decayFactorNormal = 0.9;
            const double decayFactorStranger = 0.5;
            var numPlayersNotHadTurn = Common.NumAllPlayers - TurnId;
            var doctorDeltaForActivation = Math.Max(1, numPlayersNotHadTurn + 1);
            var nextDoctorRoomId = Common.Board.NextRoomId(DoctorRoomId, doctorDeltaForActivation);

            var doctorRooms = Common.Board.RoomIdsInDoctorVisitOrder(nextDoctorRoomId);
            doctorRooms.Insert(0, DoctorRoomId);

            var myStartingSearchIdx = numPlayersNotHadTurn > 0 ? 1 : 0;
            var myDoctorDist = 999;

            for(int i = myStartingSearchIdx; i < doctorRooms.Count; i++)
            {
                if(doctorRooms[i] == myRoom)
                {
                    myDoctorDist = i;
                    break;
                }
                else if(i > 0 && Common.Board.Distance[myRoom, doctorRooms[i]] <= 1)
                {
                    myDoctorDist = i;
                    break;
                }

            }

            var strangerAllyDoctorDist = doctorRooms.IndexOf(strangerAllyRoom, 1);
            var normalEnemyDoctorDist = doctorRooms.IndexOf(normalEnemyRoom, 1);
            var strangerEnemyDoctorDist = doctorRooms.IndexOf(strangerEnemyRoom, 1);
            var score
                = Math.Pow(decayFactorNormal, myDoctorDist)
                + Math.Pow(decayFactorStranger, strangerAllyDoctorDist)
                - Math.Pow(decayFactorNormal, normalEnemyDoctorDist)
                - Math.Pow(decayFactorStranger, strangerEnemyDoctorDist);
            return score;
        }

        public List<SimpleTurn> PossibleTurns()
        {
            if(HasWinner)
            {
                return new();
            }

            var movablePlayerIds = Common.NumNormalPlayers == RuleHelper.NumNormalPlayersWhenHaveStrangers
                ? new[] { CurrentPlayerId, RuleHelper.StrangerPlayerIdFirst, RuleHelper.StrangerPlayerIdSecond, }
                : new[] { CurrentPlayerId, };

            var movablePlayerSubsets = new List<List<int>>() { new(){ CurrentPlayerId, }, };

            if(Common.HasStrangers)
            {
                var alliedStranger = RuleHelper.AlliedStranger(CurrentPlayerId);
                var opposingStranger = RuleHelper.OpposingStranger(CurrentPlayerId);

                movablePlayerSubsets.Add(new() { alliedStranger, });
                movablePlayerSubsets.Add(new() { opposingStranger, });

                if(PlayerMoveCards[CurrentPlayerId] > 0)
                {
                    movablePlayerSubsets.Add(new() { CurrentPlayerId, alliedStranger, });
                    movablePlayerSubsets.Add(new() { CurrentPlayerId, opposingStranger, });
                    movablePlayerSubsets.Add(new() { alliedStranger, opposingStranger, });
                }
            }

            var turns = new List<SimpleTurn>();
            var distAllowed = (int)PlayerMoveCards[CurrentPlayerId] + 1;

            foreach(var movablePlayerSubset in movablePlayerSubsets)
            {
                turns.AddRange(PossibleTurns(distAllowed, movablePlayerSubset));
            }

            return turns;
        }

        protected List<SimpleTurn> PossibleTurns(int distAllowed, IList<int> movablePlayers)
            => movablePlayers.Count == 1
            ? PossibleTurns(distAllowed, movablePlayers[0])
            : PossibleTurns(distAllowed, movablePlayers[0], movablePlayers[1]);

        protected List<SimpleTurn> PossibleTurns(int distAllowed, int movablePlayer)
        {
            var movablePlayerRoom = PlayerRoomIds[movablePlayer];
            var turns = new List<SimpleTurn>();

            foreach (var destRoom in Common.Board.RoomIds)
            {
                if (Common.Board.Distance[movablePlayerRoom, destRoom] <= distAllowed)
                {
                    turns.Add(new SimpleTurn(movablePlayer, destRoom));
                }
            }

            return turns;
        }

        protected List<SimpleTurn> PossibleTurns(int distAllowed, int movablePlayerA, int movablePlayerB)
        {
            var srcRoomA = PlayerRoomIds[movablePlayerA];
            var srcRoomB = PlayerRoomIds[movablePlayerB];
            var moves = new List<SimpleTurn>();

            foreach (var dstRoomA in Common.Board.RoomIds)
            {
                var distRemaining = distAllowed - Common.Board.Distance[srcRoomA, dstRoomA];

                if (distRemaining <= 0 || srcRoomA == dstRoomA)
                {
                    continue;
                }

                var moveA = new PlayerMove(movablePlayerA, dstRoomA);

                foreach (var dstRoomB in Common.Board.RoomIds)
                {
                    if (Common.Board.Distance[srcRoomB, dstRoomB] > distRemaining
                        || srcRoomB == dstRoomB)
                    {
                        continue;
                    }

                    var moveB = new PlayerMove(movablePlayerB, dstRoomB);
                    moves.Add(new SimpleTurn(new[] { moveA, moveB }));
                }

            }

            return moves;
        }

        protected int PrevPlayerId()
        {
            var state = PrevState;

            while(state != null && !state.IsNormalTurn)
            {
                state = PrevState;
            }

            return state == null ? RuleHelper.InvalidPlayerId : state.CurrentPlayerId;
        }

        protected double PrevPlayerHeuristicScore()
        {
            var prevPlayerId = PrevPlayerId();
            return prevPlayerId == RuleHelper.InvalidPlayerId ? double.NaN : HeuristicScore(prevPlayerId);
        }

    }
}
