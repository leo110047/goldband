#!/usr/bin/env node

// Cross-platform notification — only sends when terminal is NOT focused
// Supports: macOS (osascript), Windows (PowerShell), Linux (notify-send)
// Trigger: Notification hook (permission_prompt, idle_prompt, elicitation_dialog)

const { execSync } = require("child_process");
const os = require("os");

const TITLE = "Claude Code";

const NOTIFICATION_MESSAGES = {
  permission_prompt: "需要你的同意才能繼續",
  elicitation_dialog: "有問題想問你",
};

const SKIP_TYPES = ["auth_success", "idle_prompt"];

function getMessage(data) {
  const event = data.hook_event_name;
  const notifType = data.notification_type;

  if (event === "Stop") {
    return "等待下一步指示";
  }
  if (notifType && NOTIFICATION_MESSAGES[notifType]) {
    return NOTIFICATION_MESSAGES[notifType];
  }
  return "需要你的注意";
}

function isMac() {
  return os.platform() === "darwin";
}
function isWindows() {
  return os.platform() === "win32";
}
function isLinux() {
  return os.platform() === "linux";
}

function getStdinData() {
  try {
    const fd = require("fs").openSync("/dev/stdin", "r");
    const buf = Buffer.alloc(4096);
    const bytesRead = require("fs").readSync(fd, buf, 0, buf.length);
    require("fs").closeSync(fd);
    const data = buf.toString("utf8", 0, bytesRead);
    if (!data.trim()) return {};
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

function isTerminalFocused() {
  try {
    if (isMac()) {
      const frontApp = execSync(
        `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
        { encoding: "utf8" },
      ).trim();
      const terminalApps = [
        "Terminal",
        "iTerm2",
        "iTerm",
        "Ghostty",
        "kitty",
        "Alacritty",
        "WezTerm",
        "Hyper",
      ];
      return terminalApps.includes(frontApp);
    }

    if (isWindows()) {
      const title = execSync(
        `powershell -NoProfile -Command "(Get-Process | Where-Object {$_.MainWindowHandle -eq (Add-Type -MemberDefinition '[DllImport(\\\"user32.dll\\\")] public static extern IntPtr GetForegroundWindow();' -Name Win32 -Namespace Native -PassThru)::GetForegroundWindow()}).MainWindowTitle"`,
        { encoding: "utf8" },
      )
        .trim()
        .toLowerCase();
      const terminalKeywords = [
        "cmd",
        "powershell",
        "terminal",
        "command prompt",
        "windows terminal",
        "git bash",
        "mintty",
        "wezterm",
        "alacritty",
        "hyper",
      ];
      return terminalKeywords.some((k) => title.includes(k));
    }

    return false;
  } catch (e) {
    return false;
  }
}

function sendNotification(message) {
  try {
    if (isMac()) {
      execSync(
        `osascript -e 'display notification "${message}" with title "${TITLE}" sound name "Glass"'`,
      );
    } else if (isWindows()) {
      execSync(
        `powershell -NoProfile -Command "[void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.BalloonTipTitle = '${TITLE}'; $n.BalloonTipText = '${message}'; $n.Visible = $true; $n.ShowBalloonTip(5000)"`,
        { encoding: "utf8" },
      );
    } else if (isLinux()) {
      execSync(`notify-send "${TITLE}" "${message}"`);
    }
  } catch (e) {
    // Silently fail
  }
}

try {
  const data = getStdinData();
  const notifType = data.notification_type;
  const focused = isTerminalFocused();

  if (focused) {
    process.exit(0);
  }
  if (SKIP_TYPES.includes(notifType)) {
    process.exit(0);
  }

  const message = getMessage(data);
  sendNotification(message);
} catch (e) {
  process.exit(0);
}
