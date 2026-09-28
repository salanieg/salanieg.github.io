const SATELLITE_ROOMS = [
    { name: "Arbeit", cx: 0.0, cz: -16.5, radius: 5.5 },
    { name: "Kunst", cx: 15.692, cz: -5.099, radius: 5.5 },
    { name: "Chillen", cx: 9.698, cz: 13.349, radius: 5.5 },
    { name: "Gaming", cx: -9.698, cz: 13.349, radius: 5.5 },
    { name: "Lager", cx: -15.692, cz: -5.099, radius: 5.5 }
];

const COURTYARD_RADIUS = 24.0;

console.log("=== Satellite Rooms & Gaps ===");
const roomData = SATELLITE_ROOMS.map(r => {
    const ang = Math.atan2(r.cz, r.cx); // standard angle in radians
    const deg = (ang * 180 / Math.PI);
    return { name: r.name, cx: r.cx, cz: r.cz, ang, deg };
});

roomData.forEach((r, i) => {
    console.log(`${r.name}: angle = ${r.deg.toFixed(1)}° (${r.ang.toFixed(4)} rad)`);
});

// The rooms are ordered:
// 0: Arbeit (-90° / 270°)
// 1: Kunst (-18° / 342°)
// 2: Chillen (+54°)
// 3: Gaming (+126°)
// 4: Lager (+198° / -162°)

// Let's sort them in counter-clockwise order from 0 to 2pi (or -pi to +pi):
// In order around circle:
// 1: Kunst (-18° = 342° or -0.314)
// 2: Chillen (54° or 0.942)
// 3: Gaming (126° or 2.199)
// 4: Lager (198° or 3.456)
// 0: Arbeit (270° = -90° or 4.712)

const order = [
    { name: "Kunst", deg: 342, rad: 342 * Math.PI / 180 },
    { name: "Chillen", deg: 54, rad: 54 * Math.PI / 180 },
    { name: "Gaming", deg: 126, rad: 126 * Math.PI / 180 },
    { name: "Lager", deg: 198, rad: 198 * Math.PI / 180 },
    { name: "Arbeit", deg: 270, rad: 270 * Math.PI / 180 }
];

console.log("\n=== 5 Midpoints (Gap Angles) ===");
for (let i = 0; i < 5; i++) {
    const r1 = order[i];
    const r2 = order[(i + 1) % 5];
    let d1 = r1.deg;
    let d2 = r2.deg;
    if (d2 < d1) d2 += 360;
    const midDeg = ((d1 + d2) / 2) % 360;
    const midRad = (midDeg * Math.PI / 180);
    // Normalized to [-pi, pi]:
    const normRad = midRad > Math.PI ? midRad - 2 * Math.PI : midRad;
    const x = Math.cos(normRad) * COURTYARD_RADIUS;
    const z = Math.sin(normRad) * COURTYARD_RADIUS;
    console.log(`Gap ${i} (between ${r1.name} and ${r2.name}): ${midDeg.toFixed(1)}° (${normRad.toFixed(4)} rad) -> x: ${x.toFixed(2)}, z: ${z.toFixed(2)}`);
}
