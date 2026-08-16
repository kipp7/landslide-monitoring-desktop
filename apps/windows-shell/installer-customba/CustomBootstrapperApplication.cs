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
    private const string AppInstallFolderName = "LandslideDesk";
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
    private System.Windows.Application? windowApplication;
    private Dispatcher? windowDispatcher;
    private Thread? windowThread;
    private int exitRequested;

    protected override void Run()
    {
        this.traceFile = Path.Combine(Path.GetTempPath(), "LandslideDesk.CustomBA.trace." + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fff") + ".log");
        this.dispatcher = Dispatcher.CurrentDispatcher;
        this.hiddenReady = new ManualResetEventSlim(false);
        this.StartHiddenWindowThread();
        this.Trace("Run entered action=" + this.plannedAction + " thread=" + Environment.CurrentManagedThreadId);
        try
        {
            Dispatcher.Run();
        }
        finally
        {
            this.Trace("Primary dispatcher loop exited");
            this.ShutdownAuxiliaryLoops();
            this.JoinThread(this.windowThread, "visible window");
            this.JoinThread(this.hiddenThread, "hidden window");
            this.hiddenReady?.Dispose();
            this.hiddenReady = null;
            this.Trace("Run cleanup completed");
        }
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
            var actionCode = this.engine.GetVariableNumeric("WixBundleCommandLineAction");
            this.plannedAction = actionCode == 4 ? LaunchAction.Uninstall : LaunchAction.Install;
            this.autoFlowMode = actionCode == 4 ||
                                this.commandDisplay == Display.None ||
                                this.commandDisplay == Display.Passive ||
                                this.commandRelation != RelationType.None;
            this.Trace("OnStartup hresult=" + args.HResult + " thread=" + Environment.CurrentManagedThreadId);
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
            this.RequestExit(args.Status, "detect failed");
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
            this.RequestExit(args.Status, "plan failed");
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
        this.ShutdownAuxiliaryLoops();
        this.dispatcher?.BeginInvokeShutdown(DispatcherPriority.Send);
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
            try
            {
                Dispatcher.Run();
            }
            finally
            {
                this.hiddenSource?.Dispose();
                this.hiddenSource = null;
                this.Trace("Hidden window loop exited");
            }
        });
        this.hiddenThread.IsBackground = true;
        this.hiddenThread.SetApartmentState(ApartmentState.STA);
        this.hiddenThread.Start();
    }

    private void StartVisibleWindowThread()
    {
        this.windowThread = new Thread(() =>
        {
            try
            {
                this.Trace("Visible window thread entered");
                this.windowDispatcher = Dispatcher.CurrentDispatcher;
                var app = new System.Windows.Application
                {
                    ShutdownMode = System.Windows.ShutdownMode.OnExplicitShutdown
                };
                this.windowApplication = app;
                this.window = new CustomInstallerWindow();
                this.Trace("Visible window constructed");
                this.window.SetBusy(true);
                this.window.SetInstallFolder(this.GetCurrentInstallFolder());
                this.window.SetStatus("正在初始化安装器...");
                // Detect commonly completes before the WPF thread is ready. Apply the current state here as well.
                if (this.commandDisplay == Display.Full && this.commandRelation == RelationType.None)
                {
                    this.window.SetDetectedAction(this.plannedAction);
                    this.window.SetInstallFolder(this.GetCurrentInstallFolder());
                    this.window.SetStatus(this.GetDetectedStatus());
                    this.window.SetBusy(false);
                    this.Trace("Visible window synchronized after detect");
                }
            this.window.PlanRequested += (_, action) =>
            {
                if (action == LaunchAction.Uninstall && this.TryGetCoreUninstallCommand(out var coreUninstallCommand))
                {
                    this.DispatchToWindow(() =>
                    {
                        this.window?.SetBusy(true);
                        this.window?.SetStatus("正在卸载旧版桌面端，请等待卸载程序完成...");
                        this.window?.SetProgress(20);
                    });
                    _ = this.RunRegisteredBundleUninstallAsync(coreUninstallCommand);
                    this.Trace("Manual uninstall delegated to core installer");
                    return;
                }

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
                this.window.CloseRequested += (_, _) => this.RequestExit(0, "window closed by user");
                this.window.LaunchRequested += (_, _) => this.LaunchInstalledApplication();
                this.window.Loaded += (_, _) => this.Trace("Visible window loaded");
                app.Run(this.window);
                this.Trace("Visible window loop exited");
            }
            catch (Exception ex)
            {
                this.Trace("Visible window thread exception=" + ex);
                this.RequestExit(unchecked((int)0x80004005), "visible window failure");
            }
            finally
            {
                this.window = null;
                this.windowApplication = null;
            }
        });
        this.windowThread.IsBackground = true;
        this.windowThread.SetApartmentState(System.Threading.ApartmentState.STA);
        this.windowThread.Start();
    }

    private void DispatchToWindow(Action action)
    {
        var target = this.windowDispatcher;
        if (target is null || target.HasShutdownStarted || target.HasShutdownFinished)
        {
            return;
        }

        target.BeginInvoke(action);
    }

    private void RequestExit(int exitCode, string reason)
    {
        if (Interlocked.Exchange(ref this.exitRequested, 1) != 0)
        {
            this.Trace("Exit already requested; ignored reason=" + reason);
            return;
        }

        this.Trace("Exit requested code=" + exitCode + " reason=" + reason);
        try
        {
            this.engine.Quit(exitCode);
        }
        catch (Exception ex)
        {
            this.Trace("Engine quit exception=" + ex);
            this.ShutdownAuxiliaryLoops();
            this.dispatcher?.BeginInvokeShutdown(DispatcherPriority.Send);
        }
    }

    private void ShutdownAuxiliaryLoops()
    {
        var visible = this.windowDispatcher;
        if (visible is not null && !visible.HasShutdownStarted && !visible.HasShutdownFinished)
        {
            try
            {
                visible.BeginInvoke(DispatcherPriority.Send, new Action(() =>
                {
                    this.Trace("Stopping visible window loop");
                    this.window?.CloseFromEngine();
                    this.windowApplication?.Shutdown();
                    Dispatcher.CurrentDispatcher.BeginInvokeShutdown(DispatcherPriority.Send);
                }));
            }
            catch (Exception ex)
            {
                this.Trace("Visible window shutdown exception=" + ex);
            }
        }

        var hidden = this.hiddenDispatcher;
        if (hidden is not null && !hidden.HasShutdownStarted && !hidden.HasShutdownFinished)
        {
            try
            {
                hidden.BeginInvoke(DispatcherPriority.Send, new Action(() =>
                {
                    this.Trace("Stopping hidden window loop");
                    this.hiddenSource?.Dispose();
                    this.hiddenSource = null;
                    Dispatcher.CurrentDispatcher.BeginInvokeShutdown(DispatcherPriority.Send);
                }));
            }
            catch (Exception ex)
            {
                this.Trace("Hidden window shutdown exception=" + ex);
            }
        }
    }

    private void JoinThread(Thread? thread, string name)
    {
        if (thread is null || thread == Thread.CurrentThread || !thread.IsAlive)
        {
            return;
        }

        if (thread.Join(TimeSpan.FromSeconds(5)))
        {
            this.Trace(name + " thread joined");
            return;
        }

        this.Trace(name + " thread did not stop within 5 seconds");
    }

    private void LaunchInstalledApplication()
    {
        try
        {
            var executablePath = Path.Combine(this.GetCurrentInstallFolder(), "LandslideDesk.Win.exe");
            if (!File.Exists(executablePath))
            {
                this.Trace("Launch skipped because executable was not found: " + executablePath);
                return;
            }

            Process.Start(new ProcessStartInfo
            {
                FileName = executablePath,
                WorkingDirectory = Path.GetDirectoryName(executablePath) ?? string.Empty,
                UseShellExecute = true
            });
            this.Trace("Installed application launched: " + executablePath);
        }
        catch (Exception ex)
        {
            this.Trace("LaunchInstalledApplication exception=" + ex);
        }
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

    private bool TryGetCoreUninstallCommand(out string commandLine)
    {
        commandLine = string.Empty;
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
            @"Software\Microsoft\Windows\CurrentVersion\Uninstall\{6F223F64-1B4C-4381-BE67-AC3AC8A7A78D}_is1");
        if (key is null)
        {
            return false;
        }

        commandLine = (key.GetValue("QuietUninstallString") as string)
            ?? (key.GetValue("UninstallString") as string)
            ?? string.Empty;
        return !string.IsNullOrWhiteSpace(commandLine);
    }

    private static string GetDefaultInstallFolder()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs",
            AppInstallFolderName);
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

            var coreUninstallStillRegistered = this.TryGetCoreUninstallCommand(out _);
            if (exitCode == 0 && coreUninstallStillRegistered)
            {
                exitCode = unchecked((int)0x80004005);
                this.Trace("Uninstall reported success but core ARP entry remains");
            }

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
        var current = NormalizeInstallFolder(this.engine.GetVariableString(InstallFolderVariable));
        if (this.plannedAction == LaunchAction.Install)
        {
            return !string.IsNullOrWhiteSpace(current) ? current : GetDefaultInstallFolder();
        }

        if (this.TryGetInstallerState(out var state))
        {
            return state.InstallLocation;
        }

        if (this.TryGetCoreInstallLocation(out var installLocation))
        {
            return installLocation;
        }

        return !string.IsNullOrWhiteSpace(current) ? current : GetDefaultInstallFolder();
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
            this.RequestExit(args.Status, "automatic apply completed");
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
