using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection.Metadata.Ecma335;
using Kdl.Core;

namespace Kdl.Cli
{
    public class Program
    {
        public const string DataDir = "../../../../Kdl.Core/Data";

        static int Main(string[] args)
        {
            Console.WriteLine("program begin");
            var session = new Session(args);
            session.Start();
            Console.WriteLine("program end");
            return 0;
        }

    }
}
