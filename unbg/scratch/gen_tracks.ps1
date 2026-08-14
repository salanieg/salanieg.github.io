# Generator v3: each directional relation's LONGEST segment = that direction's
# running rail (~18.5km). Resample, Umeyama-fit to existing centerline, harvest
# per-track lateral offsets, smooth independently -> candidate gap[].
$ErrorActionPreference = 'Stop'
# force period as decimal separator (avoid German locale "10,34")
[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::InvariantCulture

# ---------- 1. Parse TrackData.js ----------
$td = Get-Content "src/simulator/TrackData.js" -Raw
function ParseArray($name){ $m=[regex]::Match($td,$name+':\s*\[([^\]]*)\]'); if(-not $m.Success){throw "no $name"}; return @($m.Groups[1].Value -split ',' | ForEach-Object {[double]$_}) }
$cx=ParseArray 'cx'; $cz=ParseArray 'cz'
$step=[double]([regex]::Match($td,'step:\s*([0-9.]+)').Groups[1].Value)
$N=$cx.Count
Write-Output ("centerline N=$N step=$step")
$stations=New-Object System.Collections.Generic.List[object]
foreach($line in ($td -split "`n")){ $mm=[regex]::Match($line,'name:"([^"]+)".*?position:([0-9.]+),halfLength:([0-9.]+),platformSpacing:([0-9.]+)'); if($mm.Success){$stations.Add([pscustomobject]@{name=$mm.Groups[1].Value;pos=[double]$mm.Groups[2].Value;hl=[double]$mm.Groups[3].Value;ps=[double]$mm.Groups[4].Value})} }

# ---------- 2. longest segment per relation -> running rail ----------
$raw=Get-Content "src/simulator/Daten.js" -Raw
$json=$raw.Substring($raw.IndexOf('{')).TrimEnd("`r","`n"," ",";")
$g=$json|ConvertFrom-Json
$lat0=49.44; $mLat=111320.0; $mLon=111320.0*[math]::Cos($lat0*[math]::PI/180.0)
function MainTrack($id){
  $feat=$null; foreach($f in $g.features){ if($f.properties.'@id' -eq $id){$feat=$f;break} }
  $bestX=$null;$bestY=$null;$bestN=0
  foreach($seg in $feat.geometry.coordinates){ if($seg.Count -gt $bestN){ $bestN=$seg.Count; $bestSeg=$seg } }
  # world frame is MIRRORED vs GPS projection -> negate Y (reflection)
  $xs=New-Object double[] $bestN; $ys=New-Object double[] $bestN
  for($i=0;$i -lt $bestN;$i++){ $xs[$i]=[double]$bestSeg[$i][0]*$mLon; $ys[$i]=-[double]$bestSeg[$i][1]*$mLat }
  return @{x=$xs;y=$ys}
}
$A=MainTrack 'relation/538906'   # Hardhoehe->Langwasser
$B=MainTrack 'relation/538907'   # Langwasser->Hardhoehe
Write-Output ("rail A pts=" + $A.x.Count + " B pts=" + $B.x.Count)

# ---------- 3. arc-length resample ----------
function Resample($poly,$NS){
  $x=$poly.x;$y=$poly.y;$n=$x.Count
  $cum=New-Object double[] $n;$cum[0]=0
  for($i=1;$i -lt $n;$i++){ $dx=$x[$i]-$x[$i-1];$dy=$y[$i]-$y[$i-1];$cum[$i]=$cum[$i-1]+[math]::Sqrt($dx*$dx+$dy*$dy) }
  $L=$cum[$n-1];$rx=New-Object double[] $NS;$ry=New-Object double[] $NS;$seg=0
  for($m=0;$m -lt $NS;$m++){ $t=$L*$m/($NS-1); while($seg -lt $n-2 -and $cum[$seg+1] -lt $t){$seg++}; $sl=$cum[$seg+1]-$cum[$seg]; if($sl -le 0){$sl=1}; $f=($t-$cum[$seg])/$sl; $rx[$m]=$x[$seg]+($x[$seg+1]-$x[$seg])*$f; $ry[$m]=$y[$seg]+($y[$seg+1]-$y[$seg])*$f }
  return @{x=$rx;y=$ry;L=$L}
}
$NS=400
$rA=Resample $A $NS; $rB=Resample $B $NS
Write-Output ("rail length A=" + [int]$rA.L + "m B=" + [int]$rB.L + "m  (route ~18525m)")

# centerline resampled to NS over the GPS EXTENT only.
# The GPS rails span from the FIRST station centre (Langwasser Süd) to the LAST station
# centre (Hardhöhe) — i.e. they start/end at the half of the terminus platforms, NOT at
# the padded centerline ends. So correspond GPS [0..1] to centerline arc [LWS.pos .. HH.pos]
# (= routeLength), otherwise the fit stretches by one platform and the terminus gaps are off.
$arcStart=$stations[0].pos; $arcEnd=$stations[$stations.Count-1].pos
$idxStart=$arcStart/$step; $idxEnd=$arcEnd/$step
Write-Output ("GPS extent -> centerline arc [" + [int]$arcStart + ".." + [int]$arcEnd + "]m (idx " + [math]::Round($idxStart,1) + ".." + [math]::Round($idxEnd,1) + ")")
$ccx=New-Object double[] $NS;$ccy=New-Object double[] $NS
for($m=0;$m -lt $NS;$m++){
  $fidx=$idxStart+($idxEnd-$idxStart)*$m/($NS-1)
  $i0=[int][math]::Floor($fidx); if($i0 -gt $N-2){$i0=$N-2}; $fr=$fidx-$i0
  $ccx[$m]=$cx[$i0]+($cx[$i0+1]-$cx[$i0])*$fr; $ccy[$m]=$cz[$i0]+($cz[$i0+1]-$cz[$i0])*$fr
}

# ---------- 4. Umeyama similarity (p->q) ----------
function Umeyama($px,$py,$qx,$qy,$n){
  $mpx=0;$mpy=0;$mqx=0;$mqy=0; for($i=0;$i -lt $n;$i++){$mpx+=$px[$i];$mpy+=$py[$i];$mqx+=$qx[$i];$mqy+=$qy[$i]}; $mpx/=$n;$mpy/=$n;$mqx/=$n;$mqy/=$n
  $Sxx=0;$Sxy=0;$varp=0
  for($i=0;$i -lt $n;$i++){ $pcx=$px[$i]-$mpx;$pcy=$py[$i]-$mpy;$qcx=$qx[$i]-$mqx;$qcy=$qy[$i]-$mqy; $Sxx+=$pcx*$qcx+$pcy*$qcy; $Sxy+=$pcx*$qcy-$pcy*$qcx; $varp+=$pcx*$pcx+$pcy*$pcy }
  $th=[math]::Atan2($Sxy,$Sxx); $ct=[math]::Cos($th);$st=[math]::Sin($th); $s=[math]::Sqrt($Sxx*$Sxx+$Sxy*$Sxy)/$varp
  $tx=$mqx-$s*($ct*$mpx-$st*$mpy);$ty=$mqy-$s*($st*$mpx+$ct*$mpy)
  return @{s=$s;ct=$ct;st=$st;tx=$tx;ty=$ty;th=$th}
}
function ResidRMS($T,$px,$py,$qx,$qy,$n){ $sum=0; for($i=0;$i -lt $n;$i++){ $wx=$T.tx+$T.s*($T.ct*$px[$i]-$T.st*$py[$i]);$wy=$T.ty+$T.s*($T.st*$px[$i]+$T.ct*$py[$i]); $sum+=($wx-$qx[$i])*($wx-$qx[$i])+($wy-$qy[$i])*($wy-$qy[$i]) } return [math]::Sqrt($sum/$n) }

# midline using B forward + A reversed (A is opposite direction to centerline)
$mlx=New-Object double[] $NS;$mly=New-Object double[] $NS
for($m=0;$m -lt $NS;$m++){ $j=$NS-1-$m; $mlx[$m]=($rB.x[$m]+$rA.x[$j])/2; $mly[$m]=($rB.y[$m]+$rA.y[$j])/2 }
# Transform: index-correspondence Umeyama (with reflection handled in projection).
# Arc length matches centerline to ~0.2%, so index correspondence aligns to ~16m RMS.
# gap is a DIFFERENCE of two offsets, so this common-mode drift cancels.
$T=Umeyama $mlx $mly $ccx $ccy $NS
$resid=ResidRMS $T $mlx $mly $ccx $ccy $NS
Write-Output ("fit scale=" + [math]::Round($T.s,5) + " rotDeg=" + [math]::Round($T.th*180/[math]::PI,2) + " residRMS=" + [math]::Round($resid,2) + "m")

# ---------- 5. transform rails to world ----------
function TXarr($poly){ $n=$poly.x.Count;$ox=New-Object double[] $n;$oy=New-Object double[] $n; for($i=0;$i -lt $n;$i++){ $ox[$i]=$T.tx+$T.s*($T.ct*$poly.x[$i]-$T.st*$poly.y[$i]); $oy[$i]=$T.ty+$T.s*($T.st*$poly.x[$i]+$T.ct*$poly.y[$i]) } return @{x=$ox;y=$oy} }
$Aw=TXarr $A; $Bw=TXarr $B

# ---------- 6. normals + harvest ----------
$nx=New-Object double[] $N;$ny=New-Object double[] $N
for($i=0;$i -lt $N;$i++){ $i0=[math]::Max(0,$i-1);$i1=[math]::Min($N-1,$i+1); $tx=$cx[$i1]-$cx[$i0];$ty=$cz[$i1]-$cz[$i0];$L=[math]::Sqrt($tx*$tx+$ty*$ty);if($L -eq 0){$L=1}; $nx[$i]=-$ty/$L;$ny[$i]=$tx/$L }
function Harvest($wx,$wy,$cnt,$ix){ $cxi=$cx[$ix];$czi=$cz[$ix];$nxi=$nx[$ix];$nyi=$ny[$ix];$best=[double]::MaxValue;$boff=0.0; for($j=0;$j -lt $cnt;$j++){ $dx=$wx[$j]-$cxi;$dy=$wy[$j]-$czi;$d2=$dx*$dx+$dy*$dy; if($d2 -lt $best){$best=$d2;$boff=$dx*$nxi+$dy*$nyi} } return @($boff,[math]::Sqrt($best)) }
$na=$Aw.x.Count;$nb=$Bw.x.Count
$offA=New-Object double[] $N;$offB=New-Object double[] $N;$miss=New-Object System.Collections.Generic.List[double]
$probe=2
for($i=0;$i -lt $N;$i+=$probe){ $ra=Harvest $Aw.x $Aw.y $na $i; $rb=Harvest $Bw.x $Bw.y $nb $i; $offA[$i]=$ra[0];$offB[$i]=$rb[0];$miss.Add([math]::Max($ra[1],$rb[1])) }
for($i=0;$i -lt $N;$i++){ if(($i%$probe)-ne 0){ $lo=$i-($i%$probe);$hi=[math]::Min($N-1,$lo+$probe);$den=$hi-$lo;if($den -eq 0){$den=1};$f=($i-$lo)/$den; $offA[$i]=$offA[$lo]+($offA[$hi]-$offA[$lo])*$f; $offB[$i]=$offB[$lo]+($offB[$hi]-$offB[$lo])*$f } }
$ms=@($miss|Sort-Object)
Write-Output ("harvest cross-section miss median=" + [math]::Round($ms[[int]($ms.Count/2)],2) + "m p90=" + [math]::Round($ms[[int]($ms.Count*0.9)],2) + "m max=" + [math]::Round($ms[$ms.Count-1],2) + "m")

# ---------- 7. median pre-filter (kills siding spikes) + smooth + gap ----------
function Median($arr,$w){ $n=$arr.Count;$o=New-Object double[] $n; for($i=0;$i -lt $n;$i++){ $lo=[math]::Max(0,$i-$w);$hi=[math]::Min($n-1,$i+$w); $win=@(); for($j=$lo;$j -le $hi;$j++){$win+=$arr[$j]}; $win=@($win|Sort-Object); $o[$i]=$win[[int]($win.Count/2)] } return $o }
function Smooth($arr,$passes,$w){ $a=@($arr.Clone()); for($p=0;$p -lt $passes;$p++){ $b=@($a.Clone()); for($i=0;$i -lt $a.Count;$i++){ $s=0.0;$wt=0.0; for($k=-$w;$k -le $w;$k++){$j=$i+$k;if($j -ge 0 -and $j -lt $a.Count){$s+=$b[$j];$wt++}} $a[$i]=$s/$wt } } return $a }
$offA=Median $offA 5; $offB=Median $offB 5
$offAs=Smooth $offA 3 4; $offBs=Smooth $offB 3 4
$gapNew=New-Object double[] $N; for($i=0;$i -lt $N;$i++){ $gapNew[$i]=[math]::Abs($offAs[$i]-$offBs[$i]) }

# ---------- 8. snap remaining station outliers (sidings) to validated prior ----------
function Smoothstep($t){ if($t -lt 0){$t=0}; if($t -gt 1){$t=1}; return $t*$t*(3-2*$t) }
foreach($s in $stations){
  $idx=[int][math]::Round($s.pos/$step); if($idx -lt 0){$idx=0}; if($idx -ge $N){$idx=$N-1}
  if([math]::Abs($gapNew[$idx]-$s.ps) -gt 4){
    $half=[int][math]::Round($s.hl/$step); $tr=[int][math]::Round(50/$step)
    $loE=[math]::Max(0,$idx-$half-$tr); $hiE=[math]::Min($N-1,$idx+$half+$tr)
    $baseLo=$gapNew[$loE]; $baseHi=$gapNew[$hiE]
    for($k=$loE;$k -le $hiE;$k++){
      if($k -ge $idx-$half -and $k -le $idx+$half){ $gapNew[$k]=$s.ps }
      elseif($k -lt $idx-$half){ $t=Smoothstep (($k-$loE)/$tr); $gapNew[$k]=$baseLo+($s.ps-$baseLo)*$t }
      else { $t=Smoothstep (($hiE-$k)/$tr); $gapNew[$k]=$baseHi+($s.ps-$baseHi)*$t }
    }
    Write-Output ("  snapped outlier " + $s.name + " -> " + $s.ps + "m (was siding-contaminated)")
  }
}

Write-Output "=== STATION gap new(harvested,cleaned) vs old(platformSpacing) ==="
foreach($s in $stations){ $idx=[int][math]::Round($s.pos/$step);if($idx -lt 0){$idx=0};if($idx -ge $N){$idx=$N-1}; $gn=[math]::Round($gapNew[$idx],2); Write-Output (("{0,-20} old={1,6} new={2,6} diff={3,7}") -f $s.name,$s.ps,$gn,[math]::Round($gn-$s.ps,2)) }
$gs=@($gapNew|Sort-Object)
Write-Output ("gapNew min=" + [math]::Round($gs[0],2) + " median=" + [math]::Round($gs[[int]($N/2)],2) + " p90=" + [math]::Round($gs[[int]($N*0.9)],2) + " max=" + [math]::Round($gs[$N-1],2))
# ---------- 9. emit JS gap array ----------
$js = "[" + (($gapNew | ForEach-Object {[math]::Round($_,2)}) -join ",") + "]"
$js | Out-File "scratch/gap_js.txt" -Encoding ascii
Write-Output ("wrote scratch/gap_js.txt  (" + $gapNew.Count + " values)")