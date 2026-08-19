' Start ChemTrack with no visible console (used by the logon task).
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File """ & root & "\scripts\start.ps1"" -NoBrowser"
CreateObject("WScript.Shell").Run cmd, 0, False
