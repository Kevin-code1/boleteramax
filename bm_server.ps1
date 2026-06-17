$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:7734/')
$listener.Start()
Write-Host "Server running on port 7734"
while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = $ctx.Request.Url.LocalPath
    if ($path -eq '/') { $path = '/index.html' }
    $file = Join-Path $PSScriptRoot $path.TrimStart('/').Replace('/', '\')
    try {
        $bytes = [System.IO.File]::ReadAllBytes($file)
        $ext = [System.IO.Path]::GetExtension($file)
        $ct = switch ($ext) {
            '.html' { 'text/html; charset=utf-8' }
            '.css'  { 'text/css' }
            '.js'   { 'application/javascript' }
            '.png'  { 'image/png' }
            '.webp' { 'image/webp' }
            '.jpg'  { 'image/jpeg' }
            default { 'text/plain' }
        }
        $ctx.Response.ContentType = $ct
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
        $ctx.Response.StatusCode = 404
        $body = [Text.Encoding]::UTF8.GetBytes('Not found')
        $ctx.Response.OutputStream.Write($body, 0, $body.Length)
    }
    $ctx.Response.Close()
}
