# =============================================================
# 厨房小游戏 · 素材抠图工具 RemoveBg.ps1
#
# 【原理】洪水填充（BFS）抠图：
#   1. 取图片四边像素的平均颜色，作为"背景参考色"（我们的素材背景是浅灰白棋盘格）
#   2. 从四边开始扩散，凡颜色与背景参考色相近（容差内）且与边缘连通的像素 = 背景
#   3. 图标有"粗深色描边"，像围墙一样阻挡扩散，主体不受影响
#   4. 右下角水印区域用更高容差单独清除（水印是灰色文字，容差要放大才能吃掉）
#   5. 紧贴背景的边缘像素按颜色距离做 alpha 柔化，避免白边/锯齿
#
# 【用法】
#   powershell -File RemoveBg.ps1 -SrcDir 原图目录 -OutDir 输出目录
#   默认：备份原图目录 -> UI 目录（覆盖）
# =============================================================
param(
  [string]$SrcDir = 'D:\厨房小游戏\_原图备份_有水印',
  [string]$OutDir = 'D:\厨房小游戏\UI',
  [int]$Tolerance = 32,        # 全局背景容差（颜色距离）
  [int]$WatermarkTol = 100     # 右下角水印区域容差
)
$ErrorActionPreference = 'Stop'

# ---------- C# 核心算法（比 PowerShell 快几百倍） ----------
$cs = @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public static class RemoveBg {
  public static int Run(string src, string dst, int tol, int wmTol) {
    using (var s = new Bitmap(src)) {
      int w = s.Width, h = s.Height;
      // 复制到带 alpha 通道的 32 位位图（原始图没有 alpha 通道）
      using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
        using (var g = Graphics.FromImage(bmp)) { g.DrawImage(s, 0, 0, w, h); }
        var rect = new Rectangle(0, 0, w, h);
        var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int stride = data.Stride;
        int len = stride * h;
        byte[] buf = new byte[len];
        Marshal.Copy(data.Scan0, buf, 0, len);

        // 1. 背景参考色 = 四边采样均值（BGR 顺序存储）
        long sr=0, sg=0, sb=0; int cnt=0;
        Action<int,int> samp = (x,y) => { int i=y*stride+x*4; sr+=buf[i+2]; sg+=buf[i+1]; sb+=buf[i]; cnt++; };
        for (int x=0; x<w; x+=4) { samp(x,0); samp(x,h-1); }
        for (int y=0; y<h; y+=4) { samp(0,y); samp(w-1,y); }
        int bgr=(int)(sr/cnt), bgg=(int)(sg/cnt), bgb=(int)(sb/cnt);

        // 2. 洪水填充：从四边种子扩散，标记背景像素
        bool[] bg = new bool[w*h];
        var q = new Queue<int>();
        Action<int,int> seed = (x,y) => {
          int p=y*w+x; if(!bg[p]) {
            int i=y*stride+x*4;
            int dr=buf[i+2]-bgr, dg=buf[i+1]-bgg, db=buf[i]-bgb;
            if (dr*dr+dg*dg+db*db <= tol*tol) { bg[p]=true; q.Enqueue(p); }
          }
        };
        for (int x=0; x<w; x++){ seed(x,0); seed(x,h-1); }
        for (int y=0; y<h; y++){ seed(0,y); seed(w-1,y); }
        while (q.Count>0) {
          int p=q.Dequeue(); int y=p/w, x=p-(y*w);
          if (x>0)   { int n=p-1; if(!bg[n]){ int i=y*stride+(x-1)*4; int dr=buf[i+2]-bgr, dg=buf[i+1]-bgg, db=buf[i]-bgb; if(dr*dr+dg*dg+db*db<=tol*tol){ bg[n]=true; q.Enqueue(n); } } }
          if (x<w-1) { int n=p+1; if(!bg[n]){ int i=y*stride+(x+1)*4; int dr=buf[i+2]-bgr, dg=buf[i+1]-bgg, db=buf[i]-bgb; if(dr*dr+dg*dg+db*db<=tol*tol){ bg[n]=true; q.Enqueue(n); } } }
          if (y>0)   { int n=p-w; if(!bg[n]){ int i=(y-1)*stride+x*4; int dr=buf[i+2]-bgr, dg=buf[i+1]-bgg, db=buf[i]-bgb; if(dr*dr+dg*dg+db*db<=tol*tol){ bg[n]=true; q.Enqueue(n); } } }
          if (y<h-1) { int n=p+w; if(!bg[n]){ int i=(y+1)*stride+x*4; int dr=buf[i+2]-bgr, dg=buf[i+1]-bgg, db=buf[i]-bgb; if(dr*dr+dg*dg+db*db<=tol*tol){ bg[n]=true; q.Enqueue(n); } } }
        }

        // 3. 右下角水印区域：高容差清除（覆盖水印灰色文字）
        int wmX=(int)(w*0.78), wmY=(int)(h*0.92);
        for (int y=wmY; y<h; y++) {
          for (int x=wmX; x<w; x++) {
            int p=y*w+x; int i=y*stride+x*4;
            int dr=buf[i+2]-bgr, dg=buf[i+1]-bgg, db=buf[i]-bgb;
            if (dr*dr+dg*dg+db*db <= wmTol*wmTol) { bg[p]=true; }
          }
        }

        // 4. 写 alpha 通道：背景=0；紧贴背景的边缘像素柔化；其余=255
        for (int y=0; y<h; y++) {
          for (int x=0; x<w; x++) {
            int p=y*w+x; int i=y*stride+x*4;
            if (bg[p]) { buf[i+3]=0; continue; }
            bool near = (x>0&&bg[p-1])||(x<w-1&&bg[p+1])||(y>0&&bg[p-w])||(y<h-1&&bg[p+w]);
            if (near) {
              int dr=buf[i+2]-bgr, dg=buf[i+1]-bgg, db=buf[i]-bgb;
              int dist=(int)Math.Sqrt(dr*dr+dg*dg+db*db);
              int a=(dist-tol)*255/24; if(a<0)a=0; if(a>255)a=255;
              buf[i+3]=(byte)a;
            } else { buf[i+3]=255; }
          }
        }

        Marshal.Copy(buf, 0, data.Scan0, len);
        bmp.UnlockBits(data);
        bmp.Save(dst, ImageFormat.Png);
      }
    }
    return 0;
  }
}
"@

Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Drawing

# ---------- 逐张处理 ----------
$files = Get-ChildItem -Path (Join-Path $SrcDir '*.png')
$total = $files.Count
$i = 0
foreach ($f in $files) {
  $i++
  $out = Join-Path $OutDir $f.Name
  [RemoveBg]::Run($f.FullName, $out, $Tolerance, $WatermarkTol)
  Write-Output ("[{0}/{1}] {2}" -f $i, $total, $f.Name)
}
Write-Output ("全部完成，共 {0} 张" -f $total)
