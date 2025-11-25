using System;
using System.Collections.Generic;
using System.Linq;

namespace Util
{
    public static class IntExtensions
    {
        public static IEnumerable<int> ToRange(this int count, int start = 0)
            => Enumerable.Range(start, count);
        public static IEnumerable<T> Times<T>(this int count, Func<T> func)
            => Enumerable.Range(0, count).Select(_ => func());

        public static IEnumerable<T> Times<T>(this int count, T val)
            => Enumerable.Range(0, count).Select(_ => val);

        public static int PositiveRemainder(this int x, int modulus)
        {
            int remainder = x % modulus;
            return remainder >= 0 ? remainder : remainder + modulus;
        }
    }
}
