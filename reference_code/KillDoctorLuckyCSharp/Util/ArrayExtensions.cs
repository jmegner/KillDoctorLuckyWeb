using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Util
{
    public static class ArrayExtensions
    {
        public static ImmutableArray<T> WithVal<T>(this ImmutableArray<T> origArray, int idx, T newVal)
        {
            if(origArray[idx].Equals(newVal))
            {
                return origArray;
            }

            var builder = origArray.ToBuilder();
            builder[idx] = newVal;

            var newArray = builder.ToImmutableArray();
            return newArray;
        }

        public static ImmutableArray<int> IncrementVal(this ImmutableArray<int> origArray, int idx, int increment)
        {
            return origArray.WithVal(idx, origArray[idx] + increment);
        }

        public static ImmutableArray<double> IncrementVal(this ImmutableArray<double> origArray, int idx, double increment)
        {
            return origArray.WithVal(idx, origArray[idx] + increment);
        }

    }
}
