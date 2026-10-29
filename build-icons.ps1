Add-Type -AssemblyName System.Drawing
$canvas = New-Object System.Drawing.Bitmap 2048,2048
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.ScaleTransform(4,4)
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#5865f2'))
$white = [System.Drawing.Brushes]::White
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White),28
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$headband = New-Object System.Drawing.Drawing2D.GraphicsPath
$headband.AddLine(136,272,136,228)
$headband.AddBezier(136,228,136,162,190,108,256,108)
$headband.AddBezier(256,108,322,108,376,162,376,228)
$headband.AddLine(376,228,376,272)
$graphics.DrawPath($pen,$headband)
foreach ($left in @(112,348)) {
  $ear = New-Object System.Drawing.Drawing2D.GraphicsPath
  $ear.AddArc($left,238,52,52,180,180)
  $ear.AddArc($left,288,52,52,0,180)
  $ear.CloseFigure()
  $graphics.FillPath($white,$ear)
  $ear.Dispose()
}
$triangle = [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(226,222),[System.Drawing.PointF]::new(226,312),[System.Drawing.PointF]::new(302,267))
$graphics.FillPolygon($white,$triangle)
foreach ($size in @(180,192,512)) {
  $output = New-Object System.Drawing.Bitmap $size,$size
  $target = [System.Drawing.Graphics]::FromImage($output)
  $target.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $target.DrawImage($canvas,0,0,$size,$size)
  $name = if ($size -eq 180) { 'apple-touch-icon.png' } else { "icon-$size.png" }
  $output.Save((Join-Path $PSScriptRoot $name),[System.Drawing.Imaging.ImageFormat]::Png)
  $target.Dispose()
  $output.Dispose()
}
$headband.Dispose()
$pen.Dispose()
$graphics.Dispose()
$canvas.Dispose()
