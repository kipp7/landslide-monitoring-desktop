using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Microsoft.Win32;

namespace LandslideDesk.Win;

internal static class StartupPreflight
{
    private const string DevServerEnv = "DESK_DEV_SERVER_URL";

    private static readonly string AppDataRoot = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "LandslideDesk.Win"
    );

    private static readonly string DiagnosticFile = Path.Combine(AppDataRoot, "startup-diagnostic-latest.txt");
    private static readonly string RuntimeLogFile = Path.Combine(AppDataRoot, "runtime.log");

    internal static bool TryRun(out string message)
    {
        var issues = new List<string>();
        var devServerUrl = Environment.GetEnvironmentVariable(DevServerEnv)?.Trim();
        var localWebRoot = Path.Combine(AppContext.BaseDirectory, "web");
        var localIndexPath = Path.Combine(localWebRoot, "index.html");

        if (string.IsNullOrWhiteSpace(devServerUrl) && !File.Exists(localIndexPath))
        {
            issues.Add($"未找到前端资源：{localIndexPath}");
        }

        var webView2Version = GetWebView2Version();
        if (string.IsNullOrWhiteSpace(webView2Version))
        {
            issues.Add("未检测到 WebView2 Runtime");
        }

        if (issues.Count == 0)
        {
            message = string.Empty;
            WriteDiagnostic(issues, devServerUrl, localIndexPath, webView2Version);
            return true;
        }

        var sb = new StringBuilder();
        sb.AppendLine("桌面端启动前置检查未通过。");
        sb.AppendLine();
        foreach (var issue in issues)
        {
            sb.AppendLine("- " + issue);
        }
        sb.AppendLine();
        sb.AppendLine("可优先检查：");
        sb.AppendLine("- WebView2 Runtime 是否已安装");
        sb.AppendLine("- 发布包内是否存在 web/index.html");
        sb.AppendLine("- 是否误用了只带壳程序、未带前端资源的输出目录");
        sb.AppendLine();
        sb.AppendLine($"启动诊断：{DiagnosticFile}");
        sb.AppendLine($"运行日志：{RuntimeLogFile}");
        sb.AppendLine();
        sb.AppendLine("如果是在其他电脑首次运行，优先怀疑 WebView2 Runtime 或打包资源缺失。");

        message = sb.ToString();
        WriteDiagnostic(issues, devServerUrl, localIndexPath, webView2Version);
        return false;
    }

    private static string? GetWebView2Version()
    {
        var paths = new[]
        {
            @"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            @"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
        };

        foreach (var hive in new[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser })
        {
            foreach (var path in paths)
            {
                try
                {
                    using var baseKey = RegistryKey.OpenBaseKey(hive, RegistryView.Registry64);
                    using var key = baseKey.OpenSubKey(path);
                    var value = key?.GetValue("pv") as string;
                    if (!string.IsNullOrWhiteSpace(value))
                    {
                        return value.Trim();
                    }
                }
                catch
                {
                }
            }
        }

        return null;
    }

    private static void WriteDiagnostic(
        IReadOnlyCollection<string> issues,
        string? devServerUrl,
        string localIndexPath,
        string? webView2Version
    )
    {
        try
        {
            Directory.CreateDirectory(AppDataRoot);
            var sb = new StringBuilder();
            sb.AppendLine("LandslideDesk.Win Startup Diagnostic");
            sb.AppendLine("Time: " + DateTime.Now.ToString("O"));
            sb.AppendLine("Version: " + typeof(StartupPreflight).Assembly.GetName().Version);
            sb.AppendLine("BaseDirectory: " + AppContext.BaseDirectory);
            sb.AppendLine("DevServerUrl: " + (string.IsNullOrWhiteSpace(devServerUrl) ? "(none)" : devServerUrl));
            sb.AppendLine("LocalWebIndex: " + localIndexPath);
            sb.AppendLine("LocalWebIndexExists: " + File.Exists(localIndexPath));
            sb.AppendLine("WebView2Version: " + (string.IsNullOrWhiteSpace(webView2Version) ? "(missing)" : webView2Version));
            sb.AppendLine("Issues: " + (issues.Count == 0 ? "(none)" : string.Join(" | ", issues)));
            File.WriteAllText(DiagnosticFile, sb.ToString(), Encoding.UTF8);
        }
        catch
        {
        }
    }
}
