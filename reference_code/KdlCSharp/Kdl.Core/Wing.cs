using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Kdl.Core
{
    public record Wing(string Name, ImmutableArray<int> RoomIds)
    {
        public override string ToString()
        {
            return $"{Name};{string.Join(',', RoomIds)}";
        }
    }
}
