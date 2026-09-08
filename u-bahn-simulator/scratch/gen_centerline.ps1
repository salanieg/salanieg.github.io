# Centerline regenerator: replaces the old 27-station-spline centerline (cx/cz) with the
# REAL GPS track midline (relations 538906/538907 from Daten.js), then re-anchors station
# positions + elevation breakpoints to the new arc length.
#
# IMPORTANT: this script does NOT write gap[] — after running it, run gen_tracks.ps1 to
# re-harvest the gap against the new centerline and splice scratch/gap_js.txt into
# TrackData.js (with explicit UTF-8 read/write!).
$ErrorActionPreference = 'Stop'
[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::InvariantCulture

$utf8 = New-Object System.Text.UTF8Encoding($false)
$tdPath = (Resolve-Path "src/simulator/TrackData.js").Path
$td = [System.IO.File]::ReadAllText($tdPath, [System.Text.Encoding]::UTF8)

# ---------- 1. Parse old TrackData ----------
function ParseArray($name){ $m=[regex]::Match($td,$name+':\s*\[([^\]]*)\]'); if(-not $m.Success){throw "no $name"}; return @($m.Groups[1].Value -split ',' | ForEach-Object {[double]$_}) }
$cxOld=ParseArray 'cx'; $czOld=ParseArray 'cz'
$step=[double]([regex]::Match($td,'step:\s*([0-9.]+)').Groups[1].Value)
$NOld=$cxOld.Count
Write-Output ("old centerline N=$NOld step=$step")

$stations=New-Object System.Collections.Generic.List[object]
foreach($line in ($td -split "`n")){
  $mm=[regex]::Match($line,'name:"([^"]+)".*?position:([0-9.]+),halfLength:([0-9.]+),platformSpacing:([0-9.]+)')
  if($mm.Success){$stations.Add([pscustomobject]@{name=$mm.Groups[1].Value;pos=[double]$mm.Groups[2].Value;hl=[double]$mm.Groups[3].Value;ps=[double]$mm.Groups[4].Value})}
}
Write-Output ("stations: " + $stations.Count)

$elevM=[regex]::Match($td,'elevation:\s*\{([^}]*)\}')
$elev=[ordered]@{}
foreach($kv in ($elevM.Groups[1].Value -split ',')){ $p=$kv.Trim() -split ':'; $elev[$p[0].Trim()]=[double]$p[1] }
Write-Output ("elevation keys: " + ($elev.Keys -join ","))

# ---------- 2. GPS rails from Daten.js ----------
$raw=Get-Content "src/simulator/Daten.js" -Raw
$json=$raw.Substring($raw.IndexOf('{')).TrimEnd("`r","`n"," ",";")
$g=$json|ConvertFrom-Json
$lat0=49.44; $mLat=111320.0; $mLon=111320.0*[math]::Cos($lat0*[math]::PI/180.0)
function MainTrack($id){
  $feat=$null; foreach($f in $g.features){ if($f.properties.'@id' -eq $id){$feat=$f;break} }
  $bestN=0
  foreach($seg in $feat.geometry.coordinates){ if($seg.Count -gt $bestN){ $bestN=$seg.Count; $bestSeg=$seg } }
  # world frame is MIRRORED vs GPS projection -> negate Y (reflection)
  $xs=New-Object double[] $bestN; $ys=New-Object double[] $bestN
  for($i=0;$i -lt $bestN;$i++){ $xs[$i]=[double]$bestSeg[$i][0]*$mLon; $ys[$i]=-[double]$bestSeg[$i][1]*$mLat }
  return @{x=$xs;y=$ys}
}
$A=MainTrack 'relation/538906'   # Hardhoehe->Langwasser
$B=MainTrack 'relation/538907'   # Langwasser->Hardhoehe
Write-Output ("rail A pts=" + $A.x.Count + " B pts=" + $B.x.Count)

# ---------- 3. arc-length resample of the rails ----------
function Resample($poly,$NS){
  $x=$poly.x;$y=$poly.y;$n=$x.Count
  $cum=New-Object double[] $n;$cum[0]=0
  for($i=1;$i -lt $n;$i++){ $dx=$x[$i]-$x[$i-1];$dy=$y[$i]-$y[$i-1];$cum[$i]=$cum[$i-1]+[math]::Sqrt($dx*$dx+$dy*$dy) }
  $L=$cum[$n-1];$rx=New-Object double[] $NS;$ry=New-Object double[] $NS;$seg=0
  for($m=0;$m -lt $NS;$m++){ $t=$L*$m/($NS-1); while($seg -lt $n-2 -and $cum[$seg+1] -lt $t){$seg++}; $sl=$cum[$seg+1]-$cum[$seg]; if($sl -le 0){$sl=1}; $f=($t-$cum[$seg])/$sl; $rx[$m]=$x[$seg]+($x[$seg+1]-$x[$seg])*$f; $ry[$m]=$y[$seg]+($y[$seg+1]-$y[$seg])*$f }
  return @{x=$rx;y=$ry;L=$L}
}

# dense midline (B forward + A reversed), same construction as gen_tracks.ps1
$NSD=3000
$rA=Resample $A $NSD; $rB=Resample $B $NSD
$mlx=New-Object double[] $NSD;$mly=New-Object double[] $NSD
for($m=0;$m -lt $NSD;$m++){ $j=$NSD-1-$m; $mlx[$m]=($rB.x[$m]+$rA.x[$j])/2; $mly[$m]=($rB.y[$m]+$rA.y[$j])/2 }
Write-Output ("rail length A=" + [int]$rA.L + "m B=" + [int]$rB.L + "m")

# ---------- 4. Umeyama fit into the existing world frame ----------
# Identical anchoring to gen_tracks.ps1: GPS extent corresponds to old centerline arc
# [station0.pos .. stationLast.pos], index correspondence, NS=400 for the fit.
$NSF=400
$rAf=Resample $A $NSF; $rBf=Resample $B $NSF
$mfx=New-Object double[] $NSF;$mfy=New-Object double[] $NSF
for($m=0;$m -lt $NSF;$m++){ $j=$NSF-1-$m; $mfx[$m]=($rBf.x[$m]+$rAf.x[$j])/2; $mfy[$m]=($rBf.y[$m]+$rAf.y[$j])/2 }
$arcStart=$stations[0].pos; $arcEnd=$stations[$stations.Count-1].pos
$idxStart=$arcStart/$step; $idxEnd=$arcEnd/$step
$ccx=New-Object double[] $NSF;$ccy=New-Object double[] $NSF
for($m=0;$m -lt $NSF;$m++){
  $fidx=$idxStart+($idxEnd-$idxStart)*$m/($NSF-1)
  $i0=[int][math]::Floor($fidx); if($i0 -gt $NOld-2){$i0=$NOld-2}; $fr=$fidx-$i0
  $ccx[$m]=$cxOld[$i0]+($cxOld[$i0+1]-$cxOld[$i0])*$fr; $ccy[$m]=$czOld[$i0]+($czOld[$i0+1]-$czOld[$i0])*$fr
}
function Umeyama($px,$py,$qx,$qy,$n){
  $mpx=0;$mpy=0;$mqx=0;$mqy=0; for($i=0;$i -lt $n;$i++){$mpx+=$px[$i];$mpy+=$py[$i];$mqx+=$qx[$i];$mqy+=$qy[$i]}; $mpx/=$n;$mpy/=$n;$mqx/=$n;$mqy/=$n
  $Sxx=0;$Sxy=0;$varp=0
  for($i=0;$i -lt $n;$i++){ $pcx=$px[$i]-$mpx;$pcy=$py[$i]-$mpy;$qcx=$qx[$i]-$mqx;$qcy=$qy[$i]-$mqy; $Sxx+=$pcx*$qcx+$pcy*$qcy; $Sxy+=$pcx*$qcy-$pcy*$qcx; $varp+=$pcx*$pcx+$pcy*$pcy }
  $th=[math]::Atan2($Sxy,$Sxx); $ct=[math]::Cos($th);$st=[math]::Sin($th); $s=[math]::Sqrt($Sxx*$Sxx+$Sxy*$Sxy)/$varp
  $tx=$mqx-$s*($ct*$mpx-$st*$mpy);$ty=$mqy-$s*($st*$mpx+$ct*$mpy)
  return @{s=$s;ct=$ct;st=$st;tx=$tx;ty=$ty;th=$th}
}
$T=Umeyama $mfx $mfy $ccx $ccy $NSF
Write-Output ("fit scale=" + [math]::Round($T.s,5) + " rotDeg=" + [math]::Round($T.th*180/[math]::PI,2))

# transform dense midline to world frame
$wx=New-Object double[] $NSD;$wy=New-Object double[] $NSD
for($i=0;$i -lt $NSD;$i++){ $wx[$i]=$T.tx+$T.s*($T.ct*$mlx[$i]-$T.st*$mly[$i]); $wy[$i]=$T.ty+$T.s*($T.st*$mlx[$i]+$T.ct*$mly[$i]) }

# ---------- 5. light smoothing of the dense world midline ----------
# dense spacing is ~6.2m; 2 passes of +-3 samples spread GPS polyline kinks over ~40m.
# Rail feel without shape distortion (chord error on a 300m-radius curve: ~0.5m).
function SmoothXY([double[]]$ax,[double[]]$ay,$passes,$w){
  $n=$ax.Count
  for($p=0;$p -lt $passes;$p++){
    $bx=$ax.Clone(); $by=$ay.Clone()
    for($i=0;$i -lt $n;$i++){
      $s=0.0;$t=0.0;$wt=0
      for($k=-$w;$k -le $w;$k++){ $j=$i+$k; if($j -ge 0 -and $j -lt $n){ $s+=$bx[$j]; $t+=$by[$j]; $wt++ } }
      $ax[$i]=$s/$wt; $ay[$i]=$t/$wt
    }
  }
}
SmoothXY $wx $wy 2 3

# ---------- 6. arc-length resample at exactly 5m + straight end pads ----------
$cum=New-Object double[] $NSD;$cum[0]=0
for($i=1;$i -lt $NSD;$i++){ $dx=$wx[$i]-$wx[$i-1];$dy=$wy[$i]-$wy[$i-1];$cum[$i]=$cum[$i-1]+[math]::Sqrt($dx*$dx+$dy*$dy) }
$Lcore=$cum[$NSD-1]
$Ncore=[int][math]::Floor($Lcore/$step)+1
$corex=New-Object double[] $Ncore;$corey=New-Object double[] $Ncore
$seg=0
for($m=0;$m -lt $Ncore;$m++){
  $t=$step*$m; if($t -gt $Lcore){$t=$Lcore}
  while($seg -lt $NSD-2 -and $cum[$seg+1] -lt $t){$seg++}
  $sl=$cum[$seg+1]-$cum[$seg]; if($sl -le 0){$sl=1}; $f=($t-$cum[$seg])/$sl
  $corex[$m]=$wx[$seg]+($wx[$seg+1]-$wx[$seg])*$f; $corey[$m]=$wy[$seg]+($wy[$seg+1]-$wy[$seg])*$f
}
Write-Output ("core arc length=" + [math]::Round($Lcore,1) + "m -> " + $Ncore + " samples")

# straight 70m pads at both ends (run-off beyond the terminus platforms, as before)
$padN=14
$N2=$padN+$Ncore+$padN
$cxNew=New-Object double[] $N2;$czNew=New-Object double[] $N2
# start tangent (first core segment), end tangent (last core segment)
$sdx=$corex[1]-$corex[0];$sdy=$corey[1]-$corey[0];$sl=[math]::Sqrt($sdx*$sdx+$sdy*$sdy);$sdx/=$sl;$sdy/=$sl
$edx=$corex[$Ncore-1]-$corex[$Ncore-2];$edy=$corey[$Ncore-1]-$corey[$Ncore-2];$el=[math]::Sqrt($edx*$edx+$edy*$edy);$edx/=$el;$edy/=$el
for($i=0;$i -lt $padN;$i++){ $d=($padN-$i)*$step; $cxNew[$i]=$corex[0]-$sdx*$d; $czNew[$i]=$corey[0]-$sdy*$d }
for($i=0;$i -lt $Ncore;$i++){ $cxNew[$padN+$i]=$corex[$i]; $czNew[$padN+$i]=$corey[$i] }
for($i=0;$i -lt $padN;$i++){ $d=($i+1)*$step; $cxNew[$padN+$Ncore+$i]=$corex[$Ncore-1]+$edx*$d; $czNew[$padN+$Ncore+$i]=$corey[$Ncore-1]+$edy*$d }
$totalNew=($N2-1)*$step
Write-Output ("new centerline N=" + $N2 + " total=" + $totalNew + "m (old total=" + [regex]::Match($td,'total:\s*([0-9.]+)').Groups[1].Value + ")")

# ---------- 7. project old world points onto new centerline (arc re-anchoring) ----------
function OldWorldPoint($dist){
  $u=$dist/$step; $i=[int][math]::Floor($u); if($i -lt 0){$i=0}; if($i -gt $NOld-2){$i=$NOld-2}; $f=$u-$i
  $px=$cxOld[$i]+($cxOld[$i+1]-$cxOld[$i])*$f; $py=$czOld[$i]+($czOld[$i+1]-$czOld[$i])*$f
  return @($px,$py)
}
function ProjectToNew($px,$py){
  $best=[double]::MaxValue;$bestArc=0.0
  for($i=0;$i -lt ($N2-1);$i++){
    $ax=$cxNew[$i];$ay=$czNew[$i];$bx=$cxNew[$i+1];$by=$czNew[$i+1]
    $vx=$bx-$ax;$vy=$by-$ay;$len2=$vx*$vx+$vy*$vy; if($len2 -le 0){continue}
    $t=(($px-$ax)*$vx+($py-$ay)*$vy)/$len2; if($t -lt 0){$t=0}; if($t -gt 1){$t=1}
    $qx=$ax+$vx*$t;$qy=$ay+$vy*$t
    $d2=($px-$qx)*($px-$qx)+($py-$qy)*($py-$qy)
    if($d2 -lt $best){ $best=$d2; $bestArc=($i+$t)*$step }
  }
  return @($bestArc,[math]::Sqrt($best))
}
Write-Output "=== station re-anchoring (old arc -> new arc, lateral shift) ==="
$newPos=@{}
foreach($s in $stations){
  $wp=OldWorldPoint $s.pos
  $pr=ProjectToNew $wp[0] $wp[1]
  $newPos[$s.name]=[math]::Round($pr[0],2)
  Write-Output ("  {0,-22} {1,9} -> {2,9}  (lateral {3,5}m)" -f $s.name,$s.pos,$newPos[$s.name],[math]::Round($pr[1],1))
}
Write-Output "=== elevation breakpoint re-anchoring ==="
$newElev=[ordered]@{}
foreach($k in $elev.Keys){
  $wp=OldWorldPoint $elev[$k]
  $pr=ProjectToNew $wp[0] $wp[1]
  $newElev[$k]=[math]::Round($pr[0],2)
  Write-Output ("  {0,-4} {1,9} -> {2,9}" -f $k,$elev[$k],$newElev[$k])
}

# ---------- 8. curvature sanity ----------
$maxTurn=0.0;$maxTurnPos=0
for($i=1;$i -lt ($N2-1);$i++){
  $h1=[math]::Atan2($cxNew[$i]-$cxNew[$i-1],$czNew[$i]-$czNew[$i-1])
  $h2=[math]::Atan2($cxNew[$i+1]-$cxNew[$i],$czNew[$i+1]-$czNew[$i])
  $d=[math]::Abs($h2-$h1); if($d -gt [math]::PI){$d=2*[math]::PI-$d}
  if($d -gt $maxTurn){$maxTurn=$d;$maxTurnPos=$i*$step}
}
Write-Output ("max heading change per 5m: " + [math]::Round($maxTurn*180/[math]::PI,2) + " deg at pos=" + $maxTurnPos + "m (min radius ~" + [int]($step/$maxTurn) + "m)")

# ---------- 9. write back into TrackData.js (cx, cz, total, elevation, station positions) ----------
function NumArr($arr){ return "[" + (($arr | ForEach-Object {[math]::Round($_,2)}) -join ",") + "]" }
$cxStr=NumArr $cxNew; $czStr=NumArr $czNew
$out = $td
$out = [regex]::Replace($out,'cx:\s*\[[^\]]*\]', { param($m) "cx: $cxStr" })
$out = [regex]::Replace($out,'cz:\s*\[[^\]]*\]', { param($m) "cz: $czStr" })
$out = [regex]::Replace($out,'total:\s*[0-9.]+', "total: $totalNew")
$elevParts=@(); foreach($k in $newElev.Keys){ $elevParts += ($k + ":" + $newElev[$k]) }
$elevStr="elevation: {" + ($elevParts -join ", ") + "}"
$out = [regex]::Replace($out,'elevation:\s*\{[^}]*\}', { param($m) $elevStr })
foreach($s in $stations){
  $nameEsc=[regex]::Escape($s.name)
  $out = [regex]::Replace($out,('(name:"' + $nameEsc + '"[^\r\n]*?position:)[0-9.]+'), ('${1}' + $newPos[$s.name]))
}
[System.IO.File]::WriteAllText($tdPath, $out, $utf8)
Write-Output ("WROTE " + $tdPath + " (length " + $out.Length + ")")
Write-Output "NEXT STEP: run gen_tracks.ps1 to re-harvest gap[] and splice scratch/gap_js.txt into TrackData.js (UTF-8!)."
