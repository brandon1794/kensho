namespace KaizenReport.Kensho.Core;

// Mirrors stableCaseId() from packages/schema/index.js byte-for-byte. The JS
// version walks UTF-16 code units (charCodeAt) so we must do the same — using
// UTF-8 bytes here would produce different hashes for any non-ASCII input
// and silently break test-history correlation across language adapters.
public static class StableId
{
    private const uint FnvOffset1 = 0x811c9dc5u;
    private const uint FnvOffset2 = 0x01000193u;
    private const uint Prime1 = 0x01000193u;
    private const uint Prime2 = 0x85ebca6bu;

    public static string Compute(string? fullName, string? filePath)
    {
        var s = (fullName ?? string.Empty) + "::" + (filePath ?? string.Empty);
        uint h1 = FnvOffset1;
        uint h2 = FnvOffset2;
        for (var i = 0; i < s.Length; i++)
        {
            uint c = s[i];
            unchecked
            {
                h1 = (h1 ^ c) * Prime1;
                h2 = (h2 ^ c) * Prime2;
            }
        }
        return "tc_" + h1.ToString("x8") + h2.ToString("x8");
    }
}
