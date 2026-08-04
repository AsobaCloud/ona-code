# Ollama Windows Server Setup — AsobaCorp-1

How the Windows machine (`AsobaCorp-1.local`) is configured to serve Ollama models over the LAN so other machines (e.g. your Mac running ona-code) can use them remotely.

## What's installed

- **Ollama** installed at `C:\Users\shing\AppData\Local\Programs\Ollama\ollama.exe` (standard per-user install via the Ollama Windows installer)
- **Installed models** (as of July 2026):

  | Model | Size |
  |---|---|
  | `deepseek-coder-v2:latest` | 8.9 GB |
  | `deepseek-coder-v2:16b` | 8.9 GB |
  | `deepseek-r1:14b` | 9.0 GB |
  | `qwen2.5:14b` | 9.0 GB |
  | `codegemma:7b` | 5.0 GB |
  | `glm-5.1:cloud` | cloud (no local weights) |

## How it's exposed on the LAN

By default Ollama only listens on `127.0.0.1:11434` (localhost only). To expose it to other machines on the network, one system environment variable must be set:

```
OLLAMA_HOST = 0.0.0.0
```

This is set at the **system level** (HKLM), not the user level, so it applies regardless of which user is logged in.

### How to verify or set it

Open an elevated PowerShell prompt (Run as Administrator):

```powershell
# Check current value
[System.Environment]::GetEnvironmentVariable("OLLAMA_HOST", "Machine")

# Set it (requires Administrator)
[System.Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0", "Machine")
```

After setting or changing `OLLAMA_HOST`, you must **restart Ollama** for it to take effect (kill the tray icon and relaunch, or reboot).

With `OLLAMA_HOST=0.0.0.0`, Ollama binds to all interfaces:
```
TCP    0.0.0.0:11434    LISTENING
TCP    [::]:11434       LISTENING
```

## Windows Firewall rules

Two inbound firewall rules allow TCP 11434 through the firewall:

| Rule name | Direction | Protocol | Port | Profiles | Action |
|---|---|---|---|---|---|
| `Ollama` | Inbound | TCP | 11434 | Domain, Private, Public | Allow |
| `Ollama-WSL` | Inbound | TCP | 11434 | Domain, Private, Public | Allow |

The `Ollama` rule covers connections from the LAN. The `Ollama-WSL` rule covers connections from WSL (Windows Subsystem for Linux) on the same machine.

### How to recreate the firewall rules if needed

Open an elevated PowerShell prompt:

```powershell
# Main LAN rule
New-NetFirewallRule -DisplayName "Ollama" `
  -Direction Inbound -Protocol TCP -LocalPort 11434 `
  -Action Allow -Profile Any

# WSL rule (same settings, separate rule for clarity)
New-NetFirewallRule -DisplayName "Ollama-WSL" `
  -Direction Inbound -Protocol TCP -LocalPort 11434 `
  -Action Allow -Profile Any
```

## How Ollama starts

Ollama is **not** a Windows service and is **not** in any startup registry key. It runs as a tray app (`ollama.exe` in the system tray) and must be launched manually after a reboot.

### To start Ollama

Double-click the Ollama icon in the Start menu or run from PowerShell:

```powershell
& "C:\Users\shing\AppData\Local\Programs\Ollama\ollama.exe"
```

The process will appear in the system tray. You can verify it's running and listening:

```powershell
# Check the process is running
Get-Process ollama

# Check it's listening on 11434
netstat -an | findstr 11434
```

### Auto-start on login

Ollama is configured to start automatically when `shing` logs in. The following registry entry is set:

```
HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\Run
    Ollama    REG_SZ    C:\Users\shing\AppData\Local\Programs\Ollama\ollama.exe
```

Verify it is still set:

```powershell
reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" /v Ollama
```

To remove auto-start if needed:

```powershell
Remove-ItemProperty -Path "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name "Ollama"
```

To re-add it:

```powershell
$regPath = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
$ollamaExe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
Set-ItemProperty -Path $regPath -Name "Ollama" -Value $ollamaExe
```

> **Note:** This starts Ollama when the `shing` user logs into Windows, not at system boot. If the machine reboots with no one logged in (e.g. a remote reboot), Ollama will not start until someone signs in. For a fully headless/unattended setup, converting it to a Windows service would be needed — but that requires a third-party tool like NSSM since Ollama does not ship a native service installer.

## Managing models

```powershell
# List installed models
ollama list

# Pull a new model
ollama pull qwen2.5:14b

# Remove a model
ollama rm codegemma:7b

# Run a model interactively (for testing)
ollama run deepseek-coder-v2
```

## Verifying LAN access from another machine

From your Mac (or any machine on the same network):

```bash
# Check the API is reachable
curl http://AsobaCorp-1.local:11434/api/tags

# Should return JSON with the list of installed models
```

If `AsobaCorp-1.local` doesn't resolve, use the machine's IP address directly. Find it on the Windows machine with:

```powershell
ipconfig | findstr "IPv4"
```
