#pragma warning disable CS0660 // Type defines operator == or operator != but does not override Object.Equals(object o)
#pragma warning disable CS0661 // Type defines operator == or operator != but does not override Object.GetHashCode()
namespace Kdl.Core
{
    public struct RoomId
    {
        public int Val { get; set; }

        public static bool operator==(RoomId a, RoomId b)
        {
            return a.Equals(b);
        }

        public static bool operator!=(RoomId a, RoomId b)
        {
            return !a.Equals(b);
        }
    }
}
