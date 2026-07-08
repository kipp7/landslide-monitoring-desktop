using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Interop;
using System.Windows.Threading;
using WixToolset.BootstrapperApplicationApi;

namespace LandslideDesk.CustomBA;

internal sealed class CustomBootstrapperApplication : BootstrapperApplication
{
    private const string AppDisplayName = "山体滑坡监测桌面端";
    private const string InstallFolderVariable = "InstallFolder";
    private const string BundleUpgradeCode = "{{F3F4BEB7-6F61-4B44-B86D-2B79F7B4AFD2}}";
    private const string CoreUninstallRegistry = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\{6F223F64-1B4C-4381-BE67-AC3AC8A7A78D}_is1";
    private const string InstallerStateRegistry = @"Software\LandslideDesk\InstallerState";

    private string? traceFile;
    private Dispatcher? dispatcher;
    private LaunchAction plannedAction = LaunchAction.Install;
    private bool autoFlowMode = true;
    private Display commandDisplay = Display.Unknown;
    private RelationType commandRelation = RelationType.None;
    private HwndSource? hiddenSource;
    private Dispatcher? hiddenDispatcher;
    private Thread? hiddenThread;
    private ManualResetEventSlim? hiddenReady;
    private CustomInstallerWindow? window;
    private Dispatcher? windowDispatcher;
    private Thread? windowThread;

    protected override void Run()
    {
        this.traceFile = Path.Combine(Path.GetTempPath(), "LandslideDesk.CustomBA.trace." + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fff") + ".log");
        this.hiddenReady = new ManualResetEventSlim(false);
        this.StartHiddenWindowThread();
        this.Trace("Run entered action=" + this.plannedAction);
        Dispatcher.Run();
    }

    protected override void OnCreate(CreateEventArgs args)
    {
        base.OnCreate(args);
        this.commandDisplay = args.Command.Display;
        this.commandRelation = args.Command.Relation;
        this.Trace("OnCreate display=" + this.commandDisplay + " relation=" + this.commandRelation + " action=" + args.Command.Action);
    }

    protected override void OnStartup(StartupEventArgs args)
    {
        base.OnStartup(args);
        try
        {
            this.dispatcher = Dispatcher.CurrentDispatcher;
            var actionCode = this.engine.GetVariableNumeric("WixBundleCommandLineAction");
            this.plannedAction = actionCode == 4 ? LaunchAction.Uninstall : LaunchAction.Install;
            this.autoFlowMode = actionCode == 4 ||
                                this.commandDisplay == Display.None ||
                                this.commandDisplay == Display.Passive ||
                                this.commandRelation != RelationType.None;
            this.Trace("OnStartup hresult=" + args.HResult);
            this.Trace("PlannedAction=" + this.plannedAction + " rawAction=" + actionCode + " display=" + this.commandDisplay + " relation=" + this.commandRelation + " autoFlow=" + this.autoFlowMode + " commandLine=" + Environment.CommandLine);

            if (!this.autoFlowMode)
            {
                this.StartVisibleWindowThread();
            }

            this.engine.Detect();
            this.Trace("Detect requested");
        }
        catch (Exception ex)
        {
            this.Trace("OnStartup exception=" + ex);
            throw;
        }
    }

    protected override void OnDetectComplete(DetectCompleteEventArgs args)
    {
        base.OnDetectComplete(args);
        this.Trace("OnDetectComplete status=" + args.Status);

        if (args.Status != 0)
        {
            this.engine.Quit(args.Status);
            return;
        }

        if (!this.autoFlowMode)
        {
            this.DispatchToWindow(() =>
            {
                this.window?.SetDetectedAction(this.plannedAction);
                this.window?.SetInstallFolder(this.GetCurrentInstallFolder());
                this.window?.SetStatus(this.GetDetectedStatus());
                this.window?.SetBusy(false);
            });
            return;
        }

        this.engine.Plan(this.plannedAction);
        this.Trace("Plan requested action=" + this.plannedAction);
    }

    protected override void OnPlanComplete(PlanCompleteEventArgs args)
    {
        base.OnPlanComplete(args);
        this.Trace("OnPlanComplete status=" + args.Status);

        if (args.Status != 0)
        {
            this.DispatchToWindow(() => this.window?.SetStatus("计划失败: " + args.Status));
            this.engine.Quit(args.Status);
            return;
        }

        this.hiddenReady?.Wait(5000);
        var hwndParent = this.hiddenSource is null ? IntPtr.Zero : this.hiddenSource.Handle;
        this.Trace("Apply requested hwnd=" + hwndParent);
        this.engine.Apply(hwndParent);
        this.Trace("Apply requested");
    }

    protected override void OnExecuteProgress(ExecuteProgressEventArgs args)
    {
        base.OnExecuteProgress(args);
        this.Trace("OnExecuteProgress overall=" + args.OverallPercentage + " package=" + args.PackageId);
        this.DispatchToWindow(() =>
        {
            this.window?.SetProgress(args.OverallPercentage);
            this.window?.SetBusy(true);
            this.window?.SetStatus(this.GetProgressStatus(args.PackageId, args.OverallPercentage));
        });
    }

    protected override void OnError(WixToolset.BootstrapperApplicationApi.ErrorEventArgs args)
    {
        base.OnError(args);
        this.Trace("OnError code=" + args.ErrorCode + " message=" + args.ErrorMessage);
        this.DispatchToWindow(() =>
        {
            this.window?.SetStatus("错误: " + args.ErrorMessage);
            this.window?.SetBusy(false);
        });
    }

    protected override void OnShutdown(ShutdownEventArgs args)
    {
        base.OnShutdown(args);
        this.Trace("OnShutdown action=" + args.Action + " hresult=" + args.HResult);

        if (this.hiddenDispatcher is not null)
        {
            this.hiddenDispatcher.BeginInvoke(new Action(() =>
            {
                this.hiddenSource?.Dispose();
                Dispatcher.CurrentDispatcher.BeginInvokeShutdown(DispatcherPriority.Normal);
            }));
        }

        this.DispatchToWindow(() =>
        {
            this.window?.CloseFromEngine();
            System.Windows.Application.Current?.Shutdown();
        });

        this.dispatcher?.BeginInvokeShutdown(DispatcherPriority.Normal);
    }

    private void StartHiddenWindowThread()
    {
        this.hiddenThread = new Thread(() =>
        {
            this.hiddenDispatcher = Dispatcher.CurrentDispatcher;
            var sourceParameters = new HwndSourceParameters("LandslideDesk.CustomBA.Hidden")
            {
                Width = 1,
                Height = 1,
                WindowStyle = unchecked((int)0x80000000)
            };
            this.hiddenSource = new HwndSource(sourceParameters);
            this.hiddenReady?.Set();
            Dispatcher.Run();
        });
        this.hiddenThread.IsBackground = true;
        this.hiddenThread.SetApartmentState(ApartmentState.STA);
        this.hiddenThread.Start();
    }

    private void StartVisibleWindowThread()
    {
        this.windowThread = new Thread(() =>
        {
            this.windowDispatcher = Dispatcher.CurrentDispatcher;
            var app = new System.Windows.Application
            {
                ShutdownMode = System.Windows.ShutdownMode.OnExplicitShutdown
            };
            this.window = new CustomInstallerWindow();
            this.window.SetBusy(true);
            this.window.SetInstallFolder(this.GetCurrentInstallFolder());
            this.window.SetStatus("正在初始化安装器...");
            this.window.PlanRequested += (_, action) =>
            {
                if (action == LaunchAction.Uninstall && this.TryGetRegisteredBundleUninstallCommand(out var uninstallCommand))
                {
                    this.DispatchToWindow(() =>
                    {
                        this.window?.SetBusy(true);
                        this.window?.SetStatus("正在卸载已安装版本，请等待...");
                        this.window?.SetProgress(20);
                    });
                    _ = this.RunRegisteredBundleUninstallAsync(uninstallCommand);
                    this.Trace("Manual uninstall delegated to registered bundle");
                    return;
                }

                if (action == LaunchAction.Install && this.HasExistingInstallation())
                {
                    var result = System.Windows.MessageBox.Show(
                        this.window,
                        "检测到电脑中已经存在一个版本。\n\n建议先卸载旧版本，再继续安装新版本。\n\n是否现在先执行卸载？",
                        "已存在版本",
                        System.Windows.MessageBoxButton.YesNo,
                        System.Windows.MessageBoxImage.Warning);

                    if (result == System.Windows.MessageBoxResult.Yes)
                    {
                        action = LaunchAction.Uninstall;
                    }
                    else
                    {
                        this.DispatchToWindow(() =>
                        {
                            this.window?.SetBusy(false);
                            this.window?.SetStatus("已取消安装。请先卸载旧版本，再继续安装。");
                        });
                        return;
                    }
                }

                this.plannedAction = action;
                this.DispatchToWindow(() =>
                {
                    this.window?.SetBusy(true);
                    this.window?.SetStatus(action == LaunchAction.Uninstall ? "准备卸载..." : "准备安装...");
                });
                var folder = this.window.GetInstallFolder();
                if (!string.IsNullOrWhiteSpace(folder))
                {
                    this.engine.SetVariableString(InstallFolderVariable, folder, true);
                }
                this.engine.Plan(action);
                this.Trace("Manual plan requested action=" + action);
            };
            this.window.CloseRequested += (_, _) => this.engine.Quit(0);
            app.Run(this.window);
        });
        this.windowThread.IsBackground = true;
        this.windowThread.SetApartmentState(System.Threading.ApartmentState.STA);
        this.windowThread.Start();
    }

    private void DispatchToWindow(Action action)
    {
        this.windowDispatcher?.BeginInvoke(action);
    }

    private bool HasExistingInstallation()
    {
        return this.TryGetInstallerState(out _) || this.TryGetCoreInstallLocation(out _);
    }

    private bool TryGetRegisteredBundleUninstallCommand(out string commandLine)
    {
        commandLine = string.Empty;
        if (this.TryGetInstallerState(out var installerState) && !string.IsNullOrWhiteSpace(installerState.QuietUninstallString))
        {
            commandLine = installerState.QuietUninstallString;
            return true;
        }

        using var uninstallRoot = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall");
        if (uninstallRoot is null)
        {
            return false;
        }

        foreach (var subKeyName in uninstallRoot.GetSubKeyNames())
        {
            using var subKey = uninstallRoot.OpenSubKey(subKeyName);
            if (subKey is null)
            {
                continue;
            }

            var upgradeCode = subKey.GetValue("BundleUpgradeCode") as string;
            if (!string.Equals(upgradeCode, BundleUpgradeCode, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            commandLine = (subKey.GetValue("QuietUninstallString") as string) ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(commandLine))
            {
                return true;
            }

            var bundleCachePath = subKey.GetValue("BundleCachePath") as string;
            if (!string.IsNullOrWhiteSpace(bundleCachePath))
            {
                commandLine = "\"" + bundleCachePath + "\" /uninstall /quiet /norestart";
                return true;
            }
        }

        return false;
    }

    private static string GetDefaultInstallFolder()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs",
            AppDisplayName);
    }

    private static string NormalizeInstallFolder(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return string.Empty;
        }

        var normalized = path.Trim().Trim('"');
        normalized = normalized.Replace(
            "[LocalAppDataFolder]",
            EnsureTrailingSeparator(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)),
            StringComparison.OrdinalIgnoreCase);
        normalized = Environment.ExpandEnvironmentVariables(normalized);

        try
        {
            normalized = Path.GetFullPath(normalized);
        }
        catch
        {
            return normalized;
        }

        return normalized.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private static string EnsureTrailingSeparator(string path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return Path.DirectorySeparatorChar.ToString();
        }

        return path.EndsWith(Path.DirectorySeparatorChar) || path.EndsWith(Path.AltDirectorySeparatorChar)
            ? path
            : path + Path.DirectorySeparatorChar;
    }

    private void Trace(string message)
    {
        var path = this.traceFile;
        if (string.IsNullOrWhiteSpace(path))
        {
            path = Path.Combine(Path.GetTempPath(), "LandslideDesk.CustomBA.trace.fallback.log");
        }

        File.AppendAllText(path, DateTime.UtcNow.ToString("O") + " " + message + Environment.NewLine);
    }

    private string GetProgressStatus(string packageId, int overallPercentage)
    {
        if (string.Equals(packageId, "DeskInnoInstaller", StringComparison.OrdinalIgnoreCase))
        {
            if (overallPercentage <= 20)
            {
                return "正在启动核心安装器并写入桌面端文件，请等待，不要重复点击安装。";
            }

            return "核心安装器正在处理桌面端文件 · " + overallPercentage + "%";
        }

        return "正在处理 " + packageId + " · " + overallPercentage + "%";
    }

    private string GetApplyCompleteStatus(int status)
    {
        if (status != 0)
        {
            return "安装结束，状态码: " + status;
        }

        return this.plannedAction == LaunchAction.Uninstall
            ? "卸载完成，可点击完成关闭安装程序。"
            : "安装完成，可点击完成关闭安装程序。";
    }

    private string GetDetectedStatus()
    {
        if (this.plannedAction == LaunchAction.Install && this.HasExistingInstallation())
        {
            if (this.TryGetInstallerState(out var state))
            {
                return "检测到已安装版本：" + state.InstallLocation + "\n建议先卸载旧版本，再继续安装。";
            }

            if (this.TryGetCoreInstallLocation(out var installLocation))
            {
                return "检测到已安装版本：" + installLocation + "\n建议先卸载旧版本，再继续安装。";
            }

            return "检测到已安装版本。建议先卸载旧版本，再继续安装。";
        }

        return "检测完成，等待执行";
    }

    private async Task RunRegisteredBundleUninstallAsync(string commandLine)
    {
        try
        {
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c " + commandLine,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };

            process.Start();
            await process.WaitForExitAsync();
            var exitCode = process.ExitCode;
            this.Trace("Registered bundle uninstall exit=" + exitCode);

            this.DispatchToWindow(() =>
            {
                this.window?.SetProgress(exitCode == 0 ? 100 : 0);
                this.window?.SetStatus(exitCode == 0
                    ? "卸载完成，可点击完成关闭安装程序。"
                    : "卸载失败，退出码: " + exitCode);
                this.window?.SetCompletedState(LaunchAction.Uninstall, exitCode == 0);
            });

            if (exitCode == 0)
            {
                ClearInstallerState();
            }
        }
        catch (Exception ex)
        {
            this.Trace("Registered bundle uninstall exception=" + ex);
            this.DispatchToWindow(() =>
            {
                this.window?.SetProgress(0);
                this.window?.SetStatus("卸载失败：" + ex.Message);
                this.window?.SetCompletedState(LaunchAction.Uninstall, false);
            });
        }
    }

    private string GetCurrentInstallFolder()
    {
        if (this.TryGetInstallerState(out var state))
        {
            return state.InstallLocation;
        }

        var current = NormalizeInstallFolder(this.engine.GetVariableString(InstallFolderVariable));
        if (!string.IsNullOrWhiteSpace(current))
        {
            return current;
        }

        if (this.TryGetCoreInstallLocation(out var installLocation))
        {
            return installLocation;
        }

        return GetDefaultInstallFolder();
    }

    private bool TryGetCoreInstallLocation(out string installLocation)
    {
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(CoreUninstallRegistry);
        installLocation = NormalizeInstallFolder(key?.GetValue("InstallLocation") as string);
        return !string.IsNullOrWhiteSpace(installLocation);
    }

    private bool TryGetInstallerState(out InstallerState state)
    {
        state = default;
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(InstallerStateRegistry);
        if (key is null)
        {
            return false;
        }

        var installLocation = NormalizeInstallFolder(key.GetValue("InstallLocation") as string);
        if (string.IsNullOrWhiteSpace(installLocation))
        {
            return false;
        }

        state = new InstallerState
        {
            InstallLocation = installLocation,
            BundleCachePath = key.GetValue("BundleCachePath") as string,
            QuietUninstallString = key.GetValue("QuietUninstallString") as string,
            DisplayName = key.GetValue("DisplayName") as string
        };
        return true;
    }

    private void PersistInstallerState()
    {
        try
        {
            var installLocation = this.GetCurrentInstallFolder();
            if (string.IsNullOrWhiteSpace(installLocation))
            {
                return;
            }

            using var uninstallRoot = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall");
            string? quietUninstallString = null;
            string? bundleCachePath = null;
            string? displayName = null;

            if (uninstallRoot is not null)
            {
                foreach (var subKeyName in uninstallRoot.GetSubKeyNames())
                {
                    using var subKey = uninstallRoot.OpenSubKey(subKeyName);
                    if (subKey is null)
                    {
                        continue;
                    }

                    var upgradeCode = subKey.GetValue("BundleUpgradeCode") as string;
                    if (!string.Equals(upgradeCode, BundleUpgradeCode, StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    quietUninstallString = subKey.GetValue("QuietUninstallString") as string;
                    bundleCachePath = subKey.GetValue("BundleCachePath") as string;
                    displayName = subKey.GetValue("DisplayName") as string;
                    break;
                }
            }

            using var stateKey = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(InstallerStateRegistry);
            stateKey?.SetValue("InstallLocation", installLocation);
            stateKey?.SetValue("BundleUpgradeCode", BundleUpgradeCode);
            stateKey?.SetValue("RecordedAtUtc", DateTime.UtcNow.ToString("O"));
            stateKey?.SetValue("DisplayName", displayName ?? AppDisplayName);
            if (!string.IsNullOrWhiteSpace(quietUninstallString))
            {
                stateKey?.SetValue("QuietUninstallString", quietUninstallString);
            }
            if (!string.IsNullOrWhiteSpace(bundleCachePath))
            {
                stateKey?.SetValue("BundleCachePath", bundleCachePath);
            }
        }
        catch (Exception ex)
        {
            this.Trace("PersistInstallerState exception=" + ex);
        }
    }

    private static void ClearInstallerState()
    {
        try
        {
            Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree(InstallerStateRegistry, throwOnMissingSubKey: false);
        }
        catch
        {
        }
    }

    protected override void OnApplyComplete(ApplyCompleteEventArgs args)
    {
        base.OnApplyComplete(args);
        this.Trace("OnApplyComplete status=" + args.Status);
        this.DispatchToWindow(() =>
        {
            this.window?.SetProgress(100);
            this.window?.SetStatus(this.GetApplyCompleteStatus(args.Status));
            this.window?.SetCompletedState(this.plannedAction, args.Status == 0);
        });

        if (args.Status == 0)
        {
            if (this.plannedAction == LaunchAction.Install)
            {
                this.PersistInstallerState();
            }
            else if (this.plannedAction == LaunchAction.Uninstall)
            {
                ClearInstallerState();
            }
        }

        if (this.autoFlowMode)
        {
            this.engine.Quit(args.Status);
        }
    }

    private readonly record struct InstallerState
    {
        public required string InstallLocation { get; init; }
        public string? BundleCachePath { get; init; }
        public string? QuietUninstallString { get; init; }
        public string? DisplayName { get; init; }
    }
}
