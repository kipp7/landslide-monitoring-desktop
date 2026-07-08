using System;
using System.IO;
using System.Text;

namespace LandslideDesk.Win;

internal static class CrashReporter
{
    private static readonly string AppDataRoot = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "LandslideDesk.Win"
    );

    internal static string Write(Exception exception)
    {
        Directory.CreateDirectory(AppDataRoot);
        var fileName = $"crash-{DateTime.Now:yyyyMMdd-HHmmss}.log";
        var path = Path.Combine(AppDataRoot, fileName);

        File.WriteAllText(path, BuildReport(exception), Encoding.UTF8);
        return path;
    }

    private static string BuildReport(Exception exception)
    {
        var sb = new StringBuilder();
        sb.AppendLine("LandslideDesk.Win Crash Report");
        sb.AppendLine($"Time: {DateTime.Now:O}");
        sb.AppendLine($"Version: {typeof(CrashReporter).Assembly.GetName().Version}");
        sb.AppendLine($"OS: {Environment.OSVersion}");
        sb.AppendLine();
        sb.AppendLine(exception.ToString());
        sb.AppendLine();
        return sb.ToString();
    }
}

