using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;

namespace LandslideDesk.Win;

public partial class App : System.Windows.Application
{
    private Mutex? _singleInstanceMutex;
    private bool _isShuttingDown;

    internal bool IsShuttingDown => _isShuttingDown;

    internal static void RequestAppShutdown(int exitCode = 0)
    {
        if (Current is App app)
        {
            app._isShuttingDown = true;
            app.Shutdown(exitCode);
            return;
        }

        Current?.Shutdown(exitCode);
    }

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        ShutdownMode = ShutdownMode.OnMainWindowClose;

        _singleInstanceMutex = new Mutex(true, "LandslideDesk.Win.SingleInstance", out var createdNew);
        if (!createdNew)
        {
            TryActivateExistingInstance();
            RequestAppShutdown();
            return;
        }

        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
        TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;

        if (!StartupPreflight.TryRun(out var preflightMessage))
        {
            System.Windows.MessageBox.Show(
                preflightMessage,
                "启动前置检查失败",
                MessageBoxButton.OK,
                MessageBoxImage.Error
            );
            RequestAppShutdown(-1);
            return;
        }

        try
        {
            var mainWindow = new MainWindow();
            MainWindow = mainWindow;
            mainWindow.Show();
        }
        catch (Exception ex)
        {
            var path = SafeWriteCrash(ex);
            var detail = string.IsNullOrWhiteSpace(path) ? string.Empty : $"\n\n崩溃日志：{path}";
            System.Windows.MessageBox.Show(
                "桌面端在创建主窗口时发生异常。可先检查 WebView2 Runtime、前端资源以及 startup-diagnostic-latest.txt。" + detail,
                "启动失败",
                MessageBoxButton.OK,
                MessageBoxImage.Error
            );
            RequestAppShutdown(-1);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        DispatcherUnhandledException -= OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException -= OnUnhandledException;
        TaskScheduler.UnobservedTaskException -= OnUnobservedTaskException;

        if (_singleInstanceMutex is not null)
        {
            try
            {
                _singleInstanceMutex.ReleaseMutex();
            }
            catch
            {
            }

            _singleInstanceMutex.Dispose();
            _singleInstanceMutex = null;
        }

        base.OnExit(e);
    }

    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        e.Handled = true;
        _isShuttingDown = true;

        var path = SafeWriteCrash(e.Exception);
        if (!string.IsNullOrWhiteSpace(path))
        {
            System.Windows.MessageBox.Show(
                $"程序发生未处理异常，已写入崩溃日志：\n{path}\n\n即将退出。",
                "程序异常",
                MessageBoxButton.OK,
                MessageBoxImage.Error
            );
        }
        else
        {
            System.Windows.MessageBox.Show(
                "程序发生未处理异常，即将退出。",
                "程序异常",
                MessageBoxButton.OK,
                MessageBoxImage.Error
            );
        }

        RequestAppShutdown(-1);
    }

    private void OnUnhandledException(object? sender, UnhandledExceptionEventArgs e)
    {
        if (e.ExceptionObject is Exception ex)
        {
            SafeWriteCrash(ex);
        }
        else
        {
            SafeWriteCrash(new Exception($"UnhandledException: {e.ExceptionObject}"));
        }
    }

    private void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
    {
        SafeWriteCrash(e.Exception);
        e.SetObserved();
    }

    private static string? SafeWriteCrash(Exception exception)
    {
        try
        {
            return CrashReporter.Write(exception);
        }
        catch
        {
            return null;
        }
    }

    private static void TryActivateExistingInstance()
    {
        try
        {
            var current = Process.GetCurrentProcess();
            foreach (var process in Process.GetProcessesByName(current.ProcessName))
            {
                if (process.Id == current.Id)
                {
                    continue;
                }

                var hwnd = process.MainWindowHandle;
                if (hwnd == IntPtr.Zero)
                {
                    continue;
                }

                ShowWindow(hwnd, SwRestore);
                SetForegroundWindow(hwnd);
                break;
            }
        }
        catch
        {
        }
    }

    private const int SwRestore = 9;

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(nint hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(nint hWnd);
}
