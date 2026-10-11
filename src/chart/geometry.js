// Sensor geometry for the screen. Buttons 1-8 sit at 22.5 + 45*(n-1) degrees
// clockwise from the top, and so do the A and B sensors of the same number.
// D and E sensors sit at 45*(n-1) degrees (D1/E1 at the top), so D_n and E_n
// lie between A_(n-1) and A_n. (Measured sensor map, confirmed with the user:
// E5 borders A4 and A5, E6 borders A5 and A6.)

const wrap = (n) => ((((n - 1) % 8) + 8) % 8) + 1;

/**
 * Button positions whose A sensor `sensor` could switch on by accident, with
 * how close it is: 0 = the sensor is that button's own A sensor, 1 = shares a
 * border with it. C has no neighbours worth flagging.
 */
function neighbouringButtons(sensor, number) {
    switch (sensor) {
        case 'A':
            return [
                { button: number, closeness: 0 },
                { button: wrap(number - 1), closeness: 1 },
                { button: wrap(number + 1), closeness: 1 },
            ];
        case 'B':
            return [{ button: number, closeness: 1 }];
        case 'D':
        case 'E':
            return [
                { button: wrap(number - 1), closeness: 1 },
                { button: number, closeness: 1 },
            ];
        default:
            return [];
    }
}

/** Ring distance between two button positions, 0-4. */
function ringDistance(a, b) {
    const d = Math.abs(a - b) % 8;
    return Math.min(d, 8 - d);
}

const sensorName = (e) => (e.sensor === 'C' ? 'C' : `${e.sensor}${e.number}`);

module.exports = { wrap, neighbouringButtons, ringDistance, sensorName };
