$log = 'C:\Users\cyber sev3n\Documents\GitHub\atlas-ai-core\.freebuff\preview-8e0cf367-bb8d-414d-b339-770fab68c000.log'
$err = 'C:\Users\cyber sev3n\Documents\GitHub\atlas-ai-core\.freebuff\preview-8e0cf367-bb8d-414d-b339-770fab68c000.log.err'
$p = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -RedirectStandardOutput $log -RedirectStandardError $err -WindowStyle Hidden -PassThru
$p.Id | Out-File -FilePath 'C:\Users\cyber sev3n\Documents\GitHub\atlas-ai-core\.freebuff\preview.pid' -Encoding ascii
