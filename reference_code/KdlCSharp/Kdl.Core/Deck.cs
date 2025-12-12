using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Util;

namespace Kdl.Core
{
    public interface IDeck
    {
        public List<Card> DiscardPile { get; }

        public Card Draw(int playerId);

        public List<Card> DrawMany(int playerId, int numCards)
            => numCards.Times(() => Draw(playerId))
                .Where(card => card != null)
                .ToList();

        public void Discard(Card card)
        {
            DiscardPile.Add(card);
        }
    }

    public class FairDeck : IDeck
    {
        public List<Card> DiscardPile { get; init; }
        protected SortedDictionary<int, int> _playerIdToNumDrawnCards = new();

        public Card Draw(int playerId)
        {
            _playerIdToNumDrawnCards.TryGetValue(playerId, out var numDrawnCards);
            var card = (numDrawnCards % 3) switch
            {
                0 => Card.FairFailure,
                1 => Card.FairWeapon,
                2 => Card.FairMove,
                _ => throw new Exception("bug"),
            };

            _playerIdToNumDrawnCards[playerId] = numDrawnCards + 1;
            return card;
        }
    }

    public class SuperSimpleDeck : IDeck
    {
        public List<Card> DiscardPile { get; init; }
        protected SortedDictionary<int, int> _playerIdToNumDrawnCards = new();

        public Card Draw(int playerId)
        {
            _playerIdToNumDrawnCards.TryGetValue(playerId, out var numDrawnCards);

            var card = (numDrawnCards % 3) switch
            {
                1 => Card.FairMove,
                _ => null,
            };

            _playerIdToNumDrawnCards[playerId] = numDrawnCards + 1;
            return card;
        }
    }

    public class NormalDeck : IDeck
    {
        protected List<Card> DrawPile { get; init; }
        public List<Card> DiscardPile { get; init; }

        protected const int _shuffleSeedNoShuffle = -1;

        public NormalDeck(IEnumerable<Card> cards, Random rng = null)
        {
            DiscardPile = new();

            if(rng == null)
            {
                DrawPile = new List<Card>(cards);
            }
            else
            {
                DrawPile = new List<Card>(cards.OrderBy(card => rng.Next()));
            }
        }

        public static NormalDeck FromJson(string cardsPath, Random rng = null)
        {
            var cardsJson = File.ReadAllText(cardsPath);
            var cards = JsonHelper.Deserialize<List<Card>>(cardsJson);
            var deck = new NormalDeck(cards, rng);
            return deck;
        }

        public Card Draw(int playerId) => Draw();
        public Card Draw()
        {
            var card = DrawPile[DrawPile.Count - 1];
            DrawPile.RemoveAt(DrawPile.Count - 1);
            return card;
        }

    }

}
