using System;
using System.IO;
using WixToolset.BootstrapperApplicationApi;

namespace LandslideDesk.CustomBA;

internal static class Program
{
    private static int Main(string[] args)
    {
        var logFile = Path.Combine(Path.GetTempPath(), "LandslideDesk.CustomBA.main.log");
        try
        {
            File.AppendAllText(logFile, DateTime.UtcNow.ToString("O") + " Main start" + Environment.NewLine);
            ManagedBootstrapperApplication.Run(new CustomBootstrapperApplication());
            File.AppendAllText(logFile, DateTime.UtcNow.ToString("O") + " Main exit 0" + Environment.NewLine);
            return 0;
        }
        catch (Exception ex)
        {
            File.AppendAllText(logFile, DateTime.UtcNow.ToString("O") + " Main exception" + Environment.NewLine + ex + Environment.NewLine);
            throw;
        }
    }
}
