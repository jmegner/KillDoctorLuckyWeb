using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Util
{
    public class Print
    {
        public static string Indentation(int indentationLevel)
            => new(' ', 2 * indentationLevel);
    }
}
