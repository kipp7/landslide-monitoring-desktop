using System;
using Microsoft.Win32;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Interop;
using System.Windows.Input;
using System.Windows.Media;
using WixToolset.BootstrapperApplicationApi;

namespace LandslideDesk.CustomBA;

public partial class CustomInstallerWindow : Window
{
    private bool closingFromEngine;
    private bool isBusy;

    public event EventHandler<LaunchAction>? PlanRequested;
    public event EventHandler? CloseRequested;

    public CustomInstallerWindow()
    {
        InitializeComponent();
    }

    public string GetInstallFolder()
    {
        return this.InstallFolderTextBox.Text.Trim();
    }

    public void SetInstallFolder(string path)
    {
        this.InstallFolderTextBox.Text = NormalizeInstallFolder(path);
    }

    public void SetStatus(string text)
    {
        this.StatusText.Text = text;
    }

    public void SetProgress(int value)
    {
        this.OverallProgressBar.Value = value;
    }

    public void SetDetectedAction(LaunchAction action)
    {
        this.InstallButton.IsEnabled = action != LaunchAction.Uninstall;
        this.UninstallButton.IsEnabled = true;
    }

    public void SetBusy(bool value)
    {
        this.isBusy = value;
        this.InstallButton.IsEnabled = !value;
        this.UninstallButton.IsEnabled = !value;
        this.BrowseButton.IsEnabled = !value;
    }

    public void SetCompletedState(LaunchAction action, bool success)
    {
        this.isBusy = false;
        this.BrowseButton.IsEnabled = false;
        this.FinishButton.IsEnabled = true;

        if (!success)
        {
            this.InstallButton.IsEnabled = true;
            this.UninstallButton.IsEnabled = true;
            return;
        }

        this.InstallButton.IsEnabled = false;
        this.UninstallButton.IsEnabled = false;
        this.FinishButton.Content = "完成";
    }

    public void CloseFromEngine()
    {
        this.closingFromEngine = true;
        this.Close();
    }

    protected override void OnClosed(EventArgs e)
    {
        base.OnClosed(e);
        if (!this.closingFromEngine)
        {
            this.CloseRequested?.Invoke(this, EventArgs.Empty);
        }
    }

    private void InstallButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (this.isBusy)
        {
            return;
        }

        this.SetBusy(true);
        this.PlanRequested?.Invoke(this, LaunchAction.Install);
    }

    private void UninstallButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (this.isBusy)
        {
            return;
        }

        this.SetBusy(true);
        this.PlanRequested?.Invoke(this, LaunchAction.Uninstall);
    }

    private void CloseButton_OnClick(object sender, RoutedEventArgs e)
    {
        this.Close();
    }

    private void TitleBar_OnMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        this.TryBeginWindowDrag(e.OriginalSource as DependencyObject, e);
    }

    private void RootSurface_OnMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        this.TryBeginWindowDrag(e.OriginalSource as DependencyObject, e);
    }

    private void BrowseButton_OnClick(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog
        {
            Title = "选择山体滑坡监测桌面端的安装目录"
        };

        if (!string.IsNullOrWhiteSpace(this.InstallFolderTextBox.Text))
        {
            dialog.InitialDirectory = NormalizeInstallFolder(this.InstallFolderTextBox.Text);
        }

        var result = dialog.ShowDialog(this);
        if (result == true && !string.IsNullOrWhiteSpace(dialog.FolderName))
        {
            this.InstallFolderTextBox.Text = NormalizeInstallFolder(dialog.FolderName);
        }
    }

    private static string NormalizeInstallFolder(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return string.Empty;
        }

        try
        {
            return System.IO.Path.GetFullPath(path.Trim().Trim('"'))
                .TrimEnd(System.IO.Path.DirectorySeparatorChar, System.IO.Path.AltDirectorySeparatorChar);
        }
        catch
        {
            return path.Trim().Trim('"');
        }
    }

    private void TryBeginWindowDrag(DependencyObject? source, MouseButtonEventArgs e)
    {
        if (e.ButtonState != MouseButtonState.Pressed || !CanDragFrom(source))
        {
            return;
        }

        this.DragMove();
        e.Handled = true;
    }

    private static bool CanDragFrom(DependencyObject? source)
    {
        for (var current = source; current is not null; current = VisualTreeHelper.GetParent(current))
        {
            if (current is System.Windows.Controls.Primitives.ButtonBase ||
                current is System.Windows.Controls.Primitives.TextBoxBase ||
                current is PasswordBox ||
                current is Selector ||
                current is System.Windows.Controls.Primitives.ScrollBar ||
                current is Slider ||
                current is System.Windows.Controls.ProgressBar)
            {
                return false;
            }
        }

        return true;
    }
}
