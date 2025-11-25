using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Kdl.Core
{
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public enum CardType
    {
        Weapon,
        Move,
        Failure,
    }

    public static class CardTypeExtensions
    {
        public static string ToTerseString(this CardType cardType) => cardType switch
            {
                CardType.Weapon => "W",
                CardType.Move => "M",
                CardType.Failure => "F",
                _ => ((int)cardType).ToString(),
            };
    }

    public record Card(
        CardType Type,
        string Name,
        string RoomName,
        int Clover,
        int Move,
        int Attack,
        int SpecialAttack)
    {
        public static Card FairFailure = Card.NewFailure("FairFailure", 2);
        public static Card FairMove = Card.NewMove("FairMove", 1, 1);
        public static Card FairWeapon = Card.NewWeapon("FairWeapon", "NoRoom", 1, 2, 5);

        public static Card NewFailure(
            string name,
            int clover)
        {
            var card = new Card(
                CardType.Failure,
                name,
                "",
                clover,
                0,
                0,
                0);
            return card;
        }

        public static Card NewMove(
            string roomName,
            int clover,
            int move)
        {
            var card = new Card(
                CardType.Move,
                roomName,
                roomName,
                clover,
                move,
                0,
                0);
            return card;
        }

        public static Card NewWeapon(
            string name,
            string roomName,
            int clover,
            int attack,
            int specialAttack)
        {
            var card = new Card(
                CardType.Weapon,
                name,
                roomName,
                clover,
                0,
                attack,
                specialAttack);
            return card;
        }

        public override string ToString()
        {
            var text = Type switch
            {
                CardType.Failure => Type.ToTerseString() + Clover,
                CardType.Move => Type.ToTerseString() + Move + ";" + RoomName + ";c=" + Clover,
                CardType.Weapon => Type.ToTerseString() + Attack + "/" + SpecialAttack + ";" + RoomName + ";c=" + Clover,
                _ => throw new System.Exception("weird CardType " + (int)Type),
            };
            return text;
        }
    }
}
