const express = require('express');
const { createServer } = require('node:http');
const { SerialPort } = require('serialport');
const { Server } = require('socket.io');

const app = express();
const PORT = process.env.PORT || 3000;
const BAUD_RATE = 115200;
const serialPortPath = process.env.SERIAL_PORT || '/dev/cu.usbmodem1101';
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5500', 'http://127.0.0.1:5500']
  }
});
let serialStatus = 'ESP32-Port wird gesucht';
let reconnectTimer;
let hasReceivedSensorData = false;
let sensorSampleId = 0;

app.use(express.static('./'));

function setSerialStatus(message) {
  serialStatus = message;
  console.log(message);
  io.emit('serialStatus', serialStatus);
}

io.on('connection', (socket) => {
  socket.emit('serialStatus', serialStatus);
});

function retrySerialConnection() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connectSerialPort();
  }, 2000);
}

function connectSerialPort() {
  const path = serialPortPath;

  if (!path) {
    setSerialStatus('ESP32-Port nicht gefunden');
    return;
  }

  const serialPort = new SerialPort({ path, baudRate: BAUD_RATE });
  let serialBuffer = '';

  serialPort.on('open', () => setSerialStatus(`ESP32 verbunden: ${path} - warte auf Sensordaten`));
  serialPort.on('error', (error) => {
    setSerialStatus(`ESP32-Port belegt oder getrennt - neuer Versuch laeuft`);
    console.error(`ESP32-Fehler: ${error.message}`);
    retrySerialConnection();
  });
  serialPort.on('close', () => {
    setSerialStatus('ESP32-Verbindung getrennt - neuer Versuch laeuft');
    retrySerialConnection();
  });
  serialPort.on('data', (chunk) => {
    serialBuffer += chunk.toString('utf8');
    const lines = serialBuffer.split(/\r?\n/);
    serialBuffer = lines.pop() || '';

    for (const line of lines) {
      handleSensorLine(line);
    }
  });
}

// Zeitpunkt, an dem der naechste abgeleitete Herzschlag faellig ist (siehe deriveBeat).
let nextDerivedBeatAt = 0;

// Ersatz-Herzschlag fuer Geraete, die keinen eigenen melden.
//
// Die aktuell aufgespielte ESP32-Firmware sendet nur fuenf Werte (BPM, SpO2, X, Y, Z) und
// kein sechstes Feld fuer den Schlag - gemessen ueber 137 Zeilen am seriellen Port, alle
// mit genau fuenf Feldern. Vorher fiel das nicht auf, weil beim Zerlegen der Zeile ein
// fehlendes sechstes Feld stillschweigend zu 0 wurde: Es sah aus, als melde das Geraet
// dauerhaft "kein Schlag". Alles, was am Herzschlag haengt, blieb dadurch stumm.
//
// Solange kein echter Schlag gemeldet wird, wird hier stattdessen aus der gemeldeten
// Pulsrate einer erzeugt: alle 60000/BPM Millisekunden genau einer. Das ist bewusst ein
// Notbehelf - der Takt stimmt, der einzelne Schlag ist aber errechnet und nicht gemessen.
// Sobald eine Firmware das sechste Feld liefert, wird diese Funktion nicht mehr aufgerufen.
function deriveBeat(bpm, now) {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    return 0;
  }
  if (nextDerivedBeatAt === 0) {
    nextDerivedBeatAt = now;
  }
  if (now < nextDerivedBeatAt) {
    return 0;
  }
  // Vom Faelligkeitszeitpunkt aus weiterzaehlen, nicht von jetzt - sonst wuerde sich der
  // Takt bei jedem Mal um die Verzoegerung des Messintervalls nach hinten verschieben.
  nextDerivedBeatAt = Math.max(nextDerivedBeatAt + 60000 / bpm, now);
  return 1;
}

function handleSensorLine(line) {
  const fields = line.trim().split(',');
  const [bpm, spo2, accelX, accelY, accelZ] = fields.map(Number);
  const beat = fields.length >= 6 ? Number(fields[5]) : deriveBeat(bpm, Date.now());

  if (![bpm, spo2, accelX, accelY, accelZ, beat].every(Number.isFinite) || (beat !== 0 && beat !== 1)) {
      console.warn(`Ungueltige ESP32-Zeile ignoriert: ${line.trim()}`);
      return;
    }

    if (!hasReceivedSensorData) {
      hasReceivedSensorData = true;
      console.log('ESP32-Sensordaten werden empfangen');
    }

    sensorSampleId += 1;
    io.emit('sensorData', { bpm, spo2, accelX, accelY, accelZ, beat, sampleId: sensorSampleId });
}

connectSerialPort();

httpServer.listen(PORT, () => {
  console.log(`Server laeuft auf http://localhost:${PORT}`);
});