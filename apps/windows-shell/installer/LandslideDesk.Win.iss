#define MyAppId "LandslideDeskWin"
#define MyAppName "山体滑坡监测桌面端"
#define MyAppPublisher "山体滑坡监测平台"
#define MyAppExeName "LandslideDesk.Win.exe"

#ifndef MyAppVersion
  #define MyAppVersion "0.1.0"
#endif

#ifndef MyAppVerName
  #define MyAppVerName "山体滑坡监测桌面端 " + MyAppVersion
#endif

#ifndef SourceDir
  #error SourceDir define is required
#endif

#ifndef OutputDir
  #error OutputDir define is required
#endif

#ifndef OutputBaseFilename
  #define OutputBaseFilename "LandslideDesk-Setup"
#endif

#ifndef WebView2Bootstrapper
  #error WebView2Bootstrapper define is required
#endif

[Setup]
AppId={{6F223F64-1B4C-4381-BE67-AC3AC8A7A78D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppVerName}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=..\LandslideDesk.Win\Assets\LandslideDesk.ico
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
WizardImageFile=assets\WizardImage.bmp
WizardSmallImageFile=assets\WizardSmallImage.bmp
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
ChangesAssociations=no

[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#WebView2Bootstrapper}"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{tmp}\MicrosoftEdgeWebView2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "正在安装 WebView2 Runtime..."; Flags: waituntilterminated; Check: not IsWebView2Installed
Filename: "{app}\{#MyAppExeName}"; Description: "立即启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[Messages]
WelcomeLabel1=欢迎使用 {#MyAppName} 安装向导
WelcomeLabel2=本向导将帮助你将 {#MyAppName} 安装到当前电脑。%n%n安装完成后可直接从开始菜单或桌面快捷方式启动。
WizardReady=安装程序已经准备好开始安装 {#MyAppName}。
FinishedHeadingLabel=安装完成
FinishedLabel=点击“完成”退出安装向导。若已勾选“立即启动”，程序将在退出后自动打开。%n%n如需交接说明，请查看交付文档中的 production handoff。
SelectDirDesc=选择 {#MyAppName} 的安装目录。
PreparingDesc=安装程序正在准备安装 {#MyAppName}。
InstallingLabel=正在安装 {#MyAppName}，请稍候。
FinishedRestartLabel=安装已完成。

[Code]
function IsWebView2Installed: Boolean;
var
  Version: string;
begin
  Result :=
    RegQueryStringValue(HKLM64, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
end;
