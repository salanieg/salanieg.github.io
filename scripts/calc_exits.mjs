const R = 24.0;
const SATELLITE_ROOMS = [
    { name: 'Arbeit', cx: 0.0, cz: -16.5 },
    { name: 'Kunst', cx: 15.692, cz: -5.099 },
    { name: 'Chillen', cx: 9.698, cz: 13.349 },
    { name: 'Gaming', cx: -9.698, cz: 13.349 },
    { name: 'Lager', cx: -15.692, cz: -5.099 }
];

const roomAngles = SATELLITE_ROOMS.map(r => {
    let a = Math.atan2(r.cz, r.cx);
    if (a < 0) a += 2 * Math.PI;
    return { name: r.name, rad: a, deg: a * 180 / Math.PI };
});
roomAngles.sort((a, b) => a.rad - b.rad);
console.log('Room angles (sorted 0 to 360 deg):');
roomAngles.forEach(r => console.log(' ', r.name, r.deg.toFixed(1) + ' deg', r.rad.toFixed(4) + ' rad'));

console.log('\nExits between adjacent rooms:');
for (let i = 0; i < 5; i++) {
    const rA = roomAngles[i];
    const rB = roomAngles[(i + 1) % 5];
    let diff = rB.rad - rA.rad;
    if (diff < 0) diff += 2 * Math.PI;
    let mid = rA.rad + diff / 2;
    if (mid >= 2 * Math.PI) mid -= 2 * Math.PI;
    const x = R * Math.cos(mid);
    const z = R * Math.sin(mid);
    console.log(` Exit ${i} between ${rA.name} & ${rB.name}: ${(mid * 180 / Math.PI).toFixed(1)} deg (${mid.toFixed(4)} rad) -> x: ${x.toFixed(2)}, z: ${z.toFixed(2)}`);
}
