using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;

namespace Kdl.Core
{
    public interface IGameState<TTurn,TGameState>
        where TTurn : ITurn
        where TGameState : IGameState<TTurn,TGameState>
    {
        TGameState Copy();
        bool IsMutable { get; }
        int CurrentPlayerId { get; }
        int NumPlayers { get; }
        bool HasWinner { get; }
        int Winner { get; }
        TTurn PrevTurn { get; }
        TGameState PrevState { get; }
        TGameState AfterTurn(TTurn turn, bool mustReturnNewObject);
        List<TTurn> PossibleTurns();
        double HeuristicScore(int analysisPlayerId);
    }

    public static class GameStateExtensions
    {
        public static IEnumerable<TGameState> SortedNextStates<TTurn,TGameState>(
            this TGameState gameState,
            bool sortAscending = false)
            where TTurn : ITurn
            where TGameState : IGameState<TTurn,TGameState>
        {
            var turns = gameState.PossibleTurns();
            var nextStates = turns.Select(turn => gameState.AfterTurn(turn, true));

            double stateToScore(TGameState state) => state.HeuristicScore(gameState.CurrentPlayerId);

            nextStates
                = sortAscending
                ? nextStates.OrderBy(stateToScore)
                : nextStates.OrderByDescending(stateToScore);
            return nextStates;
        }

        public static TGameState WeightedRandomNextState<TTurn,TGameState>(
            this TGameState gameState,
            Random random)
            where TTurn : ITurn
            where TGameState : IGameState<TTurn,TGameState>
        {
            var newStates = gameState.SortedNextStates<TTurn, TGameState>(false).ToArray();

            var winningNewState = newStates.FirstOrDefault(state => state.Winner == gameState.CurrentPlayerId);
            if(winningNewState != null)
            {
                return winningNewState;
            }

            var numStates = newStates.Count();
            /*
            var desiredLinearWeightSum = random.Next(numStates * (numStates + 1) / 2);
            var stateIdx = (int)(numStates + 0.5 - 0.5 * Math.Sqrt(
                4 * numStates * numStates
                + 4 * numStates
                - 8 * desiredLinearWeightSum
                + 1));
            */
            var desiredExponentialWeightSum = random.NextDouble();
            const double decayFactor = 0.8;
            var stateIdx = (int)(
                Math.Log(1 + desiredExponentialWeightSum * (Math.Pow(decayFactor, numStates) - 1))
                / Math.Log(decayFactor)
                );
            return newStates[stateIdx];
        }

    }
}
