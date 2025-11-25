using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Util
{
    public static class IEnumerableExtensions
    {
        private static readonly Random _random = new();

        public static T RandomChoice<T>(this ICollection<T> source, Random random = null)
        {
            var i = (random ?? _random).Next(source.Count);
            return source.ElementAt(i);
        }

        static IEnumerable<IEnumerable<T>> CartesianProduct<T>(this IEnumerable<IEnumerable<T>> sequences)
        {
            IEnumerable<IEnumerable<T>> emptyProduct = new[] { Enumerable.Empty<T>() };
            return sequences.Aggregate(
                emptyProduct,
                (accumulator, sequence) =>
                    from accseq in accumulator
                    from item in sequence
                    select accseq.Concat(new[] { item })
                );
        }

        public static T MaxElementBy<T>(this IEnumerable<T> source, Func<T, double> selector)
        {
            var currentMaxElement = default(T);
            var currentMaxValue = double.MinValue;

            foreach (var element in source)
            {
                var value = selector(element);
                if (currentMaxValue < value)
                {
                    currentMaxValue = value;
                    currentMaxElement = element;
                }
            }

            return currentMaxElement;
        }

        public static (TElem, TCriteria) MaxElementAndCriteria<TElem,TCriteria>(
            this IEnumerable<TElem> source,
            Func<TElem, TCriteria> selector)
            where TCriteria : IComparable<TCriteria>
        {
            var maxElem = source.First();
            var maxCriteria = selector(maxElem);

            foreach (var elem in source)
            {
                var criteria = selector(elem);
                if (maxCriteria.CompareTo(criteria) < 0)
                {
                    maxCriteria = criteria;
                    maxElem = elem;
                }
            }

            return (maxElem, maxCriteria);
        }

        public static IEnumerable<T> TakeRatio<T>(this IEnumerable<T> source, double ratio, int minimumCount = 1)
        {
            if(ratio >= 1.0 || source.Count() < minimumCount)
            {
                return source;
            }

            return source.Take(1 + (int)(ratio * source.Count()));
        }
    }
}
