#!/usr/bin/env node

// Cross-platform notification — only sends when terminal is NOT focused
// Supports: macOS (osascript), Windows (PowerShell), Linux (notify-send)
// Trigger: Notification hook (permission_prompt, idle_prompt, elicitation_dialog)

const { execSync } = require("child_process");
const os = require("os");

const TITLE = "Claude Code";
const MESSAGE = "Claude Code 需要你的注意";

function isMac() { return os.platform() === "darwin"; }
function isWindows() { return os.platform() === "win32"; }
function isLinux() { return os.platform() === "linux"; }

function isTerminalFocused() {
  try {
    if (isMac()) {
      const frontApp = execSync(
        `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
        { encoding: "utf8" }
      ).trim();
      const terminalApps = ["Terminal", "iTerm2", "iTerm", "Ghostty", "kitty", "Alacritty", "WezTerm", "Hyper"];
      return terminalApps.includes(frontApp);
    }

    if (isWindows()) {
      // PowerShell: get the foreground window title
      const title = execSync(
        `powershell -NoProfile -Command "(Get-Process | Where-Object {$_.MainWindowHandle -eq (Add-Type -MemberDefinition '[DllImport(\\\"user32.dll\\\")] public static extern IntPtr GetForegroundWindow();' -Name Win32 -Namespace Native -PassThru)::GetForegroundWindow()}).MainWindowTitle"`,
        { encoding: "utf8" }
      ).trim().toLowerCase();
      const terminalKeywords = ["cmd", "powershell", "terminal", "command prompt", "windows terminal", "git bash", "mintty", "wezterm", "alacritty", "hyper"];
      return terminalKeywords.some(k => title.includes(k));
    }

    // Linux: skip focus detection (unreliable across DEs)
    return false;
  } catch (e) {
    return false;
  }
}

function sendNotification() {
  try {
    if (isMac()) {
      execSync(
        `osascript -e 'display notification "${MESSAGE}" with title "${TITLE}" sound name "Glass"'`
      );
    } else if (isWindows()) {
      execSync(
        `powershell -NoProfile -Command "[void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.BalloonTipTitle = '${TITLE}'; $n.BalloonTipText = '${MESSAGE}'; $n.Visible = $true; $n.ShowBalloonTip(5000)"`,
        { encoding: "utf8" }
      );
    } else if (isLinux()) {
      execSync(`notify-send "${TITLE}" "${MESSAGE}"`);
    }
  } catch (e) {
    // Silently fail
  }
}

try {
  if (!isTerminalFocused()) {
    sendNotification();
  }
} catch (e) {
  process.exit(0);
}
