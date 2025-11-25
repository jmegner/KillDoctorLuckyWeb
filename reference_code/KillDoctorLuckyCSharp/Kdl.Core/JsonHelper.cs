using System.Text.Json;
using System.Text.Json.Serialization;

namespace Kdl.Core
{
    public class JsonHelper
    {
        public static JsonSerializerOptions JsonOptions { get; } = new()
        {
            AllowTrailingCommas = true,
            NumberHandling = JsonNumberHandling.AllowReadingFromString,
            PropertyNameCaseInsensitive = true,
            ReadCommentHandling = JsonCommentHandling.Skip,
        };

        public static T Deserialize<T>(string json)
        {
            return JsonSerializer.Deserialize<T>(json, JsonOptions);
        }
    }
}
