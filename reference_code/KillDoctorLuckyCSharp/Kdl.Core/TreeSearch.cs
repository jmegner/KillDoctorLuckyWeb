using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Collections.Concurrent;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Util;

namespace Kdl.Core
{
    public class SpinLockedAlpha
    {
        public double Alpha;
        //protected double Beta;
        public SpinLock Lock;

        public SpinLockedAlpha(double alpha = RuleHelper.HeuristicScoreLoss)
        {
            Alpha = alpha;
            //Beta = RuleHelper.HeuristicScoreWin;
            Lock = new SpinLock();
        }

        public override string ToString() => Alpha.ToString();

        public void Enter()
        {
            var lockTaken = false;
            Lock.Enter(ref lockTaken);
        }

        public double GetAlpha()
        {
            Enter();
            var alpha = Alpha;
            Exit();
            return alpha;
        }

        public double Update(double val)
        {
            Enter();
            if(val > Alpha)
            {
                Alpha = val;
            }
            var alphaCopy = Alpha;
            Exit();
            return Alpha;
        }

        public void Exit() => Lock.Exit();
    }

    public class TreeSearch<TTurn,TGameState>
        where TTurn : ITurn
        where TGameState : IGameState<TTurn,TGameState>
    {
        public const double AlphaInitial = RuleHelper.HeuristicScoreLoss;
        public const double BetaInitial = RuleHelper.HeuristicScoreWin;

        // reminder: analysisPlayerId will never be a stranger
        public static AppraisedPlayerTurn<TTurn,TGameState> FindBestTurn(
            TGameState state,
            int analysisLevel,
            CancellationToken cancellationToken,
            out int numStatesVisited,
            int parallelization = 1)
        {
            numStatesVisited = 0;
            if(state.NumPlayers == 2)
            {
                if (parallelization == 1)
                {
                    return FindBestTurnTwoPlayers(
                        state,
                        analysisLevel,
                        cancellationToken,
                        ref numStatesVisited,
                        AlphaInitial,
                        BetaInitial);
                }
                else
                {
                    return FindBestTurnTwoPlayersParallelPrioritized(
                        state,
                        analysisLevel,
                        cancellationToken);
                }
            }
            else
            {
                return FindBestTurnManyPlayers(
                    state,
                    state.CurrentPlayerId,
                    analysisLevel,
                    cancellationToken,
                    ref numStatesVisited);
            }
        }

        protected static AppraisedPlayerTurn<TTurn,TGameState> FindBestTurnManyPlayers(
            TGameState currState,
            int analysisPlayerId,
            int analysisLevel,
            CancellationToken cancellationToken,
            ref int numStatesVisited)
        {
            numStatesVisited++;

            if(currState.HasWinner || analysisLevel == 0)
            {
                return new AppraisedPlayerTurn<TTurn,TGameState>(currState.HeuristicScore(analysisPlayerId), currState.PrevTurn, currState);
            }

            var appraisalIsForCurrentPlayer = analysisPlayerId == currState.CurrentPlayerId;
            var bestTurn = AppraisedPlayerTurn<TTurn, TGameState>.EmptyMinimum;
            var turns = currState.PossibleTurns();
            var childStates = turns.Select(turn => currState.AfterTurn(turn, true));

            foreach(var childState in childStates)
            {
                var hypoAppraisedTurn = FindBestTurnManyPlayers(
                    childState,
                    currState.CurrentPlayerId,
                    analysisLevel - 1,
                    cancellationToken,
                    ref numStatesVisited);

                if(currState.CurrentPlayerId != childState.CurrentPlayerId)
                {
                    hypoAppraisedTurn.Appraisal = hypoAppraisedTurn.EndingState.HeuristicScore(currState.CurrentPlayerId);
                }

                if (bestTurn.Appraisal < hypoAppraisedTurn.Appraisal)
                {
                    bestTurn = hypoAppraisedTurn;
                    bestTurn.Turn = childState.PrevTurn;

                    if(bestTurn.EndingState.Winner == analysisPlayerId)
                    {
                        break;
                    }
                }

                if(cancellationToken.IsCancellationRequested)
                {
                    return bestTurn;
                }
            }

            return bestTurn;
        }

        protected static AppraisedPlayerTurn<TTurn,TGameState> FindBestTurnTwoPlayers(
            TGameState currState,
            int analysisLevel,
            CancellationToken cancellationToken,
            ref int numStatesVisited,
            double alpha,
            double beta)
        {
            numStatesVisited++;

            if(currState.HasWinner || analysisLevel == 0)
            {
                return new AppraisedPlayerTurn<TTurn,TGameState>(
                    currState.HeuristicScore(currState.CurrentPlayerId),
                    currState.PrevTurn,
                    currState);
            }

            var turns = currState.PossibleTurns();
            var childStates = turns.Select(turn => currState.AfterTurn(turn, true));

            if(analysisLevel > 1)
            {
                childStates = childStates.OrderByDescending(childState
                    => childState.HeuristicScore(currState.CurrentPlayerId));
            }

            var bestTurn = AppraisedPlayerTurn<TTurn, TGameState>.EmptyMinimum;

            foreach(var childState in childStates)
            {
                var childIsUs = currState.CurrentPlayerId == childState.CurrentPlayerId;
                var childAlpha = childIsUs ? alpha : -beta;
                var childBeta = childIsUs ? beta : -alpha;
                var hypoTurn = FindBestTurnTwoPlayers(
                    childState,
                    analysisLevel - 1,
                    cancellationToken,
                    ref numStatesVisited,
                    childAlpha,
                    childBeta);

                if(!childIsUs)
                {
                    hypoTurn.Appraisal *= -1;
                }

                if (bestTurn.Appraisal < hypoTurn.Appraisal)
                {
                    bestTurn = hypoTurn;
                    bestTurn.Turn = childState.PrevTurn;

                    if(bestTurn.Appraisal > alpha)
                    {
                        alpha = bestTurn.Appraisal;

                        if(alpha >= beta)
                        {
                            break;
                        }
                    }
                }

                if(cancellationToken.IsCancellationRequested)
                {
                    break;
                }
            }

            return bestTurn;
        }

        protected static AppraisedPlayerTurn<TTurn, TGameState> FindBestTurnTwoPlayersParallel(
            TGameState currState,
            int analysisLevel,
            CancellationToken cancellationToken,
            int parallelization = 16)
        {
            int analysisPlayerId = currState.CurrentPlayerId;

            if(analysisLevel == 0)
            {
                return new(currState.HeuristicScore(analysisPlayerId), default, currState);
            }

            var subrootStates = currState.SortedNextStates<TTurn, TGameState>() // sorted descending
                .ToList();

            var subrootsForEachTask = parallelization.ToRange().Select(_ => new List<TGameState>()).ToList();

            for(int i = 0; i < subrootStates.Count; i++)
            {
                subrootsForEachTask[i % subrootsForEachTask.Count].Add(subrootStates[i]);
            }

            var lockedAlpha = new SpinLockedAlpha();
            var numStatesVisited = new int[subrootsForEachTask.Count];

            Console.WriteLine($"{DateTime.Now.ToString("HH:mm:ss.ffffff")} before start tasks");
#if false
            var tasks = subrootsForEachTask
                .Select(subrootsForOneTask
                    => Task.Run(() => FindBestTurnTwoPlayersParallelSubroots(
                        subrootsForOneTask,
                        analysisPlayerId,
                        analysisLevel - 1,
                        cancellationToken,
                        lockedAlpha)))
                .ToArray();
#else
            var tasks = new Task<AppraisedPlayerTurn<TTurn, TGameState>>[subrootsForEachTask.Count];

            for(int taskIdx = 0; taskIdx < tasks.Length; taskIdx++)
            {
                var taskIdxCopy = taskIdx;
                tasks[taskIdx] = Task.Run(() => FindBestTurnTwoPlayersParallelSubroots(
                    taskIdxCopy,
                    subrootsForEachTask[taskIdxCopy],
                    analysisPlayerId,
                    analysisLevel - 1,
                    cancellationToken,
                    lockedAlpha));
            }
#endif
            Console.WriteLine($"{DateTime.Now.ToString("HH:mm:ss.ffffff")} before WaitAll");
            Task.WaitAll(tasks);
            Console.WriteLine($"{DateTime.Now.ToString("HH:mm:ss.ffffff")} after WaitAll");
            var bestTurn = tasks.MaxElementBy(task => task.Result.Appraisal).Result;
            Console.WriteLine($"{DateTime.Now.ToString("HH:mm:ss.ffffff")} after tasks.MaxElementBy");
            return bestTurn;
        }

        protected static AppraisedPlayerTurn<TTurn, TGameState> FindBestTurnTwoPlayersParallelSubroots(
            int taskIdx,
            List<TGameState> subroots,
            int analysisPlayerId,
            int analysisLevel,
            CancellationToken cancellationToken,
            SpinLockedAlpha lockedAlpha)
        {
            Console.WriteLine($"{DateTime.Now.ToString("HH:mm:ss.ffffff")} start ParallelSubroots {taskIdx}");
            var bestTurn = AppraisedPlayerTurn<TTurn, TGameState>.EmptyMinimum;

            //foreach(var subroot in subroots)
            for(int subrootIdx = 0; subrootIdx < subroots.Count; subrootIdx++)
            {
                var subroot = subroots[subrootIdx];

                var subrootBestTurn = FindBestTurnTwoPlayersParallelRecursive(
                    subroot,
                    analysisPlayerId,
                    analysisLevel,
                    cancellationToken,
                    lockedAlpha,
                    AlphaInitial,
                    BetaInitial);

                if(bestTurn.Appraisal < subrootBestTurn.Appraisal)
                {
                    bestTurn = subrootBestTurn;
                    bestTurn.Turn = subroot.PrevTurn;
                    var newAlpha = lockedAlpha.Update(bestTurn.Appraisal);

                    if(newAlpha == bestTurn.Appraisal)
                    {
                        Console.WriteLine($"task {taskIdx} subroot {subrootIdx}/{subroots.Count} updated alpha to {newAlpha}");
                    }

                    if(newAlpha >= BetaInitial)
                    {
                        break;
                    }
                }
            }

            Console.WriteLine($"{DateTime.Now.ToString("HH:mm:ss.ffffff")} end ParallelSubroots {taskIdx}");
            return bestTurn;
        }

        protected static AppraisedPlayerTurn<TTurn,TGameState> FindBestTurnTwoPlayersParallelRecursive(
            TGameState currState,
            int rootAnalysisPlayerId,
            int analysisLevel,
            CancellationToken cancellationToken,
            SpinLockedAlpha sharedAlpha,
            double localAlpha,
            double localBeta)
        {
            if(currState.HasWinner || analysisLevel == 0)
            {
                return new AppraisedPlayerTurn<TTurn,TGameState>(
                    currState.HeuristicScore(rootAnalysisPlayerId),
                    currState.PrevTurn,
                    currState);
            }

            var turns = currState.PossibleTurns();
            var childStates = turns.Select(turn => currState.AfterTurn(turn, true));

            if(analysisLevel > 1)
            {
                childStates = childStates.OrderByDescending(childState
                    => childState.HeuristicScore(currState.CurrentPlayerId));
            }

            var bestTurn
                = currState.CurrentPlayerId == rootAnalysisPlayerId
                ? AppraisedPlayerTurn<TTurn, TGameState>.EmptyMinimum
                : AppraisedPlayerTurn<TTurn, TGameState>.EmptyMaximum;

            foreach(var childState in childStates)
            {
                var hypoAppraisedTurn = FindBestTurnTwoPlayersParallelRecursive(
                    childState,
                    rootAnalysisPlayerId,
                    analysisLevel - 1,
                    cancellationToken,
                    sharedAlpha,
                    localAlpha,
                    localBeta);

                if(currState.CurrentPlayerId == rootAnalysisPlayerId)
                {
                    if (hypoAppraisedTurn.Appraisal > bestTurn.Appraisal)
                    {
                        bestTurn = hypoAppraisedTurn;
                        bestTurn.Turn = childState.PrevTurn;

                        if(bestTurn.Appraisal > localAlpha)
                        {
                            localAlpha = bestTurn.Appraisal;
                        }

                        if(localAlpha >= localBeta || sharedAlpha.GetAlpha() >= localBeta)
                        {
                            break;
                        }
                    }
                }
                else
                {
                    if (hypoAppraisedTurn.Appraisal < bestTurn.Appraisal)
                    {
                        bestTurn = hypoAppraisedTurn;
                        bestTurn.Turn = childState.PrevTurn;

                        if(bestTurn.Appraisal < localBeta)
                        {
                            localBeta = bestTurn.Appraisal;
                        }

                        if(localAlpha >= localBeta || sharedAlpha.GetAlpha() >= localBeta)
                        {
                            break;
                        }
                    }
                }

                if(cancellationToken.IsCancellationRequested)
                {
                    break;
                }
            }

            return bestTurn;
        }

        protected static AppraisedPlayerTurn<TTurn, TGameState> FindBestTurnTwoPlayersParallelPrioritized(
            TGameState currState,
            int analysisLevel,
            CancellationToken cancellationToken)
        {
            return FindBestTurnTwoPlayersParallelPrioritized(
                currState,
                analysisLevel,
                cancellationToken,
                AlphaInitial,
                BetaInitial);
        }

        protected static AppraisedPlayerTurn<TTurn, TGameState> FindBestTurnTwoPlayersParallelPrioritized(
            TGameState currState,
            int analysisLevel,
            CancellationToken cancellationToken,
            double alpha,
            double beta)
        {
            const int analysisLevelToParallelize = 4;

            var childStates = currState.SortedNextStates<TTurn, TGameState>();

            if(analysisLevel <= analysisLevelToParallelize)
            {
                var childStateQueue = new ConcurrentQueue<TGameState>(childStates);
                var sharedAlpha = new SpinLockedAlpha(alpha);

                //var tasks = Environment.ProcessorCount.ToRange()
                var tasks = 1.ToRange()
                    .Select(_ => Task.Run(() => FindBestTurnTwoPlayersParallelQueue(
                        currState.CurrentPlayerId,
                        childStateQueue,
                        analysisLevel - 1,
                        cancellationToken,
                        sharedAlpha,
                        beta)))
                    .ToArray();

                return tasks.Select(task => task.Result).MaxElementBy(turn => turn.Appraisal);
            }
            else
            {
                var bestTurn = AppraisedPlayerTurn<TTurn, TGameState>.EmptyMinimum;

                foreach(var childState in childStates)
                {
                    var childIsUs = currState.CurrentPlayerId == childState.CurrentPlayerId;
                    var childAlpha = childIsUs ? alpha : -beta;
                    var childBeta = childIsUs ? beta : -alpha;
                    var hypoTurn = FindBestTurnTwoPlayersParallelPrioritized(
                        childState,
                        analysisLevel - 1,
                        cancellationToken,
                        childAlpha,
                        childBeta);

                    if(!childIsUs)
                    {
                        hypoTurn.Appraisal *= -1;
                    }

                    if (bestTurn.Appraisal < hypoTurn.Appraisal)
                    {
                        bestTurn = hypoTurn;
                        bestTurn.Turn = childState.PrevTurn;

                        if(bestTurn.Appraisal > alpha)
                        {
                            alpha = bestTurn.Appraisal;

                            if(alpha >= beta)
                            {
                                break;
                            }
                        }
                    }

                    if(cancellationToken.IsCancellationRequested)
                    {
                        break;
                    }
                }

                return bestTurn;
            }
        }

        private static AppraisedPlayerTurn<TTurn,TGameState> FindBestTurnTwoPlayersParallelQueue(
            int analysisPlayerId,
            ConcurrentQueue<TGameState> childStateQueue,
            int analysisLevel,
            CancellationToken cancellationToken,
            SpinLockedAlpha sharedAlpha,
            double beta)
        {
            var bestTurn = AppraisedPlayerTurn<TTurn, TGameState>.EmptyMinimum;

            while(!cancellationToken.IsCancellationRequested
                && childStateQueue.TryDequeue(out var childState))
            {
                var alpha = sharedAlpha.GetAlpha();
                if(alpha >= beta)
                {
                    break;
                }

                var hypoTurn = FindBestTurnTwoPlayersParallelRecursive(
                    childState,
                    analysisPlayerId,
                    analysisLevel,
                    cancellationToken,
                    sharedAlpha,
                    alpha,
                    beta);

                if(bestTurn.Appraisal < hypoTurn.Appraisal)
                {
                    bestTurn.Appraisal = hypoTurn.Appraisal;
                    bestTurn.EndingState = hypoTurn.EndingState;
                    bestTurn.Turn = childState.PrevTurn;

                    sharedAlpha.Update(bestTurn.Appraisal);
                }
            }

            return bestTurn;
        }
    }

}
