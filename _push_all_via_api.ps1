$ErrorActionPreference = "Stop"
$gh = "$env:ProgramFiles\GitHub CLI\gh.exe"
$repo = "sripavantejb/GuideXpert-Backend"
$srcRoot = "c:\Users\Nxtwave\Desktop\guidexpert\backend"

function Get-GitBlobSha([byte[]]$bytes) {
  $prefix = [System.Text.Encoding]::ASCII.GetBytes("blob $($bytes.Length)`0")
  $sha1 = [System.Security.Cryptography.SHA1]::Create()
  try {
    $sha1.TransformBlock($prefix, 0, $prefix.Length, $null, 0) | Out-Null
    $sha1.TransformFinalBlock($bytes, 0, $bytes.Length) | Out-Null
    return ([BitConverter]::ToString($sha1.Hash) -replace '-', '').ToLowerInvariant()
  } finally {
    $sha1.Dispose()
  }
}

Write-Host "Fetching remote HEAD..."
$repoInfo = & $gh api "repos/$repo" | ConvertFrom-Json
$branch = $repoInfo.default_branch
$ref = & $gh api "repos/$repo/git/ref/heads/$branch" | ConvertFrom-Json
$headSha = $ref.object.sha
$commit = & $gh api "repos/$repo/git/commits/$headSha" | ConvertFrom-Json
$baseTree = $commit.tree.sha
Write-Host "branch=$branch HEAD=$($headSha.Substring(0,7)) tree=$($baseTree.Substring(0,7))"

Write-Host "Fetching recursive remote tree..."
$remoteTree = & $gh api "repos/$repo/git/trees/${baseTree}?recursive=1" | ConvertFrom-Json
$remoteMap = @{}
foreach ($item in $remoteTree.tree) {
  if ($item.type -eq 'blob') {
    $remoteMap[$item.path] = $item.sha
  }
}
Write-Host ("Remote blobs: {0}" -f $remoteMap.Count)

$localFiles = Get-ChildItem -Path $srcRoot -Recurse -File | Where-Object {
  $full = $_.FullName
  $name = $_.Name
  if ($full -match '\\node_modules\\|\\dist\\|\\.git\\|\\coverage\\') { return $false }
  if ($name -eq '.env' -or $name -eq '.env.local') { return $false }
  if ($name -match '^\.env\..*\.local$') { return $false }
  if ($name -match 'credentials|serviceAccount|private.?key' -and $_.Extension -in @('.json','.pem')) { return $false }
  if ($_.Extension -in @('.map', '.log')) { return $false }
  if ($name -eq 'backend@1.0.0') { return $false }
  return $true
}

Write-Host ("Scanning {0} local files..." -f @($localFiles).Count)
$changed = New-Object System.Collections.Generic.List[object]
foreach ($f in $localFiles) {
  $rel = $f.FullName.Substring($srcRoot.Length).TrimStart('\').TrimStart('/').Replace('\', '/')
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  $sha = Get-GitBlobSha $bytes
  $remoteSha = $remoteMap[$rel]
  if ($remoteSha -ne $sha) {
    $changed.Add([pscustomobject]@{ Path = $rel; Bytes = $bytes; Sha = $sha; Size = $bytes.Length }) | Out-Null
  }
}

Write-Host ("Changed/new files: {0}" -f $changed.Count)
if ($changed.Count -eq 0) {
  Write-Host "Nothing to push - local already matches remote main."
  exit 0
}

$n = 0
foreach ($c in $changed) {
  $n++
  if ($n -le 80) {
    Write-Host ("  {0,8}  {1}" -f $c.Size, $c.Path)
  }
}
if ($changed.Count -gt 80) {
  Write-Host ("  ... and {0} more" -f ($changed.Count - 80))
}

$treeItems = New-Object System.Collections.Generic.List[object]
$i = 0
$maxBytes = 40MB
foreach ($item in $changed) {
  $i++
  if ($item.Size -gt $maxBytes) {
    Write-Host ("SKIP too large: {0}" -f $item.Path)
    continue
  }
  $b64 = [Convert]::ToBase64String($item.Bytes)
  $blobBody = (@{ content = $b64; encoding = "base64" } | ConvertTo-Json -Compress)
  $blobPath = Join-Path $env:TEMP ("gx-blob-" + [guid]::NewGuid().ToString() + ".json")
  [System.IO.File]::WriteAllText($blobPath, $blobBody, [System.Text.UTF8Encoding]::new($false))
  $blob = & $gh api "repos/$repo/git/blobs" --method POST --input $blobPath | ConvertFrom-Json
  Remove-Item $blobPath -Force
  Write-Host ("[{0}/{1}] blob {2} {3}" -f $i, $changed.Count, $blob.sha.Substring(0,7), $item.Path)
  $treeItems.Add(@{ path = $item.Path; mode = "100644"; type = "blob"; sha = $blob.sha }) | Out-Null
}

if ($treeItems.Count -eq 0) {
  Write-Host "No uploadable changes after filters."
  exit 0
}

$treePayload = (@{ base_tree = $baseTree; tree = @($treeItems.ToArray()) } | ConvertTo-Json -Depth 8 -Compress)
$treePath = Join-Path $env:TEMP "gx-tree-be.json"
[System.IO.File]::WriteAllText($treePath, $treePayload, [System.Text.UTF8Encoding]::new($false))
$newTree = & $gh api "repos/$repo/git/trees" --method POST --input $treePath | ConvertFrom-Json
Remove-Item $treePath -Force
Write-Host ("new tree: {0}" -f $newTree.sha)

$commitMsg = "Sync all local backend files to main.`n`nUpload every source file that differed from remote (excluding secrets and node_modules)."
$commitPayload = (@{
  message = $commitMsg
  tree    = $newTree.sha
  parents = @($headSha)
} | ConvertTo-Json -Depth 5 -Compress)
$commitPath = Join-Path $env:TEMP "gx-commit-be.json"
[System.IO.File]::WriteAllText($commitPath, $commitPayload, [System.Text.UTF8Encoding]::new($false))
$newCommit = & $gh api "repos/$repo/git/commits" --method POST --input $commitPath | ConvertFrom-Json
Remove-Item $commitPath -Force
Write-Host ("new commit: {0}" -f $newCommit.sha)

$refPayload = (@{ sha = $newCommit.sha; force = $false } | ConvertTo-Json -Compress)
$refPath = Join-Path $env:TEMP "gx-ref-be.json"
[System.IO.File]::WriteAllText($refPath, $refPayload, [System.Text.UTF8Encoding]::new($false))
& $gh api "repos/$repo/git/refs/heads/$branch" --method PATCH --input $refPath | Out-Null
Remove-Item $refPath -Force

$url = "https://github.com/$repo/commit/$($newCommit.sha)"
Write-Host ("Pushed {0} files to {1}: {2}" -f $treeItems.Count, $branch, $url)
Write-Host $newCommit.sha
