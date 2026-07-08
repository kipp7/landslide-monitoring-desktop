using System;
using System.Windows;
using System.Windows.Input;

namespace LandslideDesk.Win;

public partial class TrayFlyoutWindow : Window
{
    public event Action? OpenMainRequested;
    public event Action<string>? NavigateRequested;
    public event Action? OpenLogsRequested;
    public event Action? ToggleFullscreenRequested;
    public event Action? ReloadRequested;
    public event Action? ExitRequested;

    public TrayFlyoutWindow()
    {
        InitializeComponent();
        HeaderMeta.Text = string.Empty;
    }

    public void UpdateHeader(string version, string status)
    {
        HeaderMeta.Text = $"版本 {version} · {status}";
    }

    private void OnDeactivated(object sender, EventArgs e)
    {
        Hide();
    }

    private void OnKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            Hide();
            e.Handled = true;
        }
    }

    private void OnOpenMainClick(object sender, RoutedEventArgs e)
    {
        Hide();
        OpenMainRequested?.Invoke();
    }

    private void OnOpenSettingsClick(object sender, RoutedEventArgs e)
    {
        Hide();
        NavigateRequested?.Invoke("/app/settings");
    }

    private void OnOpenLogsClick(object sender, RoutedEventArgs e)
    {
        Hide();
        OpenLogsRequested?.Invoke();
    }

    private void OnReloadClick(object sender, RoutedEventArgs e)
    {
        Hide();
        ReloadRequested?.Invoke();
    }

    private void OnToggleFullscreenClick(object sender, RoutedEventArgs e)
    {
        Hide();
        ToggleFullscreenRequested?.Invoke();
    }

    private void OnExitClick(object sender, RoutedEventArgs e)
    {
        Hide();
        ExitRequested?.Invoke();
    }
}
