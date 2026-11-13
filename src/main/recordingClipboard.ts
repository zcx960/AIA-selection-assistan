import { clipboard } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

export function windowsCopyScript(filePath: string): string {
  // Data is encoded separately from PowerShell syntax, including quotes/Unicode.
  const pathData = Buffer.from(filePath, 'utf8').toString('base64')
  return `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Windows.Forms; ` +
    `$recordingFiles = New-Object System.Collections.Specialized.StringCollection; ` +
    `[void]$recordingFiles.Add([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${pathData}'))); ` +
    `for ($recordingAttempt = 0; $recordingAttempt -lt 5; $recordingAttempt++) { ` +
    `try { [Windows.Forms.Clipboard]::SetFileDropList($recordingFiles); exit 0 } ` +
    `catch { if ($recordingAttempt -eq 4) { throw }; Start-Sleep -Milliseconds 100 } }`
}

export async function copyRecordingFile(filePath: string): Promise<void> {
  if (process.platform === 'darwin') {
    clipboard.writeBuffer('public.file-url', Buffer.from(pathToFileURL(filePath).href))
  } else if (process.platform === 'win32') {
    // Electron writeBuffer registers custom formats; a format named CF_HDROP
    // is not the native CF_HDROP. WinForms publishes a real file-drop list.
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand',
      Buffer.from(windowsCopyScript(filePath), 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000 })
  } else {
    clipboard.writeBuffer('text/uri-list', Buffer.from(`${pathToFileURL(filePath).href}\r\n`))
  }
}
