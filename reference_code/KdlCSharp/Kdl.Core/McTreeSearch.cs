using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Util;

namespace Kdl.Core
{
    public class McTreeSearch<TTurn,TGameState>
        where TTurn : ITurn
        where TGameState : IGameState<TTurn,TGameState>
    {
        public class Options
        {
            public bool PlayoutIsUniform { get; set; } = true;
            public bool ExpansionIsEager { get; set; } = true;
            public int TreeParallelism { get; set; } = 1;
            //public int PlayoutParallelism { get; set; } = 1; // not worth it
        }

        protected Node _root;
        protected Random _random;
        public Options Settings { get; set; } = new Options();

        public McTreeSearch(TGameState gameState, Random random = null)
        {
            _random = random ?? new Random();
            _root = new Node(null, gameState);
        }

        public long NumRuns => _root.Children.Sum(child => child.NumRuns);
        public double NumWins => _root.Children.Sum(child => child.NumWins);

        public IEnumerable<Node> GetTopTurns(CancellationToken token)
        {
            if (Settings.TreeParallelism == 1)
            {
                _root.BuildTree(token, Settings, _random);
            }
            else
            {
                _root.BuildTreeParallel(token, Settings);
            }

            //IsTreeValid();
            return _root.Children
                .OrderByDescending(child => child.ExploitationValue)
                .OrderByDescending(child => child.NumRuns);
        }

        protected bool IsTreeValid(Node node = null, List<int> childrenIdxs = null)
        {
            node ??= _root;
            childrenIdxs ??= new();
            var isValid = true;

            var childrenRunSum = node.Children.Sum(child => child.NumRuns);
            if(!node.GameState.HasWinner
                && childrenRunSum != node.NumRuns
                && childrenRunSum + 1 != node.NumRuns)
            {
                Console.WriteLine($"node({string.Join(',', childrenIdxs)}) {node} has NumRuns mismatch");
                isValid = false;
            }

            /*
            if(node.Parent != null)
            {
                var choosingPlayer = node.Parent.GameState.CurrentPlayerId;
                var winSum = 0;

                foreach(var child in node.Children)
                {
                    if(child.GameState.CurrentPlayerId)
                }
            }
            */

            for(var i = 0; i < node.Children.Count; i++)
            {
                var child = node.Children[i];
                childrenIdxs.Add(i);

                if(!IsTreeValid(child, childrenIdxs))
                {
                    isValid = false;
                }

                childrenIdxs.RemoveAt(childrenIdxs.Count - 1);
            }

            return isValid;
        }

        public bool Reroot(TGameState goalState)
        {
            var stateHist = new List<TGameState>();
            var state = goalState;

            while(state != null)
            {
                stateHist.Add(state);
                state = state.PrevState;
            }

            stateHist.Reverse();

            foreach(var fwdState in stateHist)
            {
                var matchingChild = _root.Children.Where(child => child.GameState.Equals(fwdState)).FirstOrDefault();
                if(matchingChild != default)
                {
                    _root = matchingChild;
                }
            }

            if(_root.GameState.Equals(goalState))
            {
                _root.ForgetParent();
                return true;
            }

            _root = new Node(null, goalState);
            return false;
        }

        public class Node
        {
            public Node Parent { get; set; }
            public IList<Node> Children { get; init; } = new List<Node>();
            public long NumRuns { get; set; }
            public double NumWins { get; set; }
            public TGameState GameState { get; init; }
            public TTurn TurnTaken => GameState.PrevTurn;
            public List<TGameState> UntriedNextStates { get; init; }
            public const double ExplorationCoefficient = 1.4142135623730950488; // sqrt(2)
            public double HeuristicScoreForPrevPlayer { get; init; }
            public double ExploitationValue => NumWins / NumRuns;
            public double ExplorationValue => ExplorationCoefficient * Math.Sqrt(Math.Log(Parent.NumRuns) / NumRuns);
            public double HeuristicValue => Math.Atan(HeuristicScoreForPrevPlayer) / Math.Sqrt(NumRuns); // Math.Pow(NumRuns, 1.0 / 3.0);
            public double Uct => ExploitationValue + ExplorationValue;
            public double SelectionPreferenceValue => ExploitationValue + ExplorationValue + HeuristicValue;

            public Node(
                Node parent,
                TGameState gameState)
            {
                Parent = parent;
                GameState = gameState;
                HeuristicScoreForPrevPlayer = gameState.HeuristicScore(parent?.GameState.CurrentPlayerId ?? 0);
                UntriedNextStates = gameState.SortedNextStates<TTurn,TGameState>(true).ToList();

                var winningNextState = UntriedNextStates.FirstOrDefault(state => state.Winner == GameState.CurrentPlayerId);
                if(winningNextState != null)
                {
                    UntriedNextStates.Clear();
                    UntriedNextStates.Add(winningNextState);
                    UntriedNextStates.TrimExcess();
                }
            }

            public override string ToString()
                => $"{TurnTaken, -10} {NumWins, 6}/{NumRuns, -6}, HS={HeuristicScoreForPrevPlayer,6:F3}"
                + $", {HeuristicValue,6:F4} + {ExploitationValue:F4} + {ExplorationValue:F4} = {SelectionPreferenceValue:F4}";

            public void ForgetParent() => Parent = null;

            public Node FindNode(TGameState state)
            {
                if(GameState.Equals(state))
                {
                    return this;
                }

                return Children
                    .Select(child => child.FindNode(state))
                    .FirstOrDefault(foundNode => foundNode != null);
            }

            public double HypotheticalSelectionPreferenceValue(TGameState gameState, int decidingPlayerId, long parentNumRuns)
                => Math.Atan(gameState.HeuristicScore(decidingPlayerId))
                + 0.5 // pretend half-win
                + ExplorationCoefficient * Math.Sqrt(Math.Log(parentNumRuns));

            public void BuildTree(CancellationToken token, Options settings, Random random = null)
            {
                random ??= new Random();

                while(!token.IsCancellationRequested)
                {
                    var node = this;

                    if(settings.ExpansionIsEager)
                    {
                        // phase: select
                        while(!node.UntriedNextStates.Any() && !node.GameState.HasWinner)
                        {
                            node = node.Children.MaxElementBy(child => child.SelectionPreferenceValue);
                        }

                        // phase: expand
                        node = node.Expand();
                    }
                    else // phase: hybrid select+expand
                    {
                        while(!node.GameState.HasWinner)
                        {
                            Node bestChild = default;
                            var childPrefValue = double.MinValue;
                            TGameState bestUntriedState = default;
                            var untriedStatePrefValue = double.MinValue;

                            if(node.Children.Any())
                            {
                                (bestChild, childPrefValue) = node.Children.MaxElementAndCriteria(child
                                    => child.SelectionPreferenceValue);
                            }

                            if(node.UntriedNextStates.Any())
                            {
                                bestUntriedState = node.UntriedNextStates[node.UntriedNextStates.Count - 1];
                                untriedStatePrefValue = HypotheticalSelectionPreferenceValue(
                                    bestUntriedState,
                                    node.GameState.CurrentPlayerId,
                                    node.NumRuns);
                            }

                            if(childPrefValue > untriedStatePrefValue)
                            {
                                node = bestChild;
                            }
                            else
                            {
                                node = node.Expand();
                                break;
                            }
                        }
                    }

                    // phase: simulate
                    var terminalState = SimulateToEnd(node.GameState, settings, random);

                    // phase: back propagate simulation results
                    while(node != null)
                    {
                        node.NumRuns++;

                        if(terminalState.Winner == node.Parent?.GameState.CurrentPlayerId)
                        {
                            node.NumWins++;
                        }

                        node = node.Parent;
                    }
                }
            }

            public void BuildTreeParallel(CancellationToken token, Options settings)
            {
                var tasks = settings.TreeParallelism.ToRange()
                    .Select(i => Task.Run(() => BuildTreeParallelPieceSafeAndSlow(token, settings)))
                    //.Select(i => Task.Run(() => BuildTreeParallelPieceFastAndInaccurate(token, settings)))
                    .ToArray();
                Task.WaitAll(tasks);
            }

            public void BuildTreeParallelPieceSafeAndSlow(CancellationToken token, Options settings)
            {
                var random = new Random();

                while(!token.IsCancellationRequested)
                {
                    var node = this;
                    Monitor.Enter(node);

                    // select descendant
                    while(!node.UntriedNextStates.Any() && !node.GameState.HasWinner)
                    {
                        // deliberately not locking child nodes;
                        // my hope is that it's okay for SelectionPreferenceValue to be slightly wrong
                        var selectedChild = node.Children.MaxElementBy(child => child.SelectionPreferenceValue);
                        Monitor.Exit(node);
                        node = selectedChild;
                        Monitor.Enter(node);
                    }

                    var parentIsLocked = false;

                    // expand
                    if(node.UntriedNextStates.Any())
                    {
                        var lastIdx = node.UntriedNextStates.Count - 1;
                        var stateToTry = node.UntriedNextStates[lastIdx];
                        node.UntriedNextStates.RemoveAt(lastIdx);

                        if(node.UntriedNextStates.Count == 0)
                        {
                            node.UntriedNextStates.TrimExcess();
                        }

                        var child = new Node(node, stateToTry);
                        node.Children.Add(child);
                        node = child;
                        parentIsLocked = true;
                        Monitor.Enter(node);
                    }

                    // phase: playout
                    var terminalState = SimulateToEnd(node.GameState, settings, random);

                    // phase: back propagate playout results
                    while(node != null)
                    {
                        if(!parentIsLocked && node.Parent != null)
                        {
                            Monitor.Enter(node.Parent);
                            parentIsLocked = true;
                        }

                        node.NumRuns++;

                        if(terminalState.Winner == node.Parent?.GameState.CurrentPlayerId)
                        {
                            node.NumWins++;
                        }

                        Monitor.Exit(node);
                        node = node.Parent; // already done Monitor.Enter on node.Parent
                        parentIsLocked = false;
                    }
                }
            }

            public void BuildTreeParallelPieceFastAndInaccurate(CancellationToken token, Options settings)
            {
                var random = new Random();

                while(!token.IsCancellationRequested)
                {
                    var node = this;
                    bool wantRestart = false;

                    // select descendant
                    while(!node.GameState.HasWinner)
                    {
                        lock(node.UntriedNextStates)
                        {
                            if(node.UntriedNextStates.Any())
                            {
                                break;
                            }
                        }

                        lock(node.Children)
                        {
                            if(!node.Children.Any())
                            {
                                wantRestart = true;
                            }
                            node = node.Children.MaxElementBy(child => child.SelectionPreferenceValue);
                        }
                    }

                    if(wantRestart)
                    {
                        continue;
                    }

                    bool didExpand = false;

                    // expand
                    lock(node.UntriedNextStates)
                    {
                        if(node.UntriedNextStates.Any())
                        {
                            var lastIdx = node.UntriedNextStates.Count - 1;
                            var stateToTry = node.UntriedNextStates[lastIdx];
                            node.UntriedNextStates.RemoveAt(lastIdx);

                            node = new Node(node, stateToTry);
                            didExpand = true;
                        }
                    }

                    // phase: playout
                    var terminalState = SimulateToEnd(node.GameState, settings, random);

                    if(didExpand)
                    {
                        node.NumRuns++;

                        if(terminalState.Winner == node.Parent.GameState.CurrentPlayerId)
                        {
                            node.NumWins++;
                        }

                        lock(node.Parent.Children)
                        {
                            node.Parent.Children.Add(node);
                        }

                        node = node.Parent;
                    }

                    // phase: back propagate playout results
                    while(node != null)
                    {
                        node.NumRuns++;

                        if(terminalState.Winner == node.Parent?.GameState.CurrentPlayerId)
                        {
                            node.NumWins++;
                        }

                        node = node.Parent;
                    }
                }
            }

            protected Node Expand()
            {
                if(!UntriedNextStates.Any())
                {
                    return this;
                }

                var lastIdx = UntriedNextStates.Count - 1;
                var stateToTry = UntriedNextStates[lastIdx];
                UntriedNextStates.RemoveAt(lastIdx);

                if(UntriedNextStates.Count == 0)
                {
                    UntriedNextStates.TrimExcess();
                }

                var child = new Node(this, stateToTry);
                Children.Add(child);
                return child;
            }

            protected static TGameState SimulateToEnd(TGameState gameState, Options settings, Random random = null)
            {
                random ??= new Random();

                if(gameState.IsMutable && !gameState.HasWinner)
                {
                    gameState = gameState.Copy();
                }

                if(settings.PlayoutIsUniform)
                {
                    while (!gameState.HasWinner)
                    {
                        var turns = gameState.PossibleTurns();
                        var turn = turns[random.Next(turns.Count)];
                        gameState = gameState.AfterTurn(turn, false);
                    }
                }
                else
                {
                    while (!gameState.HasWinner)
                    {
                        gameState = gameState.WeightedRandomNextState<TTurn, TGameState>(random);
                    }
                }

                return gameState;
            }


        }
    }
}
