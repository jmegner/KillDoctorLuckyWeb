using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using CommandLine;
using Kdl.Core;
using Util;

namespace Kdl.Cli
{
    public class SessionOptions
    {

    }

    public class Session
    {
        string[] CliArgs { get; set; }
        Random Rng { get; set; } = new Random(1);
        int NumNormalPlayers { get; set; } = 2;
        int NumNormalPlayersOld { get; set; }
        string DeckName { get; set; } = "DeckStandard";
        string DeckNameOld { get; set; }
        string BoardName { get; set; } = "BoardAltDown"; //"BoardMain";
        string BoardNameOld { get; set; }
        List<string> ClosedWingNames { get; set; } = new() { }; //{ "west" };
        List<string> ClosedWingNamesOld { get; set; }
        RuleFlags Rules { get; set; } = RuleFlags.SuperSimple;
        CommonGameState GameCommon { get; set; }
        MutableGameState Game { get; set; }
        bool ShouldQuit { get; set; }
        double AnalysisLevel { get; set; } = 1;
        SimpleTurn RecentAnalyzedTurn { get; set; }
        McTreeSearch<SimpleTurn,MutableGameState> Mcts { get; set; }

        string BoardPath => JsonFilePath(BoardName);
        string DeckPath => JsonFilePath(DeckName);
        string JsonFilePath(string baseName) => Program.DataDir + "/" + baseName + ".json";


        public Session(string[] cliArgs = null)
        {
            CliArgs = cliArgs ?? new string[0];
        }

        public void Start()
        {
            Fiddle(null);
            ResetGame();
            InterpretationLoop();
        }

        public void InterpretationLoop()
        {
            while (true)
            {
                Console.Write(UserPromptText());
                var line = Console.ReadLine();
                var sublines = line.Split(';');

                foreach (var subline in sublines)
                {
                    InterpretDirective(subline);
                    if(ShouldQuit)
                    {
                        return;
                    }
                }
            }
        }

        protected string WithoutComments(string directive)
        {
            const char commentStartChar = '(';
            const char commentEndChar = ')';

            while(directive.IndexOf(commentStartChar) > -1)
            {
                var commentStartIdx = directive.IndexOf(commentStartChar);
                var commentEndIdx = directive.IndexOf(commentEndChar);

                if(commentEndIdx == -1)
                {
                    directive = directive.Substring(0, commentStartIdx);
                }
                else
                {
                    directive = directive.Substring(0, commentStartIdx) + directive.Substring(commentEndIdx + 1);
                }
            }

            return directive;
        }

        const string TagFiddle = "f";
        const string TagQuit = "q";
        const string TagDisplay = "d";
        const string TagReset = "r";
        const string TagRepeat = "x";
        const string TagHistory = "h";
        const string TagUndo = "u";
        const string TagAnalyze = "a";
        const string TagAnalyzeAscending = "aa";
        const string TagMctsAnalysis = "m";
        const string TagExecuteAnalysis = "e";
        const string TagExecutePreviousAnalysis = "ep";
        const string TagBoard = "b";
        const string TagBoardLong = "board";
        const string TagPlayers = "p";
        const string TagPlayersLong = "numplayers";
        const string TagClosedWings = "w";
        const string TagClosedWingsLong = "closedwings";
        const string TagSetValue = "sv";
        const string TagSetValueLong = "setvalue";

        protected void InterpretDirective(string directive)
        {
            directive = WithoutComments(directive);
            var tokens = directive.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var directiveTag = tokens.Length == 0 ? "" : tokens[0].ToLowerInvariant().Trim();

            if (string.IsNullOrWhiteSpace(directive))
            {
                // deliberately nothing
            }
            else if (directiveTag == TagQuit)
            {
                ShouldQuit = true;
            }
            else if (directiveTag == TagFiddle)
            {
                Fiddle(tokens);
            }
            else if (directiveTag == TagDisplay)
            {
                PrintGameSettings();
                Console.WriteLine(Game.Summary(1));
            }
            else if (directiveTag == TagReset)
            {
                Console.WriteLine("(RESET)");
                ResetGame();
            }
            else if (directiveTag == TagUndo)
            {
                Console.WriteLine("(UNDO)");

                do
                {
                    Game = Game.PrevState;
                } while (!Game.IsNormalTurn);

                Console.WriteLine(Game.Summary(1));
            }
            else if (directiveTag == TagRepeat)
            {
                if(tokens.Length > 1 && int.TryParse(tokens[1], out var numRepeats))
                {
                    var directiveToRepeat = string.Join(' ', tokens.Skip(2));
                    Console.WriteLine($"(REPEAT {numRepeats}: {directiveToRepeat})");
                    foreach(var i in numRepeats.ToRange())
                    {
                        InterpretDirective(directiveToRepeat);
                    }
                }
                else
                {
                    Console.WriteLine($"directive {directiveTag} needs repetition count and directive to repeat");
                }
            }
            else if (directiveTag == TagHistory)
            {
                Console.WriteLine(TagPlayers + " " + NumNormalPlayersOld + ";");
                Console.WriteLine(TagBoard + " " + BoardNameOld + ";");
                Console.WriteLine(TagClosedWings + " " + string.Join(' ', ClosedWingNamesOld) + ";");
                Console.Write(TagReset + "; ");

                if (tokens.Length >= 2 && bool.TryParse(tokens[1], out var verbose))
                {
                    // verbose option not implemented yet
                    Console.WriteLine(Game.NormalTurnHist());
                }
                else
                {
                    Console.WriteLine(Game.NormalTurnHist());
                }
            }
            else if (directiveTag == TagAnalyze
                || directiveTag == TagAnalyzeAscending
                || directiveTag == TagMctsAnalysis
                || directiveTag == TagExecuteAnalysis)
            {
                if (tokens.Length >= 2 && double.TryParse(tokens[1], out var analysisLevel))
                {
                    AnalysisLevel = analysisLevel;
                }

                if (!(tokens.Length >= 3 && int.TryParse(tokens[2], out var numTopResults)))
                {
                    numTopResults = 6;
                }

                bool doSuggestedMove = directiveTag == TagExecuteAnalysis;

                if(directiveTag == TagMctsAnalysis)
                {
                    AnalyzeMcts(doSuggestedMove, AnalysisLevel, numTopResults);
                }
                else
                {
                    var startingAnalysisLevel = directiveTag == TagAnalyzeAscending ? 1 : AnalysisLevel;

                    for(var level = (int)startingAnalysisLevel; level <= AnalysisLevel; level++)
                    {
                        Analyze(doSuggestedMove, level, 1);
                        //Analyze(doSuggestedMove, level, Environment.ProcessorCount);
                    }
                }
            }
            else if (directiveTag == TagExecutePreviousAnalysis)
            {
                if(RecentAnalyzedTurn != null)
                {
                    DoMoves(RecentAnalyzedTurn);
                }
                else
                {
                    Console.WriteLine("no recent analyzed move");
                }
            }
            else if (directiveTag == TagBoard || directiveTag == TagBoardLong)
            {
                if(tokens.Length != 2)
                {
                    Console.WriteLine("  board directive needs two tokens");
                }
                else
                {
                    BoardName = tokens[1];

                    if (!BoardName.Contains("Board", StringComparison.OrdinalIgnoreCase))
                    {
                        BoardName = "Board" + BoardName;
                    }
                }

                PrintGameSettings();
            }
            else if (directiveTag == TagClosedWings || directiveTag == TagClosedWingsLong)
            {
                ClosedWingNames = tokens.Skip(1).ToList();
                PrintGameSettings();
            }
            else if (directiveTag == TagPlayers || directiveTag == TagPlayersLong)
            {
                var newVal = NumNormalPlayers;
                if(tokens.Length != 2 || !int.TryParse(tokens[1], out newVal))
                {
                    Console.WriteLine($"  {TagPlayersLong} directive needs one integer token");
                }
                else
                {
                    NumNormalPlayers = newVal;
                }

                PrintGameSettings();
            }
            else if(directiveTag == TagSetValue || directiveTag == TagSetValueLong)
            {
                const int doctorPlayerNum = 0;

                if(tokens.Length <= 3
                    || !int.TryParse(tokens[1], out var playerNum)
                    || playerNum < 0
                    || playerNum > Game.Common.NumAllPlayers
                    || !double.TryParse(tokens[3], out var attributeValue)
                    )
                {
                    Console.WriteLine($"  {TagSetValueLong} directive needs following tokens: playerNum attributeName attributeValue");
                    return;
                }

                var attributeName = tokens[2];
                var playerId = playerNum - 1;

                if (attributeName == "r" || attributeName == "room")
                {
                    if (!Game.Common.Board.RoomIds.Contains((int)attributeValue))
                    {
                        Console.WriteLine($"  invalid room id {attributeValue}");
                        return;
                    }

                    if(playerNum == doctorPlayerNum)
                    {
                        Game.DoctorRoomId = (int)attributeValue;
                    }
                    else
                    {
                        Game.PlayerRoomIds[playerId] = (int)attributeValue;
                    }
                }
                else if (attributeName == "s" || attributeName == "strength")
                {
                    Game.PlayerStrengths[playerId] = (int)attributeValue;
                }
                else if (attributeName == "m" || attributeName == "moves")
                {
                    Game.PlayerMoveCards[playerId] = attributeValue;
                }
                else if (attributeName == "w" || attributeName == "weapons")
                {
                    Game.PlayerWeapons[playerId] = attributeValue;
                }
                else if (attributeName == "f" || attributeName == "failures")
                {
                    Game.PlayerFailures[playerId] = attributeValue;
                }
                else if (attributeName == "t" || attributeName == "turn")
                {
                    Game.TurnId = (int)attributeValue;
                    Game.CurrentPlayerId = playerId;
                }

                RecentAnalyzedTurn = null;
                Console.WriteLine(Game.Summary(1));
            }
            else if(char.IsDigit(directiveTag.FirstOrDefault()))
            {
                DoMoves(tokens);
            }
            else
            {
                var explanations = new List<string>()
                {
                    "q       | quit",
                    "d       | display game state",
                    "r       | reset game",
                    "h       | display user-turn history",
                    "a [int] | analyze next move [int] deep",
                    "board [boardName]",
                    "closedwings [wing1] [wing2] [...]",
                    "numplayers [int]",
                    "[playerNum@destRoomId] [destRoomIdForCurrentPlayer] submit turn of those moves"
                };

                Console.WriteLine($"  unrecognized directive '{directive}'");
                explanations.Sort();
                explanations.ForEach(x => Console.WriteLine("  " + x));
            }
        }

        void Fiddle(IList<string> tokens)
        {
            /*
            var random = new Random(7);
            var numStates = 5;
            var hist = new int[numStates];
            var numIters = (int)1e6;

            foreach(var i in numIters.ToRange())
            {
                var desiredExponentialWeightSum = random.NextDouble();
                const double exponentialDecayFactor = 0.9;
                var stateIdx
                    = (int)(Math.Log(
                        1 + desiredExponentialWeightSum
                        * (Math.Pow(exponentialDecayFactor, numStates) - 1))
                    / Math.Log(exponentialDecayFactor));
                hist[stateIdx]++;
            }

            var decays = (numStates - 1).ToRange().Select(i => ((double)hist[i + 1]) / hist[i]);
            Console.WriteLine("decays: " + string.Join(", ", decays));
            */
        }

        protected void PrintGameSettings()
        {
            Console.WriteLine($"  NormalPlayers(p): {NumNormalPlayers}");
            Console.WriteLine($"  Board(b):         {BoardName}");
            Console.WriteLine($"  ClosedWings(w):   {string.Join(", ", ClosedWingNames)}");
            Console.WriteLine($"  AnalysisLevel(a): {AnalysisLevel}");
        }

        T RunCancellableFunc<T>(Func<T> func, CancellationTokenSource cancelSource, bool printNotice = false)
        {
            if(printNotice)
            {
                Console.WriteLine("Press any key to cancel...");
            }

            var calcTask = Task.Run(func);

            while(!calcTask.IsCompleted)
            {
                if(Console.KeyAvailable)
                {
                    _ = Console.ReadKey(true);

                    if(printNotice)
                    {
                        Console.WriteLine("Cancelling...");
                    }

                    cancelSource.Cancel();
                }
                else
                {
                    Thread.Sleep(1);
                }
            }

            return calcTask.Result;
        }

        protected void Analyze(bool doSuggestedMove, int analysisLevel, int parallelization)
        {
            var cancelSource = new CancellationTokenSource();
            int numStatesVisited = -1;

            var watch = System.Diagnostics.Stopwatch.StartNew();
            var appraisedTurn = RunCancellableFunc(
                () => TreeSearch<SimpleTurn,MutableGameState>.FindBestTurn(
                    Game,
                    analysisLevel,
                    cancelSource.Token,
                    out numStatesVisited,
                    parallelization),
                cancelSource,
                false);
            watch.Stop();

            if(appraisedTurn.Turn != null)
            {
                RecentAnalyzedTurn = new SimpleTurn(appraisedTurn.Turn);
            }

            var scoreText = appraisedTurn.Appraisal switch
            {
                RuleHelper.HeuristicScoreWin => "WIN",
                RuleHelper.HeuristicScoreLoss => "LOSE",
                _ => appraisedTurn.Appraisal.ToString("+0.0000;-0.0000"),
            };

            Console.WriteLine(
                $"bestTurn={appraisedTurn.Turn,-10}"
                + " level=" + analysisLevel
                + " appraisal=" + scoreText
                + " states=" + numStatesVisited.ToString("N0")
                + " timeSec=" + (watch.ElapsedMilliseconds / 1000.0).ToString("F2")
                );

            if(doSuggestedMove && !cancelSource.IsCancellationRequested)
            {
                DoMoves(appraisedTurn.Turn);
            }
        }

        protected void AnalyzeMcts(bool doSuggestedMove, double analysisSeconds, int numTopResults)
        {
            var cancelSource = new CancellationTokenSource(TimeSpan.FromSeconds(analysisSeconds));

            if(Mcts == null)
            {
                Mcts = new McTreeSearch<SimpleTurn, MutableGameState>(Game, new Random(1));
                Mcts.Settings.TreeParallelism = 3;
            }
            else
            {
                Mcts.Reroot(Game);
            }

            var watch = System.Diagnostics.Stopwatch.StartNew();
            var topNodes = RunCancellableFunc(
                () => Mcts.GetTopTurns(cancelSource.Token),
                cancelSource,
                false);
            watch.Stop();

            Console.WriteLine($"  MCTS: t={watch.Elapsed.TotalSeconds:F1}, n={Mcts.NumRuns}, w={Mcts.NumWins/Mcts.NumRuns:F3}");

            foreach(var node in topNodes.Take(numTopResults))
            {
                Console.WriteLine("    " + node);
            }

            RecentAnalyzedTurn = topNodes.FirstOrDefault()?.TurnTaken;

            if(doSuggestedMove && RecentAnalyzedTurn != null && !cancelSource.IsCancellationRequested)
            {
                DoMoves(RecentAnalyzedTurn);
            }
        }

        protected void DoMoves(IList<string> tokens)
        {
            if(Game.HasWinner)
            {
                Console.WriteLine($"{Game.PlayerText(Game.Winner)} won already.  Moves not accepted.");
                return;
            }

            var moves = new List<PlayerMove>();
            bool hasParseErrors = false;

            foreach (var token in tokens)
            {
                var subtokens = token.Split(',', '@');
                var idxForDestRoomId = subtokens.Length == 1 ? 0 : 1;
                var destRoomIdSubtoken = subtokens.Length == 1 ? subtokens[0] : subtokens[1];
                int playerDisplayNum = Game.CurrentPlayerId + 1;

                if (int.TryParse(destRoomIdSubtoken, out var destRoomId))
                {
                    if (subtokens.Length >= 2 && !int.TryParse(subtokens[0], out playerDisplayNum))
                    {
                        Console.WriteLine($"  failed parse for room id from '{subtokens[0]}' subtoken of '{token}'");
                        hasParseErrors = true;
                    }
                    else
                    {
                        var playerId = playerDisplayNum - 1;
                        moves.Add(new PlayerMove(playerId, destRoomId));
                    }
                }
                else
                {
                    Console.WriteLine($"  failed parse for room id from '{token}'");
                    hasParseErrors = true;
                }
            }

            if (!hasParseErrors)
            {
                DoMoves(new SimpleTurn(moves));
            }
        }

        protected void DoMoves(SimpleTurn turn)
        {
            RecentAnalyzedTurn = null;

            if (Game.CheckNormalTurn(turn, out var errorMsg))
            {
                Game = Game.Copy().AfterNormalTurn(turn, true);
            }
            else
            {
                Console.WriteLine($"  invalid turn: {errorMsg}");
            }
        }

        protected bool ResetGame(out List<string> problems)
        {
            try
            {
                var board = Board.FromJsonFile(BoardPath, ClosedWingNames);

                if(!board.IsValid(out var mistakes))
                {
                    throw new Exception("board is invalid:\n" + string.Join('\n', mistakes));
                }

                GameCommon = new(
                    true,
                    board,
                    NumNormalPlayers);

                Game = MutableGameState.AtStart(GameCommon);

                BoardNameOld = BoardName;
                DeckNameOld = DeckName;
                NumNormalPlayersOld = NumNormalPlayers;
                ClosedWingNamesOld = ClosedWingNames;
            }
            catch(Exception e)
            {
                Console.WriteLine("exception while constructing GameState: " + e.Message);
                Console.WriteLine(e.StackTrace);
            }

            return GameCommon.Board.IsValid(out problems);
        }

        protected bool ResetGame()
        {
            var result = ResetGame(out var problems);

            if (result)
            {
                PrintGameSettings();
                Console.WriteLine(Game.Summary(1));
            }
            else
            {
                Console.WriteLine("problems resetting game");
                foreach(var problem in problems)
                {
                    Console.WriteLine("  " + problem);
                }
            }

            return result;
        }

        protected string UserPromptText()
            => Game.HasWinner
            ? Game.PlayerText(Game.Winner) + " WON> "
            : Game.PlayerText() + "> ";
    }
}
