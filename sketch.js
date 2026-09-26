let socket;

let bpm = 0;
let spo2 = 0;
let accelX = 0;
let accelY = 0;
let accelZ = 0;

let normalizedBpm = 0;
let normalizedSpo2 = 0;
let motionAmount = 0;
let beatPulse = 0;
let lastBeatMillis = 0;
let lastSensorMillis = 0;
let serialStatus = 'Serial: nicht verbunden';
let beatOscillator;
let lowOxygenOscillator;
let beatEnvelope;
let lowOxygenEnvelope;
let soundAvailable = false;
let soundUnlocked = false;

const BPM_MIN = 45;
const BPM_MAX = 140;
const SPO2_MIN = 88;
const SPO2_MAX = 100;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Sound Engine — p5.sound Oscillator Synthesis
// Herzschlag-Töne generativ, keine externen Audiodateien
function initializeSoundEngine() {
  if (typeof p5 === 'undefined' || typeof p5.Oscillator !== 'function' || typeof p5.Envelope !== 'function') {
    return;
  }

  try {
    beatOscillator = new p5.Oscillator('sine');
    lowOxygenOscillator = new p5.Oscillator('triangle');
    beatEnvelope = new p5.Envelope();
    lowOxygenEnvelope = new p5.Envelope();
    beatEnvelope.setADSR(0.02, 0.05, 0, 0.33);
    lowOxygenEnvelope.setADSR(0.02, 0.04, 0, 0.36);
    beatOscillator.amp(0);
    lowOxygenOscillator.amp(0);
    beatOscillator.start();
    lowOxygenOscillator.start();
    soundAvailable = true;
  } catch (error) {
    soundAvailable = false;
  }
}

function resumeSoundEngine() {
  if (!soundAvailable) {
    return;
  }

  try {
    const context = typeof getAudioContext === 'function' ? getAudioContext() : null;
    if (!context) {
      return;
    }

    const resumeResult = context.resume();
    if (resumeResult && typeof resumeResult.then === 'function') {
      resumeResult.then(() => {
        soundUnlocked = context.state === 'running';
      }).catch(() => {});
    } else {
      soundUnlocked = context.state === 'running';
    }
  } catch (error) {
    soundUnlocked = false;
  }
}

function playBeatSound() {
  if (!soundAvailable || !beatOscillator || !beatEnvelope) {
    return;
  }

  try {
    const context = typeof getAudioContext === 'function' ? getAudioContext() : null;
    if (!soundUnlocked && context && context.state === 'running') {
      soundUnlocked = true;
    }
    if (!soundUnlocked) {
      return;
    }

    const tones = [55, 65, 82, 98, 110, 130];
    const toneIndex = (collectiveStarCount + floor(normalizedBpm * tones.length)) % tones.length;
    const tone = tones[toneIndex] * (1 + normalizedBpm * 0.16);
    beatOscillator.freq(tone, 0.02);
    beatEnvelope.setADSR(0.02, 0.05, 0, 0.33);
    beatEnvelope.setRange(0.028 + normalizedBpm * 0.052, 0);
    beatEnvelope.play(beatOscillator);

    if (spo2 < 94 && lowOxygenOscillator && lowOxygenEnvelope) {
      lowOxygenOscillator.freq(tone * 0.742, 0.02);
      lowOxygenEnvelope.setADSR(0.02, 0.04, 0, 0.36);
      lowOxygenEnvelope.setRange(0.012 + normalizedBpm * 0.022, 0);
      lowOxygenEnvelope.play(lowOxygenOscillator);
    }
  } catch (error) {
    soundUnlocked = false;
  }
}

function setupUi() {
  const connectButton = document.getElementById('connectButton');
  const saveButton = document.getElementById('saveButton');

  if (connectButton) {
    // Kein Text mehr - der Button selbst IST der Status: gruen = verbunden, rot = nicht
    connectButton.textContent = '';
    connectButton.setAttribute('aria-label', 'Verbinden');
    connectButton.style.width = '14px';
    connectButton.style.height = '14px';
    connectButton.style.minWidth = '14px';
    connectButton.style.borderRadius = '50%';
    connectButton.style.border = 'none';
    connectButton.style.padding = '0';
    connectButton.style.cursor = 'pointer';
    connectButton.style.backgroundColor = '#e74c3c';
    connectButton.addEventListener('click', () => {
      resumeSoundEngine();
      connectSocket();
    });
  }

  if (saveButton) {
    // Reines weisses Linien-Icon, kein Text
    saveButton.textContent = '';
    saveButton.setAttribute('aria-label', 'Bild speichern');
    saveButton.style.background = 'transparent';
    saveButton.style.border = 'none';
    saveButton.style.padding = '0';
    saveButton.style.cursor = 'pointer';
    saveButton.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>';
    saveButton.addEventListener('click', saveCurrentFrame);
  }

  // Das alte Text-Statusfeld wird nicht mehr gebraucht - der Connect-Button uebernimmt
  // diese Rolle jetzt selbst (siehe updateConnectionDot)
  const oldStatusField = document.getElementById('serialStatus');
  if (oldStatusField) {
    oldStatusField.style.display = 'none';
    oldStatusField.textContent = '';
  }

  // Zusaetzlich: falls der beschreibende Text ("Der Server liest ...") in einem anderen,
  // uns unbekannten Element steht (z.B. direkt im HTML oder von server.js woanders
  // eingefuegt), suchen wir ihn per Textinhalt und blenden ihn aus - auch wiederholt,
  // falls er erst spaeter (z.B. nach Verbindungsaufbau) eingefuegt wird.
  hideLegacyStatusText();
  setInterval(hideLegacyStatusText, 1000);
}

function hideLegacyStatusText() {
  try {
    const result = document.evaluate(
      "//*[contains(text(),'Der Server liest') or contains(text(),'ESP32 verbunden')]",
      document,
      null,
      XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    for (let i = 0; i < result.snapshotLength; i += 1) {
      const node = result.snapshotItem(i);
      node.style.display = 'none';
      node.textContent = '';
    }
  } catch (error) {
    // stiller Fallback, falls XPath im Browser nicht verfuegbar ist
  }
}

function connectSocket() {
  if (!socket) {
    socket = io('http://localhost:3000');
    socket.on('connect', () => setStatus('Server verbunden - Portstatus wird geladen'));
    socket.on('disconnect', () => setStatus('Server: Verbindung getrennt'));
    socket.on('connect_error', (error) => setStatus(`Server-Fehler: ${error.message}`));
    socket.on('serialStatus', setStatus);
    socket.on('sensorData', handleSensorData);
    return;
  }

  if (socket.connected) {
    setStatus('Server verbunden - ESP32-Port wird geprueft');
  } else {
    socket.connect();
  }
}

function saveCurrentFrame() {
  saveCanvas(`biorhythm-collective-${Date.now()}`, 'png');
}

function keyPressed() {
  if (key === 's' || key === 'S') {
    saveCurrentFrame();
  }
  if (key === 'd' || key === 'D') {
    toggleDemoMode();
  }
}

function setStatus(message) {
  // Nur noch intern gespeichert - im UI zeigt der Connect-Button selbst den Status
  // als reine Farbe an (siehe updateConnectionDot())
  serialStatus = message;
}

let lastConnectionDotState = null;

function updateConnectionDot() {
  const isLive = getConnectionLabel() === 'LIVE';
  if (isLive === lastConnectionDotState) {
    return;
  }
  lastConnectionDotState = isLive;

  const connectButton = document.getElementById('connectButton');
  if (!connectButton) {
    return;
  }
  connectButton.style.backgroundColor = isLive ? '#2ecc71' : '#e74c3c';
  connectButton.style.boxShadow = isLive ? '0 0 6px #2ecc71' : '0 0 6px #e74c3c';
}

let eclipseStarLayers = [];
let neuralFilaments = [];
let floatingDebris = [];
let agentTrailLayer;
let postProcessLayer;
let collectiveStarCount = 0;
let breathPulse = 0;
let eclipseRadius = 0;
let cameraOffsetX = 0;
let cameraOffsetY = 0;
let sceneTiltX = 0;
let sceneTiltY = 0;
let preBeatPulse = 0;
let glitchUntil = 0;
let nextGlitchAt = 0;


const ECLIPSE_ACCEL_REFERENCE = 1800;
const ECLIPSE_BEAT_DECAY_MS = 720;
const ECLIPSE_STAR_FIELD_CYCLE = 480;
const ECLIPSE_GRAIN_COUNT = 340;
const ECLIPSE_SEED = 41873;
const MOTION_GRID_CELL_SIZE = 76;
const MOTION_GRID_SEED_OFFSET = 900.5;
const MOVEMENT_MAP_ACCEL_REFERENCE = 260;
// ---- Farbsteuerung: mitwachsende Spanne statt festem Nullpunkt ----
//
// Die Farbe soll sich leicht wechseln lassen, egal wie das Geraet gerade liegt. Zwei
// Ansaetze davor sind daran gescheitert:
//
// Erst ging die Skala von accelX = 0 als Mitte aus. Der Sensor ruht aber je nach Lage bei
// -240 oder +213, also weit ausserhalb des Bezugswerts - die Farbe klebte dauerhaft an
// einem Ende fest. Danach wurde die Ruhelage aus den ersten Messungen eingelernt. Auch das
// ging schief: Daten fliessen erst, wenn ein Finger auf dem Sensor liegt, also genau
// waehrend man ihn noch in der Hand haelt und anlegt. Legt man ihn danach hin, springt
// accelX um ein Vielfaches des Bezugswerts, und die Skala haengt wieder fest - sichtbar als
// "momentan nur rot die meiste Zeit".
//
// Jetzt gibt es gar keinen festen Bezugspunkt mehr. Stattdessen merkt sich die Arbeit, wie
// weit du den Sensor tatsaechlich bewegst, und legt die Palette genau auf diese Spanne:
// deine am weitesten links erreichte Lage wird Blau, die am weitesten rechts wird Rot. Die
// Kalibrierung passiert dadurch beilaeufig beim Benutzen, ein richtiger Zeitpunkt dafuer ist
// nicht mehr noetig.
//
// Die Spanne weitet sich sofort, zieht sich aber nur sehr langsam wieder zusammen. Eine
// gehaltene Farbe bleibt deshalb minutenlang stehen, waehrend ein einmaliger extremer
// Ausschlag seinen Einfluss nach und nach verliert - sonst wuerde ein einziges starkes
// Kippen die Spanne fuer den Rest der Ausstellung aufblaehen und alles danach in der Mitte
// zusammendraengen.
const COLOR_RANGE_MIN_SPAN = 100;
const COLOR_RANGE_DECAY = 0.0015;
// Welcher Anteil der beobachteten Spanne tatsaechlich fuer die Palette benutzt wird. Was
// darueber hinausgeht, bleibt bei der jeweiligen Endfarbe stehen.
//
// Mit 0.45 liegt die ganze Palette in der halben Bewegungsstrecke - das war der Wunsch, weil
// das Kabel zwischen ESP32 und Rechner den Radius stark begrenzt. Der Preis dafuer sind
// groessere geklemmte Randbereiche: Rund 55 Prozent der Spanne liegen ausserhalb des
// Fensters und zeigen dauerhaft die jeweilige Endfarbe. Deshalb muessen genau die beiden
// Farben an den Enden stehen, die man ohnehin haben will (Blau und Rot), und die mittlere
// Farbe braucht ein besonders breites Plateau, um gegen diesen Randbonus anzukommen - siehe
// COLOR_HUE_STOPS.
const COLOR_RANGE_USE = 0.45;
const colorRangeX = { min: undefined, max: undefined };
const colorRangeY = { min: undefined, max: undefined };

// Farbton-Verlauf mit Plateaus auf Rot, Gruen und Blau.
//
// Bei einer geraden Skala ist jede dieser drei Farben nur ein einziger Punkt. Wer den Sensor
// an einem kurzen Kabel fuehrt, trifft so einen Punkt kaum und landet fast immer in einem
// Zwischenton. Deshalb liegt auf jeder der drei ein breiter Bereich, in dem sich der Ton gar
// nicht mehr aendert - dazwischen wird schnell durchgeblendet. Man rastet gewissermassen
// ein, statt genau treffen zu muessen.
//
// Blau steht bewusst ganz aussen links und Rot ganz aussen rechts: Bei halbierter Strecke
// (siehe COLOR_RANGE_USE) liegen rund 55 Prozent der Bewegung in den geklemmten
// Randbereichen, und die zeigen immer den Ton an Position 0 beziehungsweise 1. Gemessen an
// einer realistischen Armbewegung ergibt diese Aufteilung Rot 34%, Gruen 30%, Blau 27%.
//
// Lila ist dabei herausgefallen. Es laesst sich nur am aeusseren Rand unterbringen, und dort
// schluckt es den kompletten linken Randbereich - gemessen 22% Lila, waehrend Blau auf 7%
// einbrach. Bei halber Strecke ist beides zusammen nicht zu haben.
//
// Je Eintrag: Anteil des Weges (0 bis 1) und der Farbton dort. Zwei Eintraege mit demselben
// Ton bilden ein Plateau.
const COLOR_HUE_STOPS = [
  [0.00, 240], [0.14, 240],   // Blau, faengt zusaetzlich den linken Randbereich auf
  [0.24, 120], [0.76, 120],   // Gruen, breites Plateau in der Mitte
  [0.86, 0], [1.00, 0]        // Rot, faengt den rechten Randbereich auf
];

function getHueForProgress(progress) {
  for (let index = 1; index < COLOR_HUE_STOPS.length; index += 1) {
    const [beforeProgress, beforeHue] = COLOR_HUE_STOPS[index - 1];
    const [afterProgress, afterHue] = COLOR_HUE_STOPS[index];
    if (progress <= afterProgress) {
      if (afterProgress === beforeProgress) {
        return afterHue;
      }
      return lerp(beforeHue, afterHue, (progress - beforeProgress) / (afterProgress - beforeProgress));
    }
  }
  return COLOR_HUE_STOPS[COLOR_HUE_STOPS.length - 1][1];
}

// Nimmt den neuen Messwert in die Spanne auf und gibt zurueck, wo er darin liegt (0 bis 1).
function updateColorRange(range, value) {
  if (range.min === undefined) {
    range.min = value;
    range.max = value;
  }

  range.min = min(range.min, value);
  range.max = max(range.max, value);

  const center = (range.min + range.max) * 0.5;
  range.min = lerp(range.min, center, COLOR_RANGE_DECAY);
  range.max = lerp(range.max, center, COLOR_RANGE_DECAY);

  // Mindestspanne: Liegt der Sensor eine Weile still, zoegen sich min und max sonst auf
  // denselben Wert zusammen, und schon das Rauschen von wenigen Zaehlern wuerde die ganze
  // Palette durchlaufen lassen.
  //
  // Sie gilt NUR fuer diese Auswertung und wird bewusst nicht in die gespeicherte Spanne
  // zurueckgeschrieben. Sonst bliebe die Polsterung der allerersten Messung fuer immer
  // erhalten und wuerde eine Seite dauerhaft zu weit aufziehen: Nach einer Bewegung von
  // -340 bis -140 stand die Spanne bei -411 bis -140, und die linke Endlage ergab dadurch
  // Tuerkis statt Blau.
  let low = range.min;
  let high = range.max;
  if (high - low < COLOR_RANGE_MIN_SPAN) {
    low = center - COLOR_RANGE_MIN_SPAN * 0.5;
    high = center + COLOR_RANGE_MIN_SPAN * 0.5;
  }

  // Nur den mittleren Ausschnitt benutzen - siehe COLOR_RANGE_USE.
  const usedHalf = (high - low) * 0.5 * COLOR_RANGE_USE;
  const usedCenter = (low + high) * 0.5;

  return constrain(map(value, usedCenter - usedHalf, usedCenter + usedHalf, 0, 1), 0, 1);
}
const MOVEMENT_MAP_REACH = 0.34;
const MOVEMENT_MARKER_RADIUS = 2.2;
const AGENT_COUNT = 350;
const FLOW_AGENT_GLOW_DURATION_MS = 320;
const GROWTH_MAX_CIRCLES = 320;
const GROWTH_MIN_RADIUS = 1.6;
const GROWTH_MAX_RADIUS = 5.5;
const DEMO_SAMPLE_INTERVAL_MS = 500;
const FOCAL_LENGTH = 800;
const NEURAL_FILAMENT_COUNT = 8;
const NEURAL_FILAMENT_SEGMENTS = 14;
const NEURAL_FILAMENT_GROWTH_PER_MS = 0.000009;
// Harte Obergrenze fuer gleichzeitig aktive Plasmawellen (4 neue pro Herzschlag). Ohne
// diese Grenze konnten sich bei hoher Herzschlagrate oder in der ersten Session-Zeit
// (wo Wellen laut getSessionGrowth() bewusst langsamer wachsen) deutlich mehr Wellen
// ansammeln als pro Frame abgebaut werden - jede aktive Welle berechnet ihre Kontur mit
// vielen noise()-Aufrufen, mehrere hundert gleichzeitig aktive Wellen wurden zum mit
// Abstand groessten Performance-Kostenpunkt der gesamten Anwendung ("sehr laggy").
const ECLIPSE_WAVE_MAX = 18;
const NEURAL_ARC_LIFESPAN_MS = 220;

const eclipseWaves = [];
const flowAgents = [];
const growthCircles = [];
const jumpWalkers = [];
const diffusionNodes = [];
// Dauerhafte Historie ALLER je erzeugten Diffusionsknoten - wird NIE geleert, dient
// ausschliesslich der Wachstumsberechnung (naechstgelegener Punkt), damit das Astwerk
// seinen strukturellen Bezug zur Herz-Kugel nie verliert, auch wenn die aktive
// Render-Liste (diffusionNodes) aus Performance-Gruenden regelmaessig geleert wird.
const diffusionNodeHistory = [];
// Sieben voneinander UNABHAENGIGE Aeste, die je an einem eigenen Startpunkt auf der
// Herz-Kugel haengen. Jeder Ast fuehrt seine eigene Wachstumsfront und lagert neue Knoten
// ausschliesslich an seine EIGENEN Knoten an - er "kennt" die anderen Aeste nicht.
// Vorher gab es genau eine globale Front, in der alle Richtungen um dieselben
// Anlagerungspunkte konkurrierten; dadurch vermischte sich das Wachstum und verband sich
// mit der Zeit zu einer zusammenhaengenden Masse, statt erkennbare Aeste zu bilden. Mit
// getrennten Fronten ist das strukturell ausgeschlossen. In der Front stehen nur Knoten mit
// noch freier Nachbarschaft; wer wiederholt keinen Platz mehr findet, scheidet aus, sodass
// sich das Wachstum jedes Astes von selbst nach aussen verlagert.
const DIFFUSION_BRANCH_COUNT = 7;
// Zusaetzlicher Abstand zwischen zwei aufeinanderfolgenden Knoten eines Zweiges. Ohne ihn
// beruehren sich die Knoten und verschmelzen optisch zu dichten Klumpen.
const DIFFUSION_NODE_SPACING = 4;
// Ein Knoten entsteht erst nach so vielen Sternen.
const DIFFUSION_STARS_PER_NODE = 3;
let starsSinceDiffusionNode = 0;
// Alle so viele Sterne beginnt eine neue Wachstums-Generation: an der freiesten Stelle
// jedes Astes entsteht ein Planet, von dem aus frisch weitergewachsen wird (siehe
// startDiffusionGeneration).
const DIFFUSION_GENERATION_EVERY_STARS = 300;
// Umkreis, in dem measureFreeSpace() nach Nachbarn sucht. Etwa drei Knotenabstaende: gross
// genug, dass eine wirklich eingeschlossene Stelle auffaellt, klein genug, dass eine
// einzelne freie Lichtung im Geaest noch als frei erkannt wird.
const DIFFUSION_FREE_SPACE_RADIUS = 70;
const diffusionBranches = [];
const neuralEnergyArcs = [];
let lastAgentLaunchBpm = 0;
let growthLayer;
let walkerLayer;
let demoMode = false;
let demoTimer;
let demoSampleId = 0;
let demoNextBeatAt = 0;

function setup() {
  pixelDensity(min(displayDensity(), 1.2)); // Fluessigkeit hat gerade Prioritaet vor maximaler Schaerfe
  createCanvas(windowWidth, windowHeight);
  colorMode(RGB, 255, 255, 255, 255);
  noiseDetail(3, 0.52);
  noiseSeed(ECLIPSE_SEED);
  initializeSoundEngine();
  createEclipseStarLayers();
  createGrowthLayer();
  createAgentTrailLayer();
  createWalkerLayer();
  createPostProcessLayer();
  for (let i = 0; i < AGENT_COUNT; i += 1) {
    flowAgents.push(new FlowAgent());
  }
  // P_2_2_1_02 gleich zum Start, und zwar an ZWEI Stellen links und rechts der Herz-Kugel.
  // An jeder gluehen 42 Walker gleichzeitig auf, ihre Leuchtkreise verschmelzen zu einem
  // hellen Punkt, und an beiden Stellen bleibt dieser Punkt danach als Markierung stehen.
  // Vorher entstand der erste solche Punkt erst nach 200 Sternen, also nach ein paar
  // Minuten - der Moment fehlte am Anfang der Arbeit vollstaendig.
  const startBurstOffset = min(width, height) * 0.27;
  for (const side of [-1, 1]) {
    const burstX = width * 0.5 + side * startBurstOffset;
    const burstY = height * 0.5;
    burstMarkers.push({ x: burstX, y: burstY });
    for (let i = 0; i < 42; i += 1) {
      const walker = new JumpWalker(burstX, burstY);
      // Gleichmaessig in ALLE Richtungen ausgerichtet, statt rein zufaellig - dadurch
      // strahlt das Astwerk sofort sternfoermig in jede Richtung aus
      walker.directionalBiasAngle = (i / 42) * TWO_PI;
      walker.glowUntil = millis() + JUMP_WALKER_GLOW_DURATION_MS * 3.5;
      jumpWalkers.push(walker);
    }
  }
  createNeuralFilaments();
  createDiffusionStaticLayer();
  seedDiffusionAggregation();
  for (let i = 0; i < 60; i += 1) {
    floatingDebris.push({
      x: random(-2000, 2000),
      y: random(-2000, 2000),
      z: random(0, 2000)
    });
  }
  setupUi();
  connectSocket();
}

function toggleDemoMode() {
  if (demoMode) {
    stopDemoMode();
    setStatus('Demo-Modus beendet');
    return;
  }

  startDemoMode(true);
}

function startDemoMode(force = false) {
  if (demoMode || (!force && lastSensorMillis !== 0)) {
    return;
  }

  demoMode = true;
  demoNextBeatAt = 0;
  setStatus('Kein Live-Signal - Demo-Modus aktiv (Taste D zum Umschalten)');
  demoTimer = setInterval(emitDemoSample, DEMO_SAMPLE_INTERVAL_MS);
}

function stopDemoMode() {
  if (!demoMode) {
    return;
  }

  demoMode = false;
  clearInterval(demoTimer);
}

function emitDemoSample() {
  const t = millis() * 0.00028;
  demoSampleId += 1;

  const demoBpm = lerp(58, 96, noise(1000 + t));
  const demoSpo2 = lerp(95, 99, noise(2000 + t));
  const demoAccelX = (noise(3000 + t) - 0.5) * 900;
  const demoAccelY = (noise(4000 + t) - 0.5) * 900;
  const demoAccelZ = (noise(5000 + t) - 0.5) * 900;
  const beat = millis() >= demoNextBeatAt ? 1 : 0;

  if (beat === 1) {
    demoNextBeatAt = millis() + 60000 / demoBpm;
  }

  handleSensorData(
    { bpm: demoBpm, spo2: demoSpo2, accelX: demoAccelX, accelY: demoAccelY, accelZ: demoAccelZ, beat, sampleId: demoSampleId },
    true
  );
}

function windowResized() {
  const previousStarLayers = eclipseStarLayers;
  const previousGrowthLayer = growthLayer;
  const previousAgentTrailLayer = agentTrailLayer;
  const previousWalkerLayer = walkerLayer;
  // Mitte VOR dem Umschalten merken - danach liefern width/height schon die neuen Werte.
  const previousCenterX = width * 0.5;
  const previousCenterY = height * 0.5;
  resizeCanvas(windowWidth, windowHeight);
  eclipseRadius = 0;
  createEclipseStarLayers(previousStarLayers);
  createGrowthLayer(previousGrowthLayer);
  createAgentTrailLayer(previousAgentTrailLayer);
  createWalkerLayer(previousWalkerLayer);
  createPostProcessLayer();
  realignDiffusionAfterResize(previousCenterX, previousCenterY);
}

// Haelt das Geaest nach einer Groessenaenderung an der Erde.
//
// Die sieben Wurzeln sitzen auf einem Ring um die Bildmitte, berechnet in setup(). Aendert
// sich die Fenstergroesse, wandert diese Mitte - beim Wechsel in den Vollbildmodus passiert
// das unmittelbar nach dem Start. Die bereits gesetzten Knoten behalten dabei ihre alten
// Koordinaten und haengen danach nicht mehr an der Kugel. Schlimmer noch: Wurzeln, die durch
// die Verschiebung INNERHALB der Kugel landen, koennen ueberhaupt keinen Knoten mehr setzen,
// weil placeDiffusionChild dort nichts platziert - der Ast ist damit endgueltig tot. Genau
// so blieben von sieben Aesten nur vier uebrig, und die uebrigen begannen sichtbar neben der
// Erde statt an ihr.
function realignDiffusionAfterResize(previousCenterX, previousCenterY) {
  const nurWurzeln = diffusionNodeHistory.length <= DIFFUSION_BRANCH_COUNT;

  if (nurWurzeln) {
    // Noch nichts gewachsen (der Normalfall beim Start): Die Wurzeln werden einfach neu
    // gesetzt. Das ist genauer als ein Verschieben, weil sich mit der Fenstergroesse auch
    // der Kugelradius aendert und der Ring exakt auf ihrem neuen Rand liegen soll.
    diffusionNodes.length = 0;
    diffusionNodeHistory.length = 0;
    diffusionBranches.length = 0;
    seedDiffusionAggregation();
  } else {
    // Schon gewachsen: Das ganze Geaest mitsamt den Ausbruchspunkten um dieselbe Strecke
    // verschieben, die auch die Mitte zurueckgelegt hat. Die Form bleibt erhalten und sitzt
    // weiterhin an der Erde.
    const deltaX = width * 0.5 - previousCenterX;
    const deltaY = height * 0.5 - previousCenterY;
    for (const node of diffusionNodeHistory) {
      node.x += deltaX;
      node.y += deltaY;
    }
    for (const marker of burstMarkers) {
      marker.x += deltaX;
      marker.y += deltaY;
    }
  }

  // Der Puffer mit den bereits eingebackenen Kreisen wird bewusst NICHT uebernommen: Er
  // enthaelt die alten Positionen, und ein Skalieren des fertigen Bildes wuerde nicht zu den
  // verschobenen Knoten passen. Stattdessen faengt das Einbacken von vorn an - alle Kreise
  // werden aus ihren aktuellen Koordinaten neu aufgebaut.
  if (diffusionStaticLayer) {
    diffusionStaticLayer.remove();
    diffusionStaticLayer = undefined;
  }
  createDiffusionStaticLayer();
  diffusionBakedCount = 0;
}

function createEclipseStarLayers(previousLayers = []) {
  eclipseStarLayers = [0, 1, 2].map((depthIndex) => {
    const layer = createGraphics(width, height);
    layer.colorMode(RGB, 255, 255, 255, 255);
    layer.clear();

    if (previousLayers[depthIndex]) {
      layer.image(previousLayers[depthIndex], 0, 0, width, height);
      previousLayers[depthIndex].remove();
    }

    return layer;
  });

  for (let index = eclipseStarLayers.length; index < previousLayers.length; index += 1) {
    previousLayers[index].remove();
  }
}

function createGrowthLayer(previousLayer) {
  growthLayer = createGraphics(width, height);
  growthLayer.colorMode(RGB, 255, 255, 255, 255);
  growthLayer.clear();

  if (previousLayer) {
    growthLayer.image(previousLayer, 0, 0, width, height);
    previousLayer.remove();
  }
}

function createAgentTrailLayer(previousLayer) {
  agentTrailLayer = createGraphics(width, height);
  agentTrailLayer.colorMode(RGB, 255, 255, 255, 255);
  agentTrailLayer.clear();

  if (previousLayer) {
    agentTrailLayer.image(previousLayer, 0, 0, width, height);
    previousLayer.remove();
  }
}

function createWalkerLayer(previousLayer) {
  walkerLayer = createGraphics(width, height);
  walkerLayer.colorMode(RGB, 255, 255, 255, 255);
  walkerLayer.clear();

  if (previousLayer) {
    walkerLayer.image(previousLayer, 0, 0, width, height);
    previousLayer.remove();
  }
}

function createPostProcessLayer() {
  if (postProcessLayer) {
    postProcessLayer.remove();
  }

  postProcessLayer = createGraphics(width, height);
  postProcessLayer.clear();
}

let hasStarted = false;

function getStartButtonBounds() {
  const buttonWidth = 220;
  const buttonHeight = 58;
  // Unterhalb der Kugel statt mittig auf ihr - sonst verdeckt der Button genau das, was der
  // Startbildschirm zeigen soll.
  return {
    x: width * 0.5 - buttonWidth * 0.5,
    y: height * 0.5 + getBaseEclipseRadius() * 1.55,
    w: buttonWidth,
    h: buttonHeight
  };
}

// Der Startbildschirm zeigt die Arbeit schon im Ruhezustand: der dunkle Verlauf, ein paar
// langsam treibende Lichtpunkte und die Herz-Kugel, die ruhig atmet. Kein Puls und keine
// Sensordaten - nur ein sachtes Heben und Senken, damit das Bild lebt, ohne etwas zu
// versprechen, was noch gar nicht da ist.
function drawStartScreen() {
  drawEclipseBackdrop();
  draw3DDebris();

  // Ein langsamer Atem von etwa sieben Sekunden je Zyklus, viel ruhiger als der spaetere
  // Herzschlag. eclipseRadius wird dabei gleich mitgesetzt, damit die Kugel beim Start nicht
  // von null aufspringt, sondern genau da weitermacht, wo sie gerade steht.
  const breathing = sin(millis() * 0.0009) * 0.5 + 0.5;
  const coreRadius = getBaseEclipseRadius() * (0.94 + breathing * 0.06);
  eclipseRadius = coreRadius;
  const centerX = width * 0.5;
  const centerY = height * 0.5;

  // Weicher Hof um die Kugel, der mit dem Atem leicht mitgeht
  push();
  noFill();
  for (let ring = 0; ring < 3; ring += 1) {
    stroke(BASE_AMBIENT_COLOR[0], BASE_AMBIENT_COLOR[1], BASE_AMBIENT_COLOR[2], 10 - ring * 3);
    strokeWeight(1 + ring * 2.5);
    circle(centerX, centerY, coreRadius * (2.2 + ring * 0.22 + breathing * 0.08));
  }
  pop();

  drawVolumetricSphere(centerX, centerY, coreRadius, 0, 0, BASE_AMBIENT_COLOR);

  const bounds = getStartButtonBounds();
  const hovering = mouseX > bounds.x && mouseX < bounds.x + bounds.w && mouseY > bounds.y && mouseY < bounds.y + bounds.h;

  push();
  textAlign(CENTER, CENTER);
  textFont('monospace');
  noStroke();
  fill(220, 230, 238, 150 + breathing * 40);
  textSize(width < 560 ? 14 : 17);
  text('Biorhythm Collective', centerX, centerY - getBaseEclipseRadius() * 1.7);

  noFill();
  stroke(255, hovering ? 110 : 55);
  strokeWeight(1);
  rect(bounds.x, bounds.y, bounds.w, bounds.h, 12);

  noStroke();
  fill(235, hovering ? 255 : 205);
  textSize(19);
  text('START', centerX, bounds.y + bounds.h * 0.5);

  fill(170, 180, 195, 120);
  textSize(11);
  text('Aktiviert Ton und Vollbild', centerX, bounds.y + bounds.h + 26);
  pop();
}

function mousePressed() {
  if (hasStarted) {
    return;
  }
  const bounds = getStartButtonBounds();
  if (mouseX > bounds.x && mouseX < bounds.x + bounds.w && mouseY > bounds.y && mouseY < bounds.y + bounds.h) {
    hasStarted = true;
    // Vollbild direkt aus dem Klick heraus - Browser erlauben den Wechsel nur als Reaktion
    // auf eine echte Nutzeraktion, ein spaeterer Aufruf wuerde stillschweigend ignoriert.
    try {
      fullscreen(true);
    } catch (error) {
      // Kein Vollbild moeglich (z.B. Berechtigung verweigert) - die Arbeit laeuft trotzdem
    }
    resumeSoundEngine();
    connectSocket();
  }
}

function draw() {
  if (!hasStarted) {
    drawStartScreen();
    return;
  }

  updateConnectionDot();
  blendMode(BLEND);
  updateEclipseState();
  drawEclipseBackdrop();
  push();
  translate(cameraOffsetX, cameraOffsetY);
  applySceneTilt();
  drawGravityGrid();
  draw3DDebris();
  drawDiagonalGrid();
  drawHistoricalStars();
  drawAggregation();
  drawMotionGrid();
  // M_1_5_03 zieht nur seine feinen Spuren. drawFlowAgentGlows() - die Funken, die bei jedem
  // Herzschlag aufblitzen und Strahlen schiessen - bleibt bewusst draussen: Das System soll
  // ganz entspannt im Hintergrund laufen, und genau dieses Blitzen machte das Bild unruhig.
  drawFlowAgents();
  drawJumpWalkers();
  // Das Aufleuchten gehoert untrennbar zu P_2_2_1_02: Beim 200-Sterne-Ausbruch gluehen die
  // 42 Walker gleichzeitig und in derselben Farbe auf, und ihre Leuchtkreise verschmelzen
  // zu dem einen grossen hellen Kreis, der den Effekt ausmacht. Ohne diesen Aufruf
  // entstehen die Walker zwar, der Moment selbst bleibt aber unsichtbar.
  drawJumpWalkerGlows();
  drawDiffusionAggregation();
  drawNeuralFilaments(false);
  drawEclipse();
  drawNeuralFilaments(true);
  // P_2_2_1_02: statt eines Ast-Planeten entsteht am Ausbruchspunkt nur ein kleiner,
  // leuchtender Punkt (burstMarkers, siehe handleSensorData) - drawBranchPlanets() bleibt
  // daher bewusst abgeschaltet.
  drawBurstMarkers();
  drawWaves();
  drawGrain();
  pop();
  drawDepthFog();
  blendMode(BLEND);
  drawOverlay();
}

// Der Hintergrund ist schlicht: ein weicher, dunkler Verlauf, das langsam treibende
// Sternenfeld, Nebel am Rand und feines Korn. Alles, was die Flaeche gefuellt oder bewegt
// hat, ist abgeschaltet - im Bild stehen nur noch die Erde und die Kreise um sie herum, und
// beide bewegen sich nur leicht.
//
// Die Funktionen sind mit Absicht NICHT geloescht, nur nicht mehr aufgerufen. Jedes Element
// ist mit einer einzigen Zeile wieder da:
//
//   drawJumpWalkerGlows()    Aufleuchten der Walker
//   drawFlowAgentGlows()     die Funken mit Strahlen bei jedem Herzschlag
//   drawNeuralFilaments()    Ranken, die aus der Kugel wachsen
//   drawNeuralEnergyArcs()   Energieboegen zwischen den Ranken
//   drawMagicRings()         rotierende Ringe um die Kugel
//   drawAggregation()        angelagerte Wachstumskreise um die Kugel
//   drawBranchPlanets()      kleine Planeten an den Aesten
//   draw3DDebris()           treibende Lichtpunkte mit Schweif
//   drawGravityGrid()        verzerrtes Gravitationsgitter
//   drawDiagonalGrid()       diagonales Rastermuster
//   drawMotionGrid()         Bewegungsgitter aus kurzen Strichen
//   drawChromaticAberration()  Farbsaum beim Schlag
//   drawBioGlitch()          Glitch-Streifen bei niedrigem Sauerstoff
//
// Wichtig beim Wiedereinschalten: Plasmawellen, Energieboegen und Ast-Planeten werden erst
// BEIM ZEICHNEN wieder aus ihren Listen entfernt. Deshalb ist an den passenden Stellen auch
// das Erzeugen abgeschaltet - sonst waeren die Listen unsichtbar ins Unendliche gewachsen.
// Wer eines zurueckholt, muss dort ebenfalls nachsehen (triggerBeat und handleSensorData).

function updateEclipseState() {
  if (lastBeatMillis === 0) {
    beatPulse = 0;
  } else {
    const beatAge = constrain((millis() - lastBeatMillis) / ECLIPSE_BEAT_DECAY_MS, 0, 1);
    beatPulse = pow(1 - beatAge, 3);
  }

  const breathingDepth = 0.1 + (1 - normalizedSpo2) * 0.4;
  breathPulse = (sin(millis() * 0.0011) * 0.5 + 0.5) * breathingDepth;

  const beatInterval = 60000 / constrain(bpm || BPM_MIN, BPM_MIN, BPM_MAX);
  const beatPhase = ((millis() - lastBeatMillis) % beatInterval) / beatInterval;
  const preBeatTarget = beatPulse > 0.04 ? 0 : pow(constrain(map(beatPhase, 0.76, 1, 0, 1), 0, 1), 2);
  preBeatPulse = lerp(preBeatPulse, preBeatTarget, 0.12);

  const shakeStrength = motionAmount * 5 + beatPulse * 2;
  const shakeTime = millis() * 0.003;
  cameraOffsetX = lerp(cameraOffsetX, (noise(41, shakeTime) - 0.5) * shakeStrength, 0.16);
  cameraOffsetY = lerp(cameraOffsetY, (noise(83, shakeTime) - 0.5) * shakeStrength, 0.16);

  const motionX = constrain(accelX / ECLIPSE_ACCEL_REFERENCE, -1, 1);
  const motionY = constrain(accelY / ECLIPSE_ACCEL_REFERENCE, -1, 1);
  sceneTiltX = lerp(sceneTiltX, constrain(-motionY * 0.08 + sin(millis() * 0.00014) * 0.008, -0.08, 0.08), 0.035);
  sceneTiltY = lerp(sceneTiltY, constrain(motionX * 0.08 + cos(millis() * 0.00012) * 0.008, -0.08, 0.08), 0.035);

  const baseRadius = getBaseEclipseRadius();
  // Zwischen den Schlaegen schrumpft die Kugel deutlich (auf ~70%), bei jedem Beat
  // explosionsartiges Aufleuchten/Wachsen, danach wieder Zusammenziehen - wie ein echtes Herz
  // Gemessen pumpte die Kugel vorher zwischen 100 und 160 Pixel Radius, ihr Durchmesser
  // aenderte sich also gut einmal pro Sekunde um 122 Pixel. Das las sich nicht als
  // Herzschlag, sondern als unruhiges Wandern. Mit diesen Werten liegt der Ausschlag bei
  // rund 21 statt 61 Pixeln - der Puls bleibt deutlich sichtbar, die Kugel steht aber ruhig.
  const quietRadius = baseRadius * (0.985 + breathPulse * 0.01);
  const targetRadius = quietRadius + baseRadius * beatPulse * 0.025;
  const radiusSmoothing = beatPulse > 0.04 ? 0.24 : 0.05;
  eclipseRadius = eclipseRadius === 0 ? targetRadius : lerp(eclipseRadius, targetRadius, radiusSmoothing);
}

function drawEclipseBackdrop() {
  background(0, 1, 4);

  const context = drawingContext;
  const motionColor = getColorAtPosition(width * 0.5, height * 0.5);
  const horizonRadius = max(width, height) * 0.86;
  const gradient = context.createRadialGradient(
    width * 0.5,
    height * 0.5,
    min(width, height) * 0.08,
    width * 0.5,
    height * 0.5,
    horizonRadius
  );

  const coreGlow = 0.06 + breathPulse * 0.04 + beatPulse * 0.05;
  gradient.addColorStop(0, `rgba(${motionColor[0]}, ${motionColor[1]}, ${motionColor[2]}, ${coreGlow})`);
  gradient.addColorStop(0.35, 'rgba(8, 14, 24, 0.05)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  context.save();
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function applySceneTilt() {
  translate(width * 0.5, height * 0.5);
  drawingContext.transform(1, sceneTiltY * 0.55, sceneTiltX * 0.55, cos(sceneTiltX), 0, 0);
  translate(-width * 0.5, -height * 0.5);
}

function drawDepthFog() {
  const context = drawingContext;
  const fogColor = getDepthColor(currentMotionColor, -0.8, 0.36);
  const outerRadius = max(width, height) * 0.76;
  const fog = context.createRadialGradient(width * 0.5, height * 0.5, min(width, height) * 0.12, width * 0.5, height * 0.5, outerRadius);
  fog.addColorStop(0, 'rgba(0, 0, 0, 0)');
  fog.addColorStop(0.55, toRgba(fogColor, 0.025));
  fog.addColorStop(1, 'rgba(0, 2, 6, 0.72)');

  context.save();
  context.fillStyle = fog;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function getGravityGridPoint(x, y, centerX, centerY, rippleRadius) {
  const deltaX = x - centerX;
  const deltaY = y - centerY;
  const distance = max(1, sqrt(deltaX * deltaX + deltaY * deltaY));
  const maxDistance = sqrt(width * width + height * height) * 0.5;
  const centerPull = 34 * pow(constrain(1 - distance / maxDistance, 0, 1), 2);
  const ripplePush = beatPulse * exp(-abs(distance - rippleRadius) / 74) * 28;
  const warpedDistance = distance - centerPull + ripplePush;
  return {
    x: centerX + deltaX / distance * warpedDistance,
    y: centerY + deltaY / distance * warpedDistance
  };
}

function drawGravityGrid() {
  const gridStep = 160;
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const rippleAge = lastBeatMillis === 0 ? 0 : millis() - lastBeatMillis;
  const rippleRadius = rippleAge * 0.64;
  const gridColor = getDepthColor(currentMotionColor, -0.72, 0.46);

  push();
  noFill();
  stroke(gridColor[0], gridColor[1], gridColor[2], 8 + beatPulse * 20);
  strokeWeight(0.45 + beatPulse * 0.3);
  for (let y = -gridStep; y <= height + gridStep; y += gridStep) {
    beginShape();
    for (let x = -gridStep; x <= width + gridStep; x += gridStep) {
      const point = getGravityGridPoint(x, y, centerX, centerY, rippleRadius);
      vertex(point.x, point.y);
    }
    endShape();
  }
  for (let x = -gridStep; x <= width + gridStep; x += gridStep) {
    beginShape();
    for (let y = -gridStep; y <= height + gridStep; y += gridStep) {
      const point = getGravityGridPoint(x, y, centerX, centerY, rippleRadius);
      vertex(point.x, point.y);
    }
    endShape();
  }
  pop();
}

// Diagonal Grid — based on P_2_1_1_02
// Generative Gestaltung, Benedikt Groß, Hartmut Bohnacker, Julia Laub, Claudius Lazzeroni
// with contributions by Joey Lee and Niels Poldervaart
// ISBN: 978-3-87439-902-9 — http://www.generative-gestaltung.de
// Licensed under Apache License 2.0
function drawDiagonalGrid() {
  const tileSize = 64;
  const gridEnergy = constrain(map(normalizedBpm, 0.18, 1, 0, 1), 0, 1);
  const activeTileChance = 0.14 + gridEnergy * 0.7;
  // Reduziert, damit die drei Haupteffekte (FlowAgents, JumpWalkers, Diffusion) mehr auffallen
  const lineAlpha = 1 + gridEnergy * 2;
  const lineWeight = 0.18 + gridEnergy * 0.7;
  const jitterAmount = tileSize * (0.012 + motionAmount * 0.055);

  randomSeed(collectiveStarCount);
  push();
  strokeCap(SQUARE);
  strokeWeight(lineWeight);
  for (let y = -tileSize; y < height + tileSize; y += tileSize) {
    for (let x = -tileSize; x < width + tileSize; x += tileSize) {
      if (random() > activeTileChance) {
        continue;
      }

      const jitterX = random(-jitterAmount, jitterAmount);
      const jitterY = random(-jitterAmount, jitterAmount);
      const extent = tileSize * random(0.66, 0.88);

      if (random() < 0.5) {
        stroke(197, 0, 123, lineAlpha);
        line(x + jitterX, y + extent + jitterY, x + extent + jitterX, y + jitterY);
      } else {
        stroke(87, 35, 129, lineAlpha * 0.86);
        line(x + jitterX, y + jitterY, x + extent + jitterX, y + extent + jitterY);
      }
    }
  }
  pop();
  randomSeed(ECLIPSE_SEED);
}

function drawHistoricalStars() {
  const motionX = constrain(accelX / ECLIPSE_ACCEL_REFERENCE, -1, 1);
  const motionY = constrain(accelY / ECLIPSE_ACCEL_REFERENCE, -1, 1);

  for (let index = 0; index < eclipseStarLayers.length; index += 1) {
    const depth = lerp(-0.85, 0.85, index / max(1, eclipseStarLayers.length - 1));
    const parallax = lerp(2, 15, (depth + 1) * 0.5);
    push();
    translate(motionX * parallax, motionY * parallax);
    image(eclipseStarLayers[index], 0, 0);
    pop();
  }
}

function drawMotionGrid() {
  const time = millis() * 0.00012;
  const flowX = constrain(accelX / ECLIPSE_ACCEL_REFERENCE, -1, 1) * 260;
  const flowY = constrain(accelY / ECLIPSE_ACCEL_REFERENCE, -1, 1) * 260;
  const turbulence = motionAmount;
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const coreClearance = min(width, height) * 0.24;
  const cols = ceil(width / MOTION_GRID_CELL_SIZE) + 1;
  const rows = ceil(height / MOTION_GRID_CELL_SIZE) + 1;

  push();
  strokeCap(ROUND);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * MOTION_GRID_CELL_SIZE;
      const y = row * MOTION_GRID_CELL_SIZE;
      const distanceFromCore = dist(x, y, centerX, centerY);

      if (distanceFromCore < coreClearance) {
        continue;
      }

      const noiseValue = noise(
        MOTION_GRID_SEED_OFFSET + (x + flowX) * 0.0026,
        MOTION_GRID_SEED_OFFSET * 1.7 + (y + flowY) * 0.0026,
        time + turbulence * 0.6
      );
      const angle = noiseValue * TWO_PI * 2;
      const edgeFade = constrain(map(distanceFromCore, coreClearance, coreClearance * 1.6, 0, 1), 0, 1);
      const reach = (0.28 + turbulence * 0.62) * MOTION_GRID_CELL_SIZE * (0.35 + noiseValue * 0.65) * edgeFade;
      const alpha = (4 + turbulence * 22) * edgeFade;

      const motionColor = getColorAtPosition(x, y);
      stroke(motionColor[0], motionColor[1], motionColor[2], alpha);
      strokeWeight(0.6 + turbulence * 1.1);
      line(
        x - cos(angle) * reach,
        y - sin(angle) * reach,
        x + cos(angle) * reach,
        y + sin(angle) * reach
      );
    }
  }
  pop();
}

const SESSION_GROWTH_DURATION_MS = 600000; // 10 Minuten bis volle Groesse erreicht ist

function getSessionGrowth() {
  return constrain(pow(millis() / SESSION_GROWTH_DURATION_MS, 0.5), 0.12, 1);
}

function getBaseEclipseRadius() {
  // Von 0.145 auf 0.115 verkleinert. Der Wert wirkt nicht nur auf die gezeichnete Kugel,
  // sondern ist auch der Bezugspunkt fuer den Ansatzring der Knoten (siehe
  // seedDiffusionAggregation und placeDiffusionChild) - beides schrumpft dadurch
  // gemeinsam und bleibt im richtigen Verhaeltnis zueinander.
  return min(width, height) * 0.115;
}

function getEclipseCore() {
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const coreRadius = eclipseRadius || getBaseEclipseRadius() * 0.89;
  return { centerX, centerY, coreRadius };
}

function project3D(x, y, z) {
  const scale = FOCAL_LENGTH / (FOCAL_LENGTH + z);
  return {
    x: width * 0.5 + x * scale,
    y: height * 0.5 + y * scale,
    scale
  };
}

// ---- Ast-Planeten ----
// Ersetzt das vorherige Erde-Mond-System. Statt einer einzelnen Kugel, die nur um die
// Herz-Kugel kreist, entsteht jetzt alle JUMP_WALKER_SPREAD_EVERY_STARS Sterne ein neuer,
// kleiner Planet direkt an einer bestehenden Ast-Stelle (siehe handleSensorData). Er bleibt
// dauerhaft dort stehen und wird selbst zum Ursprung eines neuen 42-Walker-Ausbruchs, von
// dem aus sich weitere Aeste ausbreiten. So sammeln sich ueber eine lange Session immer mehr
// Wachstumszentren an unterschiedlichen Stellen des Bildschirms an, statt dass alles nur von
// der Herz-Kugel selbst ausgeht.
const branchPlanets = [];

function spawnBranchPlanet(x, y) {
  const core = getEclipseCore();
  // Deutlich kleiner als frueher (0.22 -> 0.13) und mit spawnedAt fuer ein sanftes Einblenden
  // in drawBranchPlanets() - soll als ruhiger Hintergrund-Akzent wirken, kein Blickfang.
  branchPlanets.push({ x, y, radius: core.coreRadius * 0.13, spawnedAt: millis() });
}

// Einfache, klare Kugel fuer die kleinen Ast-Planeten - der volumetrische Effekt der
// Herz-Kugel (mehrere gestapelte Gradient-Ringe) ist fuer die grosse Kugel gedacht und
// wirkt bei kleineren Kugeln wie mehrere klobige weisse Kreise. Hier stattdessen nur ein
// sanfter Farbverlauf. opacity (0-1) skaliert alle Alpha-Werte gleichzeitig - genutzt fuer
// das sanfte Einblenden neuer Planeten und um sie insgesamt gedaempfter wirken zu lassen.
function drawSimpleSphere(centerX, centerY, radius, color, opacity = 1) {
  const context = drawingContext;
  const lightX = centerX - radius * 0.3;
  const lightY = centerY - radius * 0.3;

  const gradient = context.createRadialGradient(lightX, lightY, radius * 0.05, centerX, centerY, radius * 1.05);
  gradient.addColorStop(0, toRgba([min(255, color[0] + 60), min(255, color[1] + 60), min(255, color[2] + 60)], 0.55 * opacity));
  gradient.addColorStop(0.55, toRgba(color, 0.42 * opacity));
  gradient.addColorStop(1, toRgba([color[0] * 0.4, color[1] * 0.4, color[2] * 0.4], 0.45 * opacity));

  context.save();
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, TWO_PI);
  context.fill();
  context.restore();
}

// Markierungen der Stellen, an denen der 200-Sterne-Ausbruch (P_2_2_1_02) gezuendet hat.
//
// Frueher entstand dort ein kleiner Planet: eine plastische Kugel mit Lichtkante, die
// zwangslaeufig zum Blickfang wurde und ueber eine lange Session zu einem Haufen
// zusammenlief. Ein einzelner heller Punkt markiert dieselbe Stelle, bleibt aber im
// Hintergrund - genau das war der Wunsch.
const burstMarkers = [];

function drawBurstMarkers() {
  push();
  blendMode(ADD);
  noStroke();
  for (const marker of burstMarkers) {
    const color = getColorAtPosition(marker.x, marker.y);
    // Ein winziger heller Kern mit einem sehr schwachen Hof ringsum - der Hof sorgt dafuer,
    // dass der Punkt nicht als harter Pixel wirkt, ohne selbst sichtbar zu leuchten.
    fill(min(255, color[0] + 80), min(255, color[1] + 80), min(255, color[2] + 80), 45);
    circle(marker.x, marker.y, 9);
    fill(255, 255, 255, 130);
    circle(marker.x, marker.y, 2.4);
  }
  pop();
}

const BRANCH_PLANET_FADE_IN_MS = 3200;

function drawBranchPlanets() {
  for (const planet of branchPlanets) {
    const color = getColorAtPosition(planet.x, planet.y);
    // Blendet ueber gut drei Sekunden sanft ein, statt sofort in voller Groesse/Deckkraft zu
    // erscheinen - so faellt der Moment des Entstehens nicht auf, der Planet ist danach ein
    // ruhiger, gedaempfter Hintergrund-Akzent.
    const fadeIn = constrain((millis() - (planet.spawnedAt || 0)) / BRANCH_PLANET_FADE_IN_MS, 0, 1);
    drawSimpleSphere(planet.x, planet.y, planet.radius * (0.4 + fadeIn * 0.6), color, fadeIn);
  }
}

function getMotionColor() {
  return currentMotionColor;
}

let currentMotionColor = [255, 90, 90];

function hsbToRgb(h, s, v) {
  const hue = ((h % 360) + 360) % 360;
  const sat = constrain(s, 0, 100) / 100;
  const val = constrain(v, 0, 100) / 100;
  const c = val * sat;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = val - c;
  let r = 0, g = 0, b = 0;
  if (hue < 60) { r = c; g = x; b = 0; }
  else if (hue < 120) { r = x; g = c; b = 0; }
  else if (hue < 180) { r = 0; g = c; b = x; }
  else if (hue < 240) { r = 0; g = x; b = c; }
  else if (hue < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function getMovementMapPosition() {
  const horizontal = constrain(accelX / MOVEMENT_MAP_ACCEL_REFERENCE, -1, 1);
  const vertical = constrain(accelY / MOVEMENT_MAP_ACCEL_REFERENCE, -1, 1);

  return {
    x: width * 0.5 + horizontal * width * MOVEMENT_MAP_REACH,
    y: height * 0.5 + vertical * height * MOVEMENT_MAP_REACH,
    horizontal,
    vertical
  };
}

// ---- Farb-Checkpoints ----
// Statt EINER globalen Farbe, die ueberall gleichzeitig alles einfaerbt, hinterlaesst
// Bewegung nur an der Stelle, wo sie tatsaechlich stattfindet, einen "Farb-Checkpoint".
// Objekte fragen per getColorAtPosition(x, y) ihre eigene, lokale Farbe ab - weit entfernte
// Bereiche bleiben in der neutralen Grundfarbe, bis dort ebenfalls Bewegung ankommt.
const COLOR_CHECKPOINT_MAX = 10;
const COLOR_CHECKPOINT_MIN_DISTANCE = 90;
const COLOR_CHECKPOINT_INFLUENCE_RADIUS = 340;
const BASE_AMBIENT_COLOR = [150, 160, 175];
let colorCheckpoints = [];

function registerColorCheckpoint(x, y, color) {
  const last = colorCheckpoints[colorCheckpoints.length - 1];
  if (last && dist(x, y, last.x, last.y) < COLOR_CHECKPOINT_MIN_DISTANCE) {
    // Noch am selben Ort: bestehenden Checkpoint weich aktualisieren statt neuen zu erzeugen
    last.color[0] = lerp(last.color[0], color[0], 0.15);
    last.color[1] = lerp(last.color[1], color[1], 0.15);
    last.color[2] = lerp(last.color[2], color[2], 0.15);
    last.x = lerp(last.x, x, 0.15);
    last.y = lerp(last.y, y, 0.15);
    return;
  }

  colorCheckpoints.push({ x, y, color: [...color] });
  if (colorCheckpoints.length > COLOR_CHECKPOINT_MAX) {
    colorCheckpoints.shift();
  }
}

function getColorAtPosition(x, y) {
  if (colorCheckpoints.length === 0) {
    return BASE_AMBIENT_COLOR;
  }

  let totalWeight = 0;
  let r = 0;
  let g = 0;
  let b = 0;

  for (const checkpoint of colorCheckpoints) {
    const distance = dist(x, y, checkpoint.x, checkpoint.y);
    const weight = 1 / (1 + pow(distance / COLOR_CHECKPOINT_INFLUENCE_RADIUS, 2));
    totalWeight += weight;
    r += checkpoint.color[0] * weight;
    g += checkpoint.color[1] * weight;
    b += checkpoint.color[2] * weight;
  }

  // Bereiche fernab jedes Checkpoints bleiben neutral, statt vom naechstgelegenen
  // Checkpoint komplett uebernommen zu werden
  const ambientWeight = max(0, 1 - totalWeight);
  totalWeight += ambientWeight;
  r += BASE_AMBIENT_COLOR[0] * ambientWeight;
  g += BASE_AMBIENT_COLOR[1] * ambientWeight;
  b += BASE_AMBIENT_COLOR[2] * ambientWeight;

  return [r / totalWeight, g / totalWeight, b / totalWeight];
}

function updateMotionColor() {
  const { x, y } = getMovementMapPosition();
  // Die Palette liegt auf der Spanne, die der Sensor tatsaechlich durchlaeuft (siehe oben).
  const horizontalProgress = updateColorRange(colorRangeX, accelX);
  const verticalProgress = updateColorRange(colorRangeY, accelY);
  // Links = kalt (Blau), rechts = warm (Rot/Orange)
  // Breiterer Farbbereich: links jetzt Violett/Lila (statt nur Blau), rechts weiterhin Rot -
  // dazwischen liegt der komplette Regenbogen (Blau, Tuerkis, Gruen, Gelb, Orange), dadurch
  // ist z.B. Lila jetzt tatsaechlich erreichbar (vorher lag es ausserhalb des Bereichs).
  // Links Lila, dann Blau, ueber Tuerkis, Gruen und Gelb bis Rot ganz rechts - mit breiten
  // Plateaus auf Blau, Gruen und Rot, siehe getHueForProgress().
  const hue = getHueForProgress(horizontalProgress);
  // Oben = blass und hell, unten = satt und dunkel.
  //
  // Die Helligkeit stand hier fest auf 88. Damit war jede Farbe zwangslaeufig hell: Ein
  // dunkles Rot, ein dunkles Blau oder ein tiefes Lila liessen sich gar nicht erzeugen, egal
  // wie man den Sensor haelt - alles blieb im hellen, blassen Bereich. Deshalb laeuft sie
  // jetzt auf derselben Achse mit: Nach unten wird die Farbe gleichzeitig gesaettigter UND
  // dunkler, was zusammen die tiefen Toene ergibt. Nach oben bleibt es hell und blass.
  const saturation = lerp(8, 100, verticalProgress);
  const brightness = lerp(98, 62, verticalProgress);
  const targetColor = hsbToRgb(hue, saturation, brightness);

  registerColorCheckpoint(x, y, targetColor);

  // currentMotionColor bleibt als Fallback fuer Dinge ohne eigene Position erhalten,
  // folgt aber jetzt der Farbe GENAU AN DER BEWEGUNGSPOSITION statt einer globalen Mischung
  const localColor = getColorAtPosition(x, y);
  currentMotionColor[0] = localColor[0];
  currentMotionColor[1] = localColor[1];
  currentMotionColor[2] = localColor[2];
}

// Farbe rein nach Bewegungsintensitaet - nutzt jetzt dieselbe Emotions-Farbe wie getMotionColor,
// damit alle Elemente (Kugel, Aeste, Flow Agents, Wellen, Grain) farblich zusammengehoeren.
function getMovementColor() {
  return currentMotionColor;
}

function drawAggregation() {
  if (growthLayer) {
    image(growthLayer, 0, 0);
  }

  const core = getEclipseCore();
  const seedColor = getMotionColor();

  push();
  noFill();
  stroke(seedColor[0], seedColor[1], seedColor[2], 90 + breathPulse * 60);
  strokeWeight(1.1 + beatPulse * 1.4);
  circle(core.centerX, core.centerY, core.coreRadius * 2.12);
  pop();
}

function growAggregation() {
  if (growthCircles.length >= GROWTH_MAX_CIRCLES) {
    return;
  }

  randomSeed(ECLIPSE_SEED + collectiveStarCount * 17 + floor(millis()));
  const core = getEclipseCore();
  const candidateAngle = random(TWO_PI);
  const candidateReach = core.coreRadius * random(1.05, 2.6);
  const candidateX = core.centerX + cos(candidateAngle) * candidateReach;
  const candidateY = core.centerY + sin(candidateAngle) * candidateReach;

  let closestX = core.centerX;
  let closestY = core.centerY;
  let closestR = core.coreRadius;
  let closestDist = dist(candidateX, candidateY, core.centerX, core.centerY);

  for (const existingCircle of growthCircles) {
    const distance = dist(candidateX, candidateY, existingCircle.x, existingCircle.y);
    if (distance < closestDist) {
      closestDist = distance;
      closestX = existingCircle.x;
      closestY = existingCircle.y;
      closestR = existingCircle.r;
    }
  }

  const angle = atan2(candidateY - closestY, candidateX - closestX);
  const newRadius = lerp(GROWTH_MIN_RADIUS, GROWTH_MAX_RADIUS, normalizedBpm) * random(0.7, 1.3);
  const newX = closestX + cos(angle) * (closestR + newRadius);
  const newY = closestY + sin(angle) * (closestR + newRadius);

  growthCircles.push({ x: newX, y: newY, r: newRadius });
  stampGrowthCircle(newX, newY, newRadius, getColorAtPosition(newX, newY));
}

function stampGrowthCircle(x, y, r, color) {
  if (!growthLayer) {
    return;
  }

  growthLayer.push();
  growthLayer.noStroke();
  growthLayer.fill(color[0], color[1], color[2], 200);
  growthLayer.circle(x, y, r * 2);
  growthLayer.pop();
}

// Flow Agents — originalgetreu nach M_1_5_03
// Generative Gestaltung, Benedikt Groß, Hartmut Bohnacker, Julia Laub, Claudius Lazzeroni
// with contributions by Joey Lee and Niels Poldervaart
// ISBN: 978-3-87439-902-9 — http://www.generative-gestaltung.de
// Licensed under Apache License 2.0
//
// Original-Prinzip: viele Agenten, jeder folgt einem 3D-Noise-Feld (x, y, z-Zeit) und
// zieht dabei eine feine Linie. Ein halbtransparentes Rechteck ueberlagert jeden Frame
// den Bildschirm, wodurch alte Linien langsam verblassen ("Schraffur"-Look).
// BPM steuert hier: noiseScale (Feinheit des Musters) und noiseStrength (Ausschlag je Schritt).
class FlowAgent {
  constructor() {
    this.x = random(width);
    this.y = random(height);
    this.zOffset = random(1000);
    this.glowUntil = 0;
    this.glowRaySeed = 0;
  }

  update() {
    const noiseScale = 260;
    const baseStrength = 1.1;
    const noiseZVelocity = 0.0025;

    // Beim Herzschlag kurzzeitig staerker ausschlagen (elektrischer Impuls)
    const beatBoost = 1 + beatPulse * 6;
    const noiseStrength = baseStrength * beatBoost;

    const angle = noise(this.x / noiseScale, this.y / noiseScale, this.zOffset) * TWO_PI * 4;

    // Leichter Sog zur Kugelmitte hin, statt komplett zufaellig im Raum zu treiben
    const core = getEclipseCore();
    const towardCoreAngle = atan2(core.centerY - this.y, core.centerX - this.x);
    const pullStrength = 0.06 + motionAmount * 0.05;

    const driftX = cos(angle) * (1 - pullStrength) + cos(towardCoreAngle) * pullStrength;
    const driftY = sin(angle) * (1 - pullStrength) + sin(towardCoreAngle) * pullStrength;

    const newX = this.x + driftX * noiseStrength;
    const newY = this.y + driftY * noiseStrength;

    const localColor = getColorAtPosition(this.x, this.y);
    agentTrailLayer.stroke(localColor[0], localColor[1], localColor[2], this.currentAlpha);
    agentTrailLayer.strokeWeight(this.currentWeight);
    agentTrailLayer.line(this.x, this.y, newX, newY);

    this.x = newX;
    this.y = newY;
    this.zOffset += noiseZVelocity;

    if (this.x < 0 || this.x > width || this.y < 0 || this.y > height) {
      this.x = random(width);
      this.y = random(height);
    }
  }
}

// M_1_5_03: bei jedem Herzschlag leuchten einige Agenten an ihrer Position auf - gezeichnet
// direkt auf dem Hauptcanvas mit additivem Blend-Modus, da eine kleine, halbtransparente
// Ebene mit staendigem Fade praktisch unsichtbar war. Bewusst gedaempft (kein Funken-Strahl,
// kleiner und schwaecher als urspruenglich): soll dem Bild Tiefe geben, nicht auffallen -
// ein ruhiger Hintergrund-Akzent statt eines auffaelligen Aufblitzens.
function drawFlowAgentGlows() {
  push();
  blendMode(ADD);
  for (let index = 0; index < flowAgents.length; index += 1) {
    const agent = flowAgents[index];
    if (millis() >= agent.glowUntil) {
      continue;
    }
    const glowRemaining = constrain((agent.glowUntil - millis()) / FLOW_AGENT_GLOW_DURATION_MS, 0, 1);
    const localColor = getColorAtPosition(agent.x, agent.y);
    const brightColor = [
      min(255, localColor[0] + 60),
      min(255, localColor[1] + 60),
      min(255, localColor[2] + 60)
    ];

    noStroke();
    // Weicher, kleiner Aussenglow
    fill(brightColor[0], brightColor[1], brightColor[2], glowRemaining * 22);
    circle(agent.x, agent.y, 26 * glowRemaining);
    // Zarter Kern, deutlich schwaecher als urspruenglich
    fill(brightColor[0], brightColor[1], brightColor[2], glowRemaining * 110);
    circle(agent.x, agent.y, 5 * glowRemaining + 1.5);
  }
  pop();
}

// M_1_5_03: unabhaengig vom Herzschlag leuchten die Linien alle 3-5 Sekunden kurz
// insgesamt etwas heller auf - ein eigener, ambienter Zeittakt statt Puls-gebunden.
let flowAgentAmbientGlowUntil = 0;
let flowAgentNextAmbientGlowAt = 0;

function drawFlowAgents() {
  if (!agentTrailLayer) {
    return;
  }

  const ambientProgress = constrain((flowAgentAmbientGlowUntil - millis()) / 550, 0, 1);
  const ambientBoost = sin(ambientProgress * PI); // sanftes Auf- und wieder Abschwellen

  // Ruhezustand fast unsichtbar, bei Bewegung deutlich heller/farbiger,
  // beim Herzschlag kurzer, elektrischer Aufflacker-Effekt
  // Gedaempft gegenueber der urspruenglichen Fassung (30 / 190 / 130 / Faktor 1.3). Das
  // System soll ganz entspannt im Hintergrund laufen: Die Spuren bleiben als feines Gewebe
  // sichtbar, aber die Helligkeit zuckt bei jedem Herzschlag nicht mehr hoch - dieses
  // Mitzucken war ein Hauptgrund, warum das Bild chaotisch wirkte.
  const restingAlpha = 24;
  const motionAlpha = motionAmount * 112;
  // Der Anteil, der am Herzschlag haengt, bleibt bewusst niedrig: Er sorgt sonst dafuer,
  // dass das ganze Gewebe im Takt mitzuckt, und genau das machte das Bild unruhig. Heller
  // wird hier also die Grundhelligkeit, nicht das Flackern.
  const beatFlicker = beatPulse * 24;
  const totalAlpha = (restingAlpha + motionAlpha + beatFlicker) * 0.95 + ambientBoost * 22;
  const totalWeight = 0.55 + motionAmount * 0.75 + beatPulse * 0.35 + ambientBoost * 0.18;

  agentTrailLayer.push();
  agentTrailLayer.noStroke();
  agentTrailLayer.fill(1, 3, 8, 8);
  agentTrailLayer.rect(0, 0, width, height);
  for (let index = 0; index < flowAgents.length; index += 1) {
    flowAgents[index].currentAlpha = totalAlpha;
    flowAgents[index].currentWeight = totalWeight;
    flowAgents[index].update();
  }
  agentTrailLayer.pop();
  image(agentTrailLayer, 0, 0);
}

function getEffectColor(index) {
  const palette = [
    [255, 77, 139],
    [78, 211, 255],
    [169, 119, 255],
    [255, 191, 82],
    [81, 242, 190]
  ];
  return palette[index % palette.length];
}

// Jump Walkers — originalgetreu nach P_2_2_1_01, mit freier Bewegung statt 8 fixer Richtungen
// Generative Gestaltung, Benedikt Groß, Hartmut Bohnacker, Julia Laub, Claudius Lazzeroni
// with contributions by Joey Lee and Niels Poldervaart
// ISBN: 978-3-87439-902-9 — http://www.generative-gestaltung.de
// Licensed under Apache License 2.0
//
// Original-Prinzip: ein "duemmlicher" Agent macht bei jedem Frame mehrere Schritte in eine
// freie, zufaellige Richtung und hinterlaesst dabei transparente Kreise. Jeder Ast tapert von
// dick am Ansatzpunkt zu duenn an der wachsenden Spitze, statt insgesamt mit der Zeit immer
// dicker zu werden. Im Original steuert die Maus-X-Position, wie viele Schritte pro Frame
// gemacht werden. Hier uebernimmt das der BPM-Wert: ruhiger Puls = wenige Schritte, hoher Puls
// = viele Schritte. Die Spur wird NIE geloescht (wie im Original) - sie waechst ueber die
// gesamte Ausstellung. Ab und zu spaltet ein Walker an seiner aktuellen Position einen neuen
// Kind-Walker ab (mit eigener, frisch dicker Wurzel), so wachsen aus bestehenden Aesten
// sichtbar weitere Aeste heraus (bis JUMP_WALKER_MAX erreicht ist).
const JUMP_WALKER_MAX = 340;
const JUMP_WALKER_SPAWN_CHANCE = 0.008;
const JUMP_WALKER_GLOW_DURATION_MS = 260;
const JUMP_WALKER_TAPER_DISTANCE = 640;
// Strecke, nach der eine anfaengliche Richtungs-Vorgabe (directionalBiasAngle) komplett
// verblasst ist. Ohne dieses Verblassen zog ein einmal ausgerichteter Walker fuer den
// Rest seines Lebens stur in dieselbe Richtung weiter - sichtbar als durchgehende,
// gerade Linie quer durch den ganzen Bildschirm, die mit wachsender Sternanzahl (mehr
// ausgerichtete Walker durch den 200-Sterne-Ausbruch, siehe unten) immer haeufiger auffiel.
const JUMP_WALKER_BIAS_FADE_DISTANCE = 420;

// Fuegt einen neuen Walker hinzu und weicht dabei bei Bedarf dem aeltesten Walker, statt
// wie beim normalen Spawnen (Selbst-Spawn, Herzschlag) einfach nichts zu tun, wenn
// JUMP_WALKER_MAX erreicht ist. NUR fuer den seltenen, bewussten 200-Sterne-Ausbruch (siehe
// handleSensorData) gedacht, damit der IMMER seine vollen 42 Walker bekommt - fuer die
// haeufigen Spawn-Pfade waere das falsch: deren sehr hohe Spawn-Rate wuerde bei staendigem
// Verdraengen zu einer sich selbst verstaerkenden Kettenreaktion fuehren (an bereits dichten
// Stellen entstehen Kinder immer wieder genau dort), sichtbar als eine einzelne, gewaltig
// anwachsende Wolke statt gleichmaessig verteilter Aeste.
function spawnJumpWalker(walker) {
  if (jumpWalkers.length >= JUMP_WALKER_MAX) {
    jumpWalkers.shift();
  }
  jumpWalkers.push(walker);
}

class JumpWalker {
  constructor(x, y) {
    this.x = x !== undefined ? x : width / 2 + random(-40, 40);
    this.y = y !== undefined ? y : height / 2 + random(-40, 40);
    this.distanceTraveled = 0;
    this.glowUntil = 0;
    // Wenn gesetzt, bewegt sich der Walker bevorzugt in diese Richtung statt komplett
    // zufaellig - genutzt fuer die periodische gerichtete Ausbreitungswelle (siehe triggerBeat)
    this.directionalBiasAngle = null;
    // Optionale feste Gluehfarbe (z.B. fuer den periodischen P_2_2_1_02-Ausbruch), die
    // statt der ortsabhaengigen Standardfarbe verwendet wird - siehe drawJumpWalkerGlows()
    this.forceGlowColor = null;
  }

  update(stepsThisFrame, stepSize, baseDiameter, tipDiameter) {
    walkerLayer.noStroke();

    // Durchmesser haengt von der seit dem Ansatzpunkt zurueckgelegten Strecke ab, nicht vom Alter
    const taperDiameter = () => lerp(baseDiameter, tipDiameter, 1 - exp(-this.distanceTraveled / JUMP_WALKER_TAPER_DISTANCE));
    let currentDiameter = taperDiameter();

    // Nur einmal pro Frame statt einmal pro einzelnem Schritt berechnet - bei bis zu 340
    // Walkern und 6 Schritten/Frame waren das sonst bis zu ueber 4000 zusaetzliche
    // noise()-Aufrufe pro Frame (spuerbar langsamer, siehe "sehr laggy"-Rueckmeldung).
    // Da sich Position/distanceTraveled innerhalb eines einzelnen Frames nur minimal
    // aendern, macht die Wiederverwendung desselben Werts fuer alle Schritte eines Frames
    // optisch praktisch keinen Unterschied.
    const noiseAngle = noise(this.x * 0.003, this.y * 0.003, this.distanceTraveled * 0.001) * TWO_PI * 2;
    const spawnNoise = noise(this.x * 0.005, this.y * 0.005);

    for (let i = 0; i < stepsThisFrame; i += 1) {
      let stepAngle;
      if (this.directionalBiasAngle !== null) {
        const biasStrength = exp(-this.distanceTraveled / JUMP_WALKER_BIAS_FADE_DISTANCE);
        if (biasStrength < 0.02) {
          // Richtung ist komplett verblasst - ab jetzt frei und organisch weiterwandern
          this.directionalBiasAngle = null;
          stepAngle = random(TWO_PI);
        } else {
          const spread = lerp(PI * 0.55, TWO_PI, 1 - biasStrength);
          stepAngle = this.directionalBiasAngle + (random() - 0.5) * spread;
        }
      } else {
        stepAngle = noiseAngle * 0.7 + random(TWO_PI) * 0.3;
      }
      this.x += cos(stepAngle) * stepSize;
      this.y += sin(stepAngle) * stepSize;
      this.distanceTraveled += stepSize;

      if (this.x > width) this.x = 0;
      if (this.x < 0) this.x = width;
      if (this.y < 0) this.y = height;
      if (this.y > height) this.y = 0;

      currentDiameter = taperDiameter();
      const localColor = getColorAtPosition(this.x, this.y);
      walkerLayer.fill(localColor[0], localColor[1], localColor[2], 8);
      walkerLayer.circle(this.x, this.y, currentDiameter);

      if (jumpWalkers.length < JUMP_WALKER_MAX && random() < JUMP_WALKER_SPAWN_CHANCE * getSessionGrowth() * spawnNoise * 2) {
        const child = new JumpWalker(this.x, this.y);
        child.glowUntil = millis() + JUMP_WALKER_GLOW_DURATION_MS;
        jumpWalkers.push(child);
      }
    }

    // Vibration: der Kreis zittert leicht an Ort und Stelle, auch wenn er sich
    // gerade nicht fortbewegt (kein neuer Herzpuls) - wirkt "lebendig", statt eingefroren
    const vibrationX = random(-1.4, 1.4);
    const vibrationY = random(-1.4, 1.4);
    const vibrationColor = getColorAtPosition(this.x, this.y);
    walkerLayer.fill(vibrationColor[0], vibrationColor[1], vibrationColor[2], 8);
    walkerLayer.circle(this.x + vibrationX, this.y + vibrationY, currentDiameter * 0.7);
  }
}

// P_2_2_1_01: sichtbare, additive Leucht-Punkte fuer Walker, die gerade neu entstanden
// sind oder beim Herzschlag ausgewaehlt wurden - haeufig und deutlich sichtbar.
function drawJumpWalkerGlows() {
  push();
  blendMode(ADD);
  noStroke();
  for (let index = 0; index < jumpWalkers.length; index += 1) {
    const walker = jumpWalkers[index];
    if (millis() >= walker.glowUntil) {
      continue;
    }
    const glowRemaining = constrain((walker.glowUntil - millis()) / JUMP_WALKER_GLOW_DURATION_MS, 0, 1);
    const localColor = walker.forceGlowColor || getColorAtPosition(walker.x, walker.y);
    fill(
      min(255, localColor[0] + 100),
      min(255, localColor[1] + 100),
      min(255, localColor[2] + 100),
      glowRemaining * 200
    );
    circle(walker.x, walker.y, 18 * glowRemaining);
  }
  pop();
}

function drawJumpWalkers() {
  if (!walkerLayer) {
    return;
  }

  // Nur weiterlaufen, wenn gerade tatsaechlich frische Sensordaten ankommen -
  // ohne aktuellen Herzpuls bleibt die Position stehen (nur Vibration bleibt sichtbar)
  const hasFreshSignal = lastSensorMillis > 0 && millis() - lastSensorMillis < 2000;
  const stepsThisFrame = hasFreshSignal ? floor(lerp(0, 6, normalizedBpm)) : 0;
  const stepSize = 0.85 + normalizedBpm * 0.75;
  // Ansatzpunkt (unten) dick, Spitze (oben) schlank - siehe JumpWalker.update()
  // Ansatzpunkt (unten) dick, Spitze (oben) schlank - siehe JumpWalker.update()
  const baseDiameter = (1.1 + normalizedBpm * 1.4) * 2.5;
  const tipDiameter = baseDiameter * 0.22;

  for (const walker of jumpWalkers) {
    walker.update(stepsThisFrame, stepSize, baseDiameter, tipDiameter);
  }
  image(walkerLayer, 0, 0);
}

// Diffusion Aggregation — originalgetreu nach P_2_2_4_01
// Generative Gestaltung, Benedikt Groß, Hartmut Bohnacker, Julia Laub, Claudius Lazzeroni
// with contributions by Joey Lee and Niels Poldervaart
// ISBN: 978-3-87439-902-9 — http://www.generative-gestaltung.de
// Licensed under Apache License 2.0
//
// EIGENES Verfahren, nicht mehr das Nearest-Neighbour-Prinzip des Originalbeispiels (das
// urspruenglich hier stand): Ein Kandidatenpunkt, der sich seinen naechsten Nachbarn aus
// der gesamten Historie sucht, geriet in dieser Anwendung wiederholt in eine Sackgasse -
// je dichter die Struktur wurde, desto haeufiger scheiterte der Versuch an bereits
// belegten Stellen, und der betroffene Knoten wurde nach mehreren Fehlversuchen dauerhaft
// aus der Wachstumsliste entfernt. Sobald das ALLEN sieben Aesten gleichzeitig passierte
// (typischerweise um die 300-400 Sterne), blieb keine Anlagerungsstelle mehr uebrig, und
// es konnte nie wieder ein neuer Knoten entstehen - kein Verlangsamen, sondern ein
// endgueltiger Stillstand ohne Weg zurueck.
//
// Stattdessen waechst hier jeder Ast wie ein echter Trieb weiter: neue Knoten entstehen
// ausschliesslich an den SPITZEN (branch.tips), nie mitten im bereits gewachsenen Geaest.
// Das ist der entscheidende Punkt - eine fruehere Fassung waehlte den Ausgangspunkt
// gleichverteilt aus allen Knoten des Astes, und weil die allermeisten Knoten im dichten
// Inneren liegen, landeten fast alle Wachstumsversuche dort, wo ohnehin kein Platz mehr
// ist. Das Ergebnis war ein Geaest, das sich zu einem Klumpen um die Kugel verdichtete,
// statt sich auszubreiten, und dessen Wachstum immer traeger wurde. Eine Spitze, die einen
// Kindknoten setzt, gibt ihre Rolle an dieses Kind weiter und wird selbst zu Innenholz -
// dadurch wandert das Wachstum von allein nach aussen. Gelegentliches Gabeln erzeugt
// zusaetzliche Spitzen und damit Seitenzweige.
//
// Ein Aussterben ist strukturell ausgeschlossen: Eine Spitze wird nur dann aus der Liste
// genommen, wenn sie gleichzeitig durch ihr Kind ersetzt wird. Bleibt einer Spitze wirklich
// kein Platz mehr, treibt der Ast stattdessen an einer anderen Stelle neu aus (wie ein
// Schlafauge an echtem Holz), statt die letzte Spitze zu verlieren.
// Wie eingeengt eine Stelle ist, und in welche Richtung dort der meiste Platz liegt.
//
// Das ist das Werkzeug gegen das Steckenbleiben. Vorher wurde immer die AEUSSERSTE Spitze
// als neue Wachstumsstelle genommen, in der Annahme, dort sei am meisten Luft. Die Messung
// zeigte das Gegenteil: Nach einer Weile liegt die aeusserste Spitze zwangslaeufig am
// Bildrand oder in einer Ecke - nach aussen blockiert der Rand, nach innen das eigene
// Geaest. Ein Neustart genau dort steht sofort wieder still. Deshalb wird jetzt gemessen
// statt geraten.
function measureFreeSpace(x, y) {
  const searchPool = diffusionNodeHistory.slice(-600);
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (const node of searchPool) {
    if (dist(x, y, node.x, node.y) < DIFFUSION_FREE_SPACE_RADIUS) {
      count += 1;
      sumX += node.x - x;
      sumY += node.y - y;
    }
  }

  // Fluchtrichtung: genau entgegengesetzt zum Schwerpunkt der Nachbarn. Dorthin ist per
  // Konstruktion der meiste Platz.
  let escapeX = count > 0 ? -sumX / count : 0;
  let escapeY = count > 0 ? -sumY / count : 0;
  let crowding = count;

  // Der Bildrand blockiert genauso zuverlaessig wie ein Nachbarknoten, taucht aber in der
  // Nachbarzaehlung nicht auf - eine Spitze in der Bildecke haette sonst rechnerisch viel
  // Platz und praktisch fast keine freie Richtung. Er wird daher wie eine dichte
  // Nachbarschaft gewertet und zieht die Fluchtrichtung ins Bild hinein.
  const edgeDistance = min(min(x, width - x), min(y, height - y));
  if (edgeDistance < DIFFUSION_FREE_SPACE_RADIUS) {
    const nearness = 1 - edgeDistance / DIFFUSION_FREE_SPACE_RADIUS;
    crowding += nearness * 40;
    const inwardX = width * 0.5 - x;
    const inwardY = height * 0.5 - y;
    const inwardLength = max(1, sqrt(inwardX * inwardX + inwardY * inwardY));
    escapeX += (inwardX / inwardLength) * nearness * DIFFUSION_FREE_SPACE_RADIUS;
    escapeY += (inwardY / inwardLength) * nearness * DIFFUSION_FREE_SPACE_RADIUS;
  }

  const escapeAngle = escapeX === 0 && escapeY === 0 ? random(TWO_PI) : atan2(escapeY, escapeX);
  return { crowding, escapeAngle };
}

// Sucht im bisherigen Holz eines Astes die Stelle mit dem meisten freien Platz und gibt sie
// samt der Richtung zurueck, in die von dort aus Platz ist. Wie ein Schlafauge an echtem
// Holz: Kommt der Trieb an der Spitze nicht mehr weiter, treibt der Ast weiter innen dort
// aus, wo eine Luecke ist. Es werden nicht alle Knoten geprueft, sondern eine gleichmaessige
// Stichprobe mit zufaelligem Startversatz - das haelt die Kosten konstant und sorgt dafuer,
// dass nicht jeder Aufruf dieselbe Stelle findet und dort alle Spitzen aufeinanderstapelt.
function findFreestNode(branch, sampleCount) {
  const nodes = branch.nodes;
  const stride = max(1, floor(nodes.length / sampleCount));
  const offset = floor(random(stride));
  let best = nodes[nodes.length - 1];
  let bestMeasure = measureFreeSpace(best.x, best.y);

  for (let index = offset; index < nodes.length; index += stride) {
    const candidate = nodes[index];
    // Knoten, die schon Spitze sind, ueberspringen - sonst saessen zwei Spitzen auf
    // demselben Punkt und wuerden sich gegenseitig blockieren.
    if (branch.tips.indexOf(candidate) !== -1) {
      continue;
    }
    const measure = measureFreeSpace(candidate.x, candidate.y);
    if (measure.crowding < bestMeasure.crowding) {
      bestMeasure = measure;
      best = candidate;
    }
  }

  return { node: best, escapeAngle: bestMeasure.escapeAngle };
}

// Wie stark ein Trieb bei seinem naechsten Knoten abbiegt, in Grad.
//
// Das ist die Antwort auf die hartnaeckigsten geraden Linien im ganzen Projekt. Vorher
// wurde die Richtung jedes Schrittes aus der eigenen Richtung der Spitze UND dem Winkel
// "von der Kugel nach aussen" gemischt (Gewichtung 60/40). Dieser Aussenanteil wirkt aber
// wie eine Rueckstellfeder: Der zufaellige Schlenker eines Schrittes wird im naechsten
// sofort wieder zur Verbindungslinie Kugel-Spitze zurueckgezogen. Ein Zweig KONNTE damit
// gar nicht abbiegen - er pendelte nur um einen radialen Strahl und lief zwangslaeufig fast
// gerade nach aussen. Je groesser der Knotenabstand, desto laenger und auffaelliger diese
// Strahlen.
//
// Stattdessen wird jetzt nicht die Richtung zufaellig veraendert, sondern die KRUEMMUNG:
// Jeder Trieb traegt eine Drehrate, die sich von Knoten zu Knoten nur langsam verschiebt.
// Dadurch biegt er ueber viele Schritte in dieselbe Richtung und erst allmaehlich in die
// andere - also geschwungene Zweige statt Strahlen. Der Faktor 0.9 zieht die Drehrate
// sanft zur Mitte zurueck, damit sie sich nicht dauerhaft am Anschlag festfaehrt und der
// Trieb sich zu einer Schnecke einrollt.
function nextTurnRate(tip, core) {
  const previousTurn = typeof tip.turnRate === 'number' ? tip.turnRate : random(-6, 6);

  // Sanfter Drang nach aussen - aber ueber die KRUEMMUNG statt ueber die Richtung. Ohne
  // ihn blieb das Geaest als dichter Ballen um die Kugel stehen (gemessen: Reichweite hielt
  // bei 460px, waehrend die Knotenzahl von 342 auf 506 stieg), weil ein reiner Zufallslauf
  // der Richtung im Mittel nirgendwohin fuehrt. Entscheidend ist, WIE der Drang wirkt: Er
  // biegt einen nach innen laufenden Trieb ueber mehrere Knoten hinweg allmaehlich nach
  // aussen, statt seine Richtung bei jedem Schritt zu korrigieren. Nur die zweite Variante
  // wirkt als Rueckstellfeder und erzeugt die geraden Strahlen; diese hier nicht.
  const outwardAngle = atan2(tip.y - core.centerY, tip.x - core.centerX);
  let headingError = tip.growthAngle - outwardAngle;
  while (headingError > PI) {
    headingError -= TWO_PI;
  }
  while (headingError < -PI) {
    headingError += TWO_PI;
  }
  // 0 = laeuft genau nach aussen, 1 = laeuft genau auf die Kugel zu. Quadriert, damit der
  // Drang in der aeusseren Haelfte praktisch nicht spuerbar ist und der Trieb dort voellig
  // frei schwingen kann.
  const inwardness = abs(headingError) / PI;
  const outwardBias = (headingError > 0 ? -1 : 1) * inwardness * inwardness * 7;

  const turnRate = constrain(previousTurn * 0.9 + random(-4, 4) + outwardBias, -18, 18);

  // Eine Drehrate nahe null waere wieder eine Gerade, deshalb biegt der Trieb immer
  // mindestens ein Stueck weit.
  if (abs(turnRate) < 3) {
    return turnRate < 0 ? -3 : 3;
  }
  return turnRate;
}

function placeDiffusionChild(branch, parent, angle, radius, core) {
  // 0.98 statt 1.12: Die gezeichnete Kugel schwankt um das 0.98- bis 1.01-fache ihres
  // Basisradius, der Ansatzring liegt damit genau auf ihrem Rand. Weil die Knoten VOR der
  // Kugel gezeichnet werden, verdeckt sie die innersten - das Geaest tritt unter ihrem Rand
  // hervor, statt in einigem Abstand um sie herum zu schweben.
  const attachCoreRadius = getBaseEclipseRadius() * 0.98;
  const searchPool = diffusionNodeHistory.slice(-800);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    // Bei Fehlschlag abwechselnd nach links und rechts ausweichen, mit wachsendem Winkel
    // (0, +40, -40, +80, -80 ... Grad). Einseitiges Drehen reichte nicht: ein Trieb, der in
    // eine Bildschirmecke laeuft, muss teils um mehr als 90 Grad zurueckgelenkt werden.
    const step = ceil(attempt / 2) * 40;
    const tryAngle = angle + radians(attempt % 2 === 1 ? step : -step);
    // Deutlicher Abstand statt Beruehrung: aneinanderklebende Knoten verschmolzen optisch zu
    // gedraengten Klumpen. Mit Luft dazwischen liest man die einzelnen Knoten und die Linie
    // des Zweiges, den sie bilden - das Geaest wirkt luftiger und man sieht die Struktur.
    const nodeGap = (parent.r + radius) + DIFFUSION_NODE_SPACING;
    const x = parent.x + cos(tryAngle) * nodeGap;
    const y = parent.y + sin(tryAngle) * nodeGap;

    if (dist(x, y, core.centerX, core.centerY) < attachCoreRadius + radius) {
      continue; // nie unter der Herz-Kugel platzieren
    }

    // Nicht aus dem Bild hinauswachsen: Ein Trieb, der den Rand erreicht, wandert sonst
    // unsichtbar ins Leere weiter und ist fuer die Ausstellung verloren. Da der Winkel bei
    // jedem Fehlversuch weitergedreht wird, biegt der Trieb hier stattdessen am Rand ab und
    // waechst wieder ins Bild hinein.
    const edgeMargin = radius + 4;
    if (x < edgeMargin || x > width - edgeMargin || y < edgeMargin || y > height - edgeMargin) {
      continue;
    }

    let blocked = false;
    for (const node of searchPool) {
      if (node === parent) {
        continue;
      }
      if (dist(x, y, node.x, node.y) < (node.r + radius) * 0.85) {
        blocked = true;
        break;
      }
    }
    if (blocked) {
      continue;
    }

    const color = getColorAtPosition(x, y);
    const newNode = {
      x,
      y,
      r: radius,
      color,
      phase: random(TWO_PI),
      bornAt: millis(),
      parent,
      branchId: branch.id,
      growthAngle: tryAngle
    };
    diffusionNodes.push(newNode);
    diffusionNodeHistory.push(newNode);
    branch.nodes.push(newNode);
    branch.nodeCount += 1;
    return newNode;
  }
  return null; // an dieser Stelle gerade kein Platz - die Spitze bleibt trotzdem erhalten
}

function addDiffusionNode() {
  // Den Zufallsgenerator mit einem echt zufaelligen Wert neu saeen, BEVOR hier irgendetwas
  // gezogen wird.
  //
  // Das ist die Ursache des wiederkehrenden "Problems ab 350 Sternen": p5 hat EINEN globalen
  // Generator, und zwei andere Stellen setzen ihn staendig auf feste Werte zurueck -
  // drawDiagonalGrid() beendet jedes Bild mit randomSeed(ECLIPSE_SEED), growAggregation()
  // saet bei jedem Stern neu. Dadurch bekam diese Funktion praktisch immer dieselbe
  // Zahlenfolge und zog immer denselben Ast. Gemessen traf die Auswahl nur in 16 Prozent der
  // Faelle den kleinsten Ast statt in ueber 90; ein Ast wuchs auf 65 Knoten, waehrend vier
  // andere bei 18 bis 19 stehenblieben und das Bild sich nur noch an einer Stelle
  // weiterentwickelte. Math.random() ist von randomSeed() nicht betroffen und bricht diese
  // Kopplung auf.
  randomSeed(floor(Math.random() * 2147483647));

  const core = getEclipseCore();
  // Hoher BPM -> groessere Kreise. Es skalieren BEIDE Grenzen mit dem Puls, nicht nur die
  // obere: vorher lag die Untergrenze fest bei 1.5 und die Obergrenze erreichte ihren
  // Maximalwert erst bei BPM 140, was praktisch nie vorkommt - real bewegten sich die
  // Radien dadurch fast immer um 4px, also durchgehend winzig und ohne sichtbaren Bezug
  // zum Puls. Mit mitwachsender Untergrenze sind die Knoten insgesamt groesser und ein
  // hoher Puls ist als deutlich groebere Koerner erkennbar.
  // Kleinere Knoten als vorher (2.5-5 bis 7-14). Der Bezug zum Puls bleibt erhalten: Beide
  // Grenzen wachsen weiterhin mit, ein hoher Puls ist also nach wie vor als groebere Koerner
  // zu erkennen - nur eben insgesamt feiner.
  const radius = random(lerp(1.6, 3.2, normalizedBpm), lerp(4.5, 9, normalizedBpm));

  // Kleineren von zwei zufaellig gezogenen Aesten bevorzugen, damit alle sieben Wurzeln
  // ungefaehr gleich stark sichtbar bleiben, statt dass einer in eine freiere Richtung
  // stark davonzieht und die anderen dadurch unauffaellig wirken.
  const firstPick = diffusionBranches[floor(random(diffusionBranches.length))];
  const secondPick = diffusionBranches[floor(random(diffusionBranches.length))];
  const branch = secondPick.nodeCount < firstPick.nodeCount ? secondPick : firstPick;

  // Ausgangspunkt ist IMMER eine aktive Spitze, nie ein Knoten aus dem Inneren. Von zwei
  // zufaellig gezogenen Spitzen gewinnt die, die noch am WENIGSTEN weit von der Kugel weg
  // ist. Dadurch holen zurueckgebliebene Triebe staendig auf, alle Zweige bleiben ungefaehr
  // gleich lang, und die Wachstumszone wandert als geschlossener Ring nach aussen - genau
  // die kreisfoermige Ausbreitung, statt einzelner Triebe, die weit vorpreschen und den
  // Rest stehen lassen.
  const firstTipIndex = floor(random(branch.tips.length));
  const secondTipIndex = floor(random(branch.tips.length));
  const firstTip = branch.tips[firstTipIndex];
  const secondTip = branch.tips[secondTipIndex];
  const firstReach = dist(firstTip.x, firstTip.y, core.centerX, core.centerY);
  const secondReach = dist(secondTip.x, secondTip.y, core.centerX, core.centerY);
  const tipIndex = secondReach < firstReach ? secondTipIndex : firstTipIndex;
  const tip = branch.tips[tipIndex];

  // Richtung: Der Trieb behaelt seine Richtung bei und biegt dabei staendig weiter - siehe
  // nextTurnRate(). Dort steht auch, warum die fruehere Mischung aus eigener Richtung und
  // einem festen Zug nach aussen zwangslaeufig gerade Linien erzeugte.
  const turnRate = nextTurnRate(tip, core);
  let angle = tip.growthAngle + radians(turnRate);

  // Zwei Ausnahmen, in denen die Richtung doch vorgegeben wird. Beide greifen nur am Rand
  // des erlaubten Bereichs und damit selten - sie sind Leitplanken, keine Rueckstellfeder,
  // und erzeugen deshalb keine Strahlen: dicht an der Herz-Kugel nach aussen, damit ein
  // Trieb nicht in sie hineinwaechst, und dicht am Bildrand zurueck ins Bild. Ohne die
  // zweite entstand am Rand ein gepunkteter Rahmen um das ganze Bild: Der Trieb wurde von
  // der Randpruefung in placeDiffusionChild um genau 40 Grad abgelenkt und lief dann
  // parallel zur Kante immer weiter.
  const edgeDistance = min(min(tip.x, width - tip.x), min(tip.y, height - tip.y));
  const coreDistance = dist(tip.x, tip.y, core.centerX, core.centerY);
  if (coreDistance < getBaseEclipseRadius() * 1.6) {
    angle = atan2(tip.y - core.centerY, tip.x - core.centerX) + radians(random(-30, 30));
  } else if (edgeDistance < DIFFUSION_FREE_SPACE_RADIUS) {
    angle = atan2(height * 0.5 - tip.y, width * 0.5 - tip.x) + radians(random(-45, 45));
  }

  const child = placeDiffusionChild(branch, tip, angle, radius, core);

  if (!child) {
    // Kein Platz: Die Spitze bleibt bestehen und darf es spaeter erneut versuchen. Erst
    // wenn sie offensichtlich vollstaendig eingeschlossen ist, treibt der Ast an einer
    // anderen, zufaelligen Stelle neu aus - so kann ein Ast nie endgueltig verstummen.
    tip.failedGrowth = (tip.failedGrowth || 0) + 1;
    if (tip.failedGrowth >= 8) {
      // Eine festgefahrene Spitze wird VERSETZT, nie geloescht. Vorher wurde sie entfernt,
      // solange der Ast noch andere Spitzen hatte - dadurch sank die Zahl der Spitzen mit
      // der Zeit unaufhaltsam (gemessen: von 64 auf 7), bis am Ende ein einziger duenner
      // Trieb uebrig war und das Geaest weder dicht wirkte noch weiterwachsen konnte.
      // Stattdessen treibt der Ast jetzt an seiner freiesten Stelle neu aus, in die
      // gemessene Richtung mit dem meisten Platz.
      const { node: fresh, escapeAngle } = findFreestNode(branch, 24);
      fresh.failedGrowth = 0;
      fresh.growthAngle = escapeAngle;
      fresh.turnRate = random(-8, 8);
      branch.tips[tipIndex] = fresh;
    }
    return;
  }

  // Die Spitze hat ausgetrieben: Ihr Kind uebernimmt die Rolle, sie selbst wird Innenholz.
  // Genau dadurch wandert die Wachstumszone nach aussen, statt sich im Inneren zu stauen.
  // Die Kruemmung wird dabei mit weitergegeben - ohne das wuerde jeder Knoten wieder bei
  // null anfangen und der Zweig bliebe trotz allem gerade.
  child.turnRate = turnRate;
  branch.tips[tipIndex] = child;

  // Haeufige Gabelungen - sie erzeugen die eigentliche Ast-und-Zweig-Textur. Der Deckel
  // liegt bewusst hoch: viele parallel wachsende Spitzen ergeben das dichte, verzweigte
  // Geaest. Weil die Auswahl oben immer den zurueckgebliebenen Trieb bevorzugt, bremsen
  // sich die vielen Spitzen dabei nicht gegenseitig aus, sondern ruecken gemeinsam als
  // Ring nach aussen.
  if (branch.tips.length < 26 && random() < 0.2) {
    const forkSign = random() < 0.5 ? -1 : 1;
    const forkAngle = angle + radians(forkSign * random(35, 70));
    const sideShoot = placeDiffusionChild(branch, tip, forkAngle, radius, core);
    if (sideShoot) {
      // Der Seitentrieb biegt in die GEGENRICHTUNG des Haupttriebs ab, damit sich die
      // beiden nicht nebeneinander her entwickeln, sondern auseinanderlaufen.
      sideShoot.turnRate = -turnRate;
      branch.tips.push(sideShoot);
    }
  }
}

// Legt die sieben Aeste an: je ein Startpunkt gleichmaessig verteilt auf dem Rand der
// Herz-Kugel, jeder mit eigener, von den anderen unabhaengiger Wachstumsfront.
function seedDiffusionAggregation() {
  const core = getEclipseCore();
  // Maximaler Kugelradius statt des aktuellen: setup() laeuft, bevor updateEclipseState()
  // den Radius das erste Mal setzt, und die Kugel pulsiert spaeter bis auf das 1.3-fache
  // ihrer Basisgroesse. Auf einem kleineren Radius platzierte Seeds lagen deshalb bei jedem
  // Herzschlag unter der Kugel und waren unsichtbar.
  // 0.98 statt 1.12: Die gezeichnete Kugel schwankt um das 0.98- bis 1.01-fache ihres
  // Basisradius, der Ansatzring liegt damit genau auf ihrem Rand. Weil die Knoten VOR der
  // Kugel gezeichnet werden, verdeckt sie die innersten - das Geaest tritt unter ihrem Rand
  // hervor, statt in einigem Abstand um sie herum zu schweben.
  const attachCoreRadius = getBaseEclipseRadius() * 0.98;
  for (let i = 0; i < DIFFUSION_BRANCH_COUNT; i += 1) {
    const seedAngle = (i / DIFFUSION_BRANCH_COUNT) * TWO_PI;
    const x = core.centerX + cos(seedAngle) * attachCoreRadius;
    const y = core.centerY + sin(seedAngle) * attachCoreRadius;
    const color = getColorAtPosition(x, y);
    const seedNode = {
      x,
      y,
      r: random(1.5, 4),
      color,
      phase: random(TWO_PI),
      bornAt: millis(),
      branchId: i,
      growthAngle: seedAngle, // zeigt radial von der Kugel weg, wie beim Ansatzpunkt selbst
      // Jede Wurzel biegt von Anfang an anders, damit die sieben Aeste nicht als sieben
      // gleichfoermige Strahlen losgehen.
      turnRate: random(-8, 8)
    };
    diffusionNodes.push(seedNode);
    diffusionNodeHistory.push(seedNode);
    diffusionBranches.push({ id: i, nodes: [seedNode], tips: [seedNode], nodeCount: 1 });
  }
}

// Startet eine neue Wachstums-Generation: An der freiesten Stelle jedes Astes entsteht ein
// kleiner Planet, und der Ast waechst von dort aus voellig neu weiter.
//
// Das ist die eigentliche Loesung fuer das immer wiederkehrende Problem, dass das Wachstum
// nach einer Weile versandet. Jede einzelne Wachstumsfront wird mit der Zeit zwangslaeufig
// langsamer: Je mehr Zweige um sie herum stehen, desto haeufiger findet ein neuer Knoten
// keinen freien Platz mehr. Dagegen hilft kein Nachjustieren an den Parametern, weil die
// Ursache die Dichte selbst ist. Statt also zu versuchen, EINE Struktur ewig weiterwachsen
// zu lassen, wird hier regelmaessig ein frischer Ursprung genau dort gesetzt, wo per
// Messung gerade nachweislich Platz ist. Von dort startet das Wachstum mit einer
// unbelasteten Spitze neu und laeuft wieder mit voller Geschwindigkeit. Weil sich das
// beliebig oft wiederholt, gibt es keine Obergrenze mehr.
function startDiffusionGeneration() {
  for (const branch of diffusionBranches) {
    // Der neue Ursprung ist die FREIESTE Stelle des Astes, nicht die aeusserste. Genau
    // daran scheiterte die erste Fassung: Die aeusserste Spitze liegt spaeter immer am
    // Bildrand, wo es nach aussen wie nach innen dicht ist, und der Neustart stand sofort
    // wieder still (gemessen: nur noch 7 statt 40 neue Knoten pro 40 Sterne).
    const { node: origin, escapeAngle } = findFreestNode(branch, 60);

    // Hier entstand bisher zusaetzlich ein kleiner Ast-Planet. Die Planeten sind
    // abgeschaltet und ihre Liste wird nirgends aufgeraeumt - sie waere unsichtbar
    // weitergewachsen.

    // Ab hier waechst der Ast von diesem Punkt aus weiter - und zwar in die gemessene
    // Richtung mit dem meisten Platz. Alle bisherigen Spitzen geben ihre Rolle ab, das
    // bereits gewachsene Geaest bleibt unveraendert stehen.
    origin.failedGrowth = 0;
    origin.growthAngle = escapeAngle;
    origin.turnRate = random(-8, 8);
    branch.tips = [origin];
  }
}

// Diffusion Aggregation — originalgetreu nach P_2_2_4_01
// Im Original: neue, zufaellig platzierte Kreise "wandern" zum naechstgelegenen bestehenden
// Kreis und lagern sich dort an dessen Rand an - es entsteht eine baumartige, organisch
// wachsende Struktur aus dem Zentrum heraus. Kreise bleiben fest an ihrem Platz (kein
// Umherwandern wie zuvor), ganz wie im Original. BPM steuert Kreisgroesse und Wachstumsrate.
let diffusionStaticLayer;
const DIFFUSION_FLASH_DURATION_MS = 500;
const DIFFUSION_SETTLE_MS = 1200;

function createDiffusionStaticLayer(previousLayer) {
  diffusionStaticLayer = createGraphics(width, height);
  diffusionStaticLayer.clear();
  if (previousLayer) {
    diffusionStaticLayer.image(previousLayer, 0, 0, width, height);
    previousLayer.remove();
  }
}

// Wie schnell und wie weit ein Kreis um seinen Platz zittert. Bewusst langsam und winzig:
// Es soll leben, nicht flimmern. Bei wenigen Zehntelpixeln pro Sekunde nimmt man die
// Bewegung eines einzelnen Kreises kaum wahr, das Feld als Ganzes wirkt dadurch aber
// atmend statt eingefroren.
const DIFFUSION_VIBRATION_SPEED = 0.0011;
const DIFFUSION_VIBRATION_AMOUNT = 1.6;
// So viele der zuletzt entstandenen Kreise werden einzeln gezeichnet und vibrieren.
const DIFFUSION_LIVE_COUNT = 600;
// Wie viele Kreise bereits dauerhaft eingebacken sind (Zeiger in diffusionNodeHistory).
let diffusionBakedCount = 0;

function drawDiffusionAggregation() {
  // Ein bewegliches Bild und ein wachsender Bestand vertragen sich schlecht: Vibrieren
  // koennen nur Kreise, die jedes Bild neu gezeichnet werden, und deren Zahl waechst ueber
  // eine Ausstellung ins Unbegrenzte. Deshalb hier ein wanderndes Fenster - die zuletzt
  // entstandenen sechshundert Kreise werden einzeln gezeichnet und zittern, alles Aeltere
  // wird genau einmal in einen Puffer eingebacken und danach als fertiges Bild aufgelegt.
  //
  // Das passt auch inhaltlich: Das Wachstum wandert nach aussen, das lebende Fenster liegt
  // also immer auf dem aeusseren, sichtbarsten Rand. Im dichten Inneren, wo eine
  // Zitterbewegung ohnehin untergeht, steht das Bild still. Der Aufwand pro Bild bleibt
  // dadurch konstant, egal ob tausend oder hunderttausend Kreise gesammelt wurden.
  const firstLiveIndex = max(0, diffusionNodeHistory.length - DIFFUSION_LIVE_COUNT);
  if (diffusionStaticLayer && diffusionBakedCount < firstLiveIndex) {
    diffusionStaticLayer.noStroke();
    for (; diffusionBakedCount < firstLiveIndex; diffusionBakedCount += 1) {
      const node = diffusionNodeHistory[diffusionBakedCount];
      diffusionStaticLayer.fill(node.color[0], node.color[1], node.color[2], 225);
      diffusionStaticLayer.circle(node.x, node.y, node.r * 2.15);
    }
  }
  if (diffusionStaticLayer) {
    image(diffusionStaticLayer, 0, 0);
  }

  const vibrationTime = millis();

  push();
  noStroke();
  for (let index = firstLiveIndex; index < diffusionNodeHistory.length; index += 1) {
    const node = diffusionNodeHistory[index];
    // Eigene Phase je Kreis - ohne sie zitterte das ganze Feld im Gleichschritt, was eher
    // wie ein wackelndes Bild als wie etwas Lebendiges aussieht.
    const x = node.x + sin(vibrationTime * DIFFUSION_VIBRATION_SPEED + node.phase) * DIFFUSION_VIBRATION_AMOUNT;
    const y = node.y + cos(vibrationTime * DIFFUSION_VIBRATION_SPEED * 0.83 + node.phase * 1.4) * DIFFUSION_VIBRATION_AMOUNT;

    if (x + node.r < 0 || x - node.r > width || y + node.r < 0 || y - node.r > height) {
      continue;
    }
    fill(node.color[0], node.color[1], node.color[2], 225);
    circle(x, y, node.r * 2.15);
  }
  pop();

  push();
  noStroke();
  // Nur alle 10 Frames werden abgelaufene Knoten tatsaechlich in den dauerhaften
  // diffusionStaticLayer uebertragen, statt jeden einzelnen Frame. Jedes Zeichnen IN
  // diesen Offscreen-Puffer macht ihn "dirty" und zwingt den Browser, ihn vor dem
  // naechsten Blit neu zu synchronisieren (Profiling zeigte ~120ms allein fuer
  // drawDiffusionAggregation() bei staendig gestaffelt ablaufenden Knoten, obwohl die
  // aktive Liste selbst winzig war) - das Buendeln reduziert, wie oft dieser teure
  // Sync ueberhaupt noetig ist. Ueberfaellige Knoten werden bis zu ihrem Uebertrag
  // weiterhin ganz normal auf dem Hauptcanvas mitgezeichnet, damit visuell nichts fehlt.
  const shouldSettleThisFrame = frameCount % 10 === 0;
  for (let index = diffusionNodes.length - 1; index >= 0; index -= 1) {
    const node = diffusionNodes[index];
    const age = millis() - node.bornAt;

    if (age > DIFFUSION_SETTLE_MS && shouldSettleThisFrame) {
      // Aus der Liste der "frischen" Knoten entfernen. Gezeichnet wird der Kreis dadurch
      // nicht weniger - das passiert oben aus diffusionNodeHistory. Diese Liste bleibt
      // aber wichtig, weil ihre Laenge an anderer Stelle die Erosion der Kugelkontur
      // steuert (siehe drawEclipse); ohne das Ausraeumen wuerde sie endlos wachsen und die
      // Kontur immer staerker ausfransen.
      diffusionNodes.splice(index, 1);
    }
  }
  pop();

  // Das helle Aufblitzen jedes neuen Kreises ist entfernt - es gehoerte zu den zuckenden
  // Elementen, die das Bild unruhig gemacht haben. Ein neuer Kreis erscheint jetzt einfach.
}

function toRgba(color, alpha) {
  return `rgba(${floor(color[0])}, ${floor(color[1])}, ${floor(color[2])}, ${alpha})`;
}

function drawVolumetricSphere(centerX, centerY, coreRadius, motionX, motionY, color) {
  const context = drawingContext;
  const lightX = centerX + motionX * coreRadius * 0.42 - coreRadius * 0.2;
  const lightY = centerY + motionY * coreRadius * 0.42 - coreRadius * 0.2;
  const rimColor = getDepthColor(color, 0.72, 1.12);
  const coreColor = getDepthColor(color, 0.18, 0.78);

  context.save();
  context.beginPath();
  context.arc(centerX, centerY, coreRadius, 0, TWO_PI);
  context.clip();

  context.fillStyle = 'rgba(0, 1, 4, 0.98)';
  context.fillRect(centerX - coreRadius, centerY - coreRadius, coreRadius * 2, coreRadius * 2);

  const bodyGradient = context.createRadialGradient(lightX, lightY, coreRadius * 0.04, centerX, centerY, coreRadius * 1.12);
  bodyGradient.addColorStop(0, toRgba(coreColor, 0.32));
  bodyGradient.addColorStop(0.38, toRgba(coreColor, 0.12));
  bodyGradient.addColorStop(0.72, 'rgba(0, 1, 4, 0.16)');
  bodyGradient.addColorStop(1, toRgba(rimColor, 0.62));
  context.fillStyle = bodyGradient;
  context.fillRect(centerX - coreRadius, centerY - coreRadius, coreRadius * 2, coreRadius * 2);

  const rimGradient = context.createRadialGradient(centerX, centerY, coreRadius * 0.58, centerX, centerY, coreRadius * 1.02);
  rimGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  rimGradient.addColorStop(0.72, 'rgba(0, 0, 0, 0)');
  rimGradient.addColorStop(1, toRgba(rimColor, 0.78 + beatPulse * 0.16));
  context.fillStyle = rimGradient;
  context.fillRect(centerX - coreRadius, centerY - coreRadius, coreRadius * 2, coreRadius * 2);

  const internalPulse = lerp(preBeatPulse, 1, beatPulse);
  const glowRadius = coreRadius * (0.15 + internalPulse * 0.21);
  const glowGradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, glowRadius);
  glowGradient.addColorStop(0, toRgba(getDepthColor(color, 1, 1.35), 0.22 + internalPulse * 0.48));
  glowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = glowGradient;
  context.fillRect(centerX - coreRadius, centerY - coreRadius, coreRadius * 2, coreRadius * 2);

  context.restore();
}

function drawEclipse() {
  const { centerX, centerY, coreRadius } = getEclipseCore();
  const zResponse = constrain(accelZ / ECLIPSE_ACCEL_REFERENCE, -1, 1);
  const motionX = constrain(accelX / ECLIPSE_ACCEL_REFERENCE, -1, 1);
  const motionY = constrain(accelY / ECLIPSE_ACCEL_REFERENCE, -1, 1);
  const coronaX = centerX + motionX * coreRadius * 0.12;
  const coronaY = centerY + motionY * coreRadius * 0.12;
  const motionColor = getColorAtPosition(centerX, centerY);
  const nervousness = normalizedBpm;
  const distortionFactor = 0.6 + nervousness * 2.8;
  const jitterFactor = 1 + nervousness * nervousness * 3.2;
  const angleStep = lerp(0.026, 0.16, nervousness);
  const facetCount = lerp(2.2, 17, nervousness);
  const time = millis() * (0.00016 + nervousness * 0.00075);
  const contourCount = 12;

  push();
  noFill();
  for (let contour = 0; contour < contourCount; contour += 1) {
    const contourProgress = contour / max(1, contourCount - 1);
    const contourRadius = coreRadius * (1.045 + contourProgress * 0.205);
    const noiseStrength = coreRadius * (0.009 + abs(zResponse) * 0.06) * distortionFactor * (0.45 + contourProgress * 0.85);
    const facetAmplitude = coreRadius * 0.022 * distortionFactor * (0.4 + contourProgress * 0.6);
    const directionalBias = coreRadius * (0.004 + abs(zResponse) * 0.02);
    const alpha = 12 + contourProgress * 28 + abs(zResponse) * 20;

    stroke(motionColor[0], motionColor[1], motionColor[2], alpha);
    strokeWeight(0.35 + contourProgress * 0.44 + abs(zResponse) * 0.32);
    beginShape();
    for (let angle = 0; angle <= TWO_PI + angleStep; angle += angleStep) {
      const noiseValue = map(
        noise(
          ECLIPSE_SEED + cos(angle) * 0.92 + contour * 3.1,
          ECLIPSE_SEED * 0.1 + sin(angle) * 0.92 + contour * 2.3,
          time + contour * 0.16 + zResponse * 0.7
        ),
        0,
        1,
        -1,
        1
      );
      const jitter = (noise(angle * 9.1 + contour, time * 2.4) - 0.5) * coreRadius * 0.03 * jitterFactor;
      const movementBias = cos(angle) * motionX + sin(angle) * motionY;
      const flicker = sin(angle * 5 + time * 10 + contour) * coreRadius * 0.0035;
      const spike = sin(angle * facetCount + time * 9 + contour) * facetAmplitude;
      const radius = contourRadius + noiseValue * noiseStrength + movementBias * directionalBias + flicker + spike + jitter;
      vertex(coronaX + cos(angle) * radius, coronaY + sin(angle) * radius);
    }
    endShape(CLOSE);
  }
  pop();

  const erosionProgress = constrain(diffusionNodes.length / 360, 0, 1);
  drawVolumetricSphere(centerX, centerY, coreRadius, motionX, motionY, motionColor);

  if (beatPulse > 0.015) {
    push();
    noFill();
    stroke(motionColor[0], motionColor[1], motionColor[2], 130 * beatPulse);
    strokeWeight(1 + beatPulse * 3);
    beginShape();
    for (let angle = 0; angle <= TWO_PI + 0.1; angle += 0.1) {
      const flashNoise = map(
        noise(ECLIPSE_SEED * 0.83 + cos(angle) * 1.7, ECLIPSE_SEED * 0.47 + sin(angle) * 1.7, time * 0.64),
        0,
        1,
        -1,
        1
      );
      const fracture = constrain(map(noise(ECLIPSE_SEED * 0.61 + cos(angle) * 2.2, ECLIPSE_SEED * 0.29 + sin(angle) * 2.2, time * 0.42), 0.46, 1, 0, 1), 0, 1);
      const radius = coreRadius * 1.025 + beatPulse * 7 + flashNoise * coreRadius * 0.025 - fracture * coreRadius * erosionProgress * 0.56;
      vertex(centerX + cos(angle) * radius, centerY + sin(angle) * radius);
    }
    endShape(CLOSE);
    pop();

    // Weicher, farbiger Glow-Ring: flackert bei jedem Beat kurz auf und verblasst dann sanft
    push();
    noFill();
    const glowFade = pow(beatPulse, 1.6);
    for (let ring = 0; ring < 3; ring += 1) {
      const ringSpread = 1 + ring * 0.35;
      stroke(motionColor[0], motionColor[1], motionColor[2], (55 - ring * 15) * glowFade);
      strokeWeight(2.5 + ring * 3 + beatPulse * 6);
      circle(centerX, centerY, coreRadius * (2.1 + beatPulse * 0.9) * ringSpread);
    }
    pop();
  }
}

// MagicRings (React Bits, WebGL shader) adapted to plain p5.js — this project has no
// React/Three.js build pipeline, so the ring-halo look is recreated with 2D drawing instead.
// Ring displacement is driven directly by beatPulse (freshness/strength of the last beat):
// a strong beat pushes the rings out further, a weak/idle pulse keeps them close and small.
const MAGIC_RING_COUNT = 6;
const MAGIC_RING_GAP = 1.5;
const MAGIC_RING_STEP = 0.15;

function drawMagicRings() {
  const { centerX, centerY, coreRadius } = getEclipseCore();
  const primaryColor = currentMotionColor;
  const secondaryColor = getOxygenColor(spo2);
  const movementAmplitude = coreRadius * (0.02 + beatPulse * 0.4);
  const time = millis() * 0.0018;

  push();
  noFill();
  for (let ring = 0; ring < MAGIC_RING_COUNT; ring += 1) {
    const ringProgress = ring / max(1, MAGIC_RING_COUNT - 1);
    const ringColor = blendRgb(primaryColor, secondaryColor, ringProgress);
    const baseRingRadius = coreRadius * (1.3 + ring * MAGIC_RING_STEP);
    const wobble = sin(time * 2.2 + ring * 1.7) * movementAmplitude;
    const ringRadius = baseRingRadius + wobble;
    const cutawayFraction = min(0.04 * pow(MAGIC_RING_GAP, ring), 0.4);
    const gapAngle = TWO_PI * cutawayFraction;
    const startAngle = time * (0.5 + beatPulse * 1.2) + ring * 0.7;

    stroke(ringColor[0], ringColor[1], ringColor[2], (120 - ring * 12) * (0.35 + beatPulse * 0.65));
    strokeWeight(1 + beatPulse * 2.4);
    arc(centerX, centerY, ringRadius * 2, ringRadius * 2, startAngle + gapAngle, startAngle + TWO_PI);
  }
  pop();
}

function createNeuralFilaments() {
  neuralFilaments = [];
  for (let index = 0; index < NEURAL_FILAMENT_COUNT; index += 1) {
    neuralFilaments.push({
      angle: random(TWO_PI),
      z: random(-1, 1),
      seed: random(1000),
      bornAt: millis()
    });
  }
}

function getDepthColor(color, z, brightnessOffset = 1) {
  const depthBrightness = lerp(0.32, 1.28, (z + 1) * 0.5) * brightnessOffset;
  return color.map((channel) => min(255, channel * depthBrightness));
}

function getNeuralFilamentPoints(filament, core, time) {
  if (filament.cachedPoints && frameCount % 3 !== 0) {
    return filament.cachedPoints;
  }

  const points = [];
  const age = millis() - filament.bornAt;
  const growth = min(1.75, 0.32 + age * NEURAL_FILAMENT_GROWTH_PER_MS);
  const reach = core.coreRadius * (2.0 + motionAmount * 2.0) * growth;

  for (let step = 0; step <= NEURAL_FILAMENT_SEGMENTS; step += 1) {
    const progress = step / NEURAL_FILAMENT_SEGMENTS;
    // root stays pinned to the sphere's depth plane so it visually welds onto the surface
    const zSpread = filament.z * 360 + (noise(filament.seed + progress * 2.3, time * 0.64, progress * 1.8) - 0.5) * 180;
    const z = zSpread * progress;
    // Der Ausschlag stand hier auf 3.4 - damit schlugen die Ranken um mehr als einen halben
    // Vollkreis aus und liefen als kantige Zickzacklinien quer durchs Bild. Genau die waren
    // der auffaelligste Teil des "chaotischen" Eindrucks. Mit 1.1 bleiben es Faeden, die
    // ihrer Richtung folgen und von der Kugel weg zeigen.
    const angle = filament.angle + (noise(filament.seed * 0.42, progress * 3.2, time * 0.5) - 0.5) * 1.1;
    const localX = cos(angle) * (core.coreRadius + progress * reach);
    const localY = sin(angle) * (core.coreRadius + progress * reach);
    const projected = project3D(localX, localY, z);

    points.push([projected.x, projected.y, projected.scale, z]);
  }
  filament.cachedPoints = points;
  return filament.cachedPoints;
}


function drawNeuralStroke(points, color, alpha, baseWeight) {
  const segmentCount = points.length - 1;
  stroke(color[0], color[1], color[2], alpha);
  for (let index = 1; index <= segmentCount; index += 1) {
    const progress = (index - 0.5) / segmentCount;
    const perspective = lerp(points[index - 1][2], points[index][2], 0.5);
    strokeWeight(max(0.28, baseWeight * pow(1 - progress, 0.72) * perspective));
    line(points[index - 1][0], points[index - 1][1], points[index][0], points[index][1]);
  }
}

function drawNeuralFilament(filament, points, time) {
  const depthProgress = (1 - filament.z) * 0.5;
  const depthColor = getDepthColor(currentMotionColor, -filament.z);
  const coreColor = getDepthColor(currentMotionColor, -filament.z, 1.35);
  // Vorher bis zu 12 Pixel dick und mit einer Deckkraft von 212 - damit waren die Ranken
  // das auffaelligste Element ueberhaupt. Als duenne, halbdurchsichtige Faeden geben sie
  // der Kugel eine Umgebung, ohne den Blick auf sich zu ziehen.
  const baseWeight = lerp(0.7, 3.2, depthProgress) * (1 + beatPulse * 0.24);
  const baseAlpha = lerp(12, 80, depthProgress);

  drawNeuralStroke(points, depthColor, baseAlpha * 0.7, baseWeight);
  drawNeuralStroke(points, coreColor, baseAlpha, baseWeight * 0.22);

  const spark = constrain(map(noise(filament.seed, time * 2.2, filament.z + beatPulse * 3), 0.72, 1, 0, 1), 0, 1) * beatPulse;
  if (filament.z < 0 && spark > 0.08) {
    const tip = points[points.length - 1];
    noStroke();
    fill(coreColor[0], coreColor[1], coreColor[2], spark * 245);
    circle(tip[0], tip[1], baseWeight * tip[2] * (1.2 + spark * 2.4));
  }
}

function drawNeuralFilaments(drawFront) {
  if (neuralFilaments.length === 0) {
    return;
  }

  const core = getEclipseCore();
  const time = millis() * 0.00024;

  push();
  noFill();
  strokeCap(ROUND);
  strokeJoin(ROUND);
  for (const filament of neuralFilaments) {
    if ((filament.z < 0) !== drawFront) {
      continue;
    }
    drawNeuralFilament(filament, getNeuralFilamentPoints(filament, core, time), time);
  }
  pop();
}

function createNeuralEnergyArc() {
  if (neuralFilaments.length < 2 || random() >= 0.05) {
    return;
  }

  const startIndex = floor(random(neuralFilaments.length));
  let endIndex = floor(random(neuralFilaments.length - 1));
  if (endIndex >= startIndex) {
    endIndex += 1;
  }
  neuralEnergyArcs.push({ startIndex, endIndex, seed: random(1000), bornAt: millis() });
}

function drawNeuralArcPath(start, end, seed, time) {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const length = max(1, sqrt(deltaX * deltaX + deltaY * deltaY));
  const normalX = -deltaY / length;
  const normalY = deltaX / length;

  beginShape();
  for (let index = 0; index <= 10; index += 1) {
    const progress = index / 10;
    const bend = (noise(seed, progress * 7.4, time * 4.2) - 0.5) * 38 * sin(progress * PI);
    vertex(lerp(start[0], end[0], progress) + normalX * bend, lerp(start[1], end[1], progress) + normalY * bend);
  }
  endShape();
}

function drawNeuralEnergyArcs() {
  const core = getEclipseCore();
  const time = millis() * 0.00024;

  push();
  noFill();
  blendMode(ADD);
  for (let index = neuralEnergyArcs.length - 1; index >= 0; index -= 1) {
    const arc = neuralEnergyArcs[index];
    const life = constrain((millis() - arc.bornAt) / NEURAL_ARC_LIFESPAN_MS, 0, 1);
    if (life >= 1) {
      neuralEnergyArcs.splice(index, 1);
      continue;
    }

    const startPoints = getNeuralFilamentPoints(neuralFilaments[arc.startIndex], core, time);
    const endPoints = getNeuralFilamentPoints(neuralFilaments[arc.endIndex], core, time);
    const start = startPoints[startPoints.length - 1];
    const end = endPoints[endPoints.length - 1];
    const arcColor = getDepthColor(currentMotionColor, 1, 1.45);
    const alpha = (1 - life) * 230;

    stroke(arcColor[0], arcColor[1], arcColor[2], alpha * 0.24);
    strokeWeight(7 * (1 - life));
    drawNeuralArcPath(start, end, arc.seed, time);
    stroke(arcColor[0], arcColor[1], arcColor[2], alpha);
    strokeWeight(1.35 * (1 - life));
    drawNeuralArcPath(start, end, arc.seed, time);
  }
  pop();
}

function drawWaves() {
  for (let index = eclipseWaves.length - 1; index >= 0; index -= 1) {
    const wave = eclipseWaves[index];
    wave.update();
    wave.draw();

    if (wave.isFinished()) {
      eclipseWaves.splice(index, 1);
    }
  }
}

function drawGrain() {
  const time = frameCount * 0.045;
  const grainCount = 220;
  const columns = ceil(sqrt(grainCount * width / height));
  const rows = ceil(grainCount / columns);
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const beatFlicker = 1 + beatPulse * 2.2;
  const motionX = constrain(accelX / ECLIPSE_ACCEL_REFERENCE, -1, 1);
  const motionY = constrain(accelY / ECLIPSE_ACCEL_REFERENCE, -1, 1);

  push();
  for (let index = 0; index < grainCount; index += 1) {
    const depthIndex = index % 3;
    const depth = lerp(-0.8, 0.8, depthIndex * 0.5);
    const parallax = lerp(1.5, 12, (depth + 1) * 0.5);
    const column = index % columns;
    const row = floor(index / columns);
    const x = (column + 0.5) * cellWidth + (noise(ECLIPSE_SEED + index * 0.17, time) - 0.5) * cellWidth * 0.48 + motionX * parallax;
    const y = (row + 0.5) * cellHeight + (noise(ECLIPSE_SEED * 0.2 + index * 0.23, time + 19) - 0.5) * cellHeight * 0.48 + motionY * parallax;
    const brightness = noise(index * 0.11, time + 41);
    const depthColor = getDepthColor(getColorAtPosition(x, y), depth);
    stroke(depthColor[0], depthColor[1], depthColor[2], (3 + brightness * 9 + breathPulse * 3) * beatFlicker);
    strokeWeight((0.7 + brightness * 0.75) * lerp(0.75, 1.35, (depth + 1) * 0.5));
    point(x, y);
  }
  pop();
}

function drawOverlay() {
  const margin = 22;
  const overlayTop = width < 560 ? 160 : margin;
  const oxygen = getOxygenColor(spo2);

  push();
  textFont('monospace');
  textSize(11);
  textAlign(RIGHT, TOP);
  noStroke();
  fill(220, 230, 238, 165);
  text(`BPM ${bpm.toFixed(1)}`, width - margin, overlayTop);
  fill(oxygen[0], oxygen[1], oxygen[2], 190);
  text(`SPO2 ${spo2.toFixed(1)}`, width - margin, overlayTop + 17);
  fill(220, 230, 238, 150);
  text(`STARS ${collectiveStarCount}`, width - margin, overlayTop + 34);
  textAlign(LEFT, BOTTOM);
  fill(220, 230, 238, 135);
  text(`STATUS ${getConnectionLabel()}`, margin, height - margin);
  pop();
}

function applyLiveSensorValues() {
  normalizedBpm = constrain(map(bpm, BPM_MIN, BPM_MAX, 0, 1), 0, 1);
  normalizedSpo2 = constrain(map(spo2, SPO2_MIN, SPO2_MAX, 0, 1), 0, 1);
  const accelerationMagnitude = sqrt(accelX * accelX + accelY * accelY + accelZ * accelZ);
  motionAmount = constrain(
    max(
      accelerationMagnitude / ECLIPSE_ACCEL_REFERENCE,
      abs(accelX) / ECLIPSE_ACCEL_REFERENCE,
      abs(accelY) / ECLIPSE_ACCEL_REFERENCE,
      abs(accelZ) / ECLIPSE_ACCEL_REFERENCE
    ),
    0,
    1
  );
}

function stampMeasurementStar(sampleId) {
  if (eclipseStarLayers.length === 0) {
    return;
  }

  const { x, y } = getMovementMapPosition();
  const movementColor = getMotionColor();
  const layerIndex = abs(floor(sampleId)) % eclipseStarLayers.length;
  const depth = lerp(-0.85, 0.85, layerIndex / max(1, eclipseStarLayers.length - 1));
  const pointSize = (MOVEMENT_MARKER_RADIUS + normalizedBpm * 0.45) * lerp(0.72, 1.24, (depth + 1) * 0.5);
  const starColor = getDepthColor(movementColor, depth);
  const starLayer = eclipseStarLayers[layerIndex];

  starLayer.push();
  starLayer.noFill();
  starLayer.stroke(starColor[0], starColor[1], starColor[2], 72);
  starLayer.strokeWeight(0.7);
  starLayer.circle(x, y, pointSize * 3.1);
  starLayer.stroke(starColor[0], starColor[1], starColor[2], 230);
  starLayer.strokeWeight(pointSize);
  starLayer.point(x, y);
  starLayer.pop();
}

let totalBeatCount = 0;
const JUMP_WALKER_SPREAD_EVERY_STARS = 200;

function triggerBeat(timestamp = millis()) {
  lastBeatMillis = timestamp;
  beatPulse = 1;
  totalBeatCount += 1;
  // Muss zum ruhigeren Ausschlag in updateEclipseState passen - stand hier vorher 1.22 und
  // riss die Kugel bei jedem Schlag sofort wieder auf ihre alte, grosse Groesse hoch.
  eclipseRadius = max(eclipseRadius, getBaseEclipseRadius() * 1.01);
  // Hier entstanden frueher 3 bis 8 Knoten pro Herzschlag. Das Wachstum haengt jetzt
  // ausschliesslich am Sternzaehler (siehe handleSensorData), damit die gewuenschte Rate
  // von einem Knoten je drei Sterne auch wirklich eingehalten wird.

  // Bei jedem Herzschlag blitzten hier frueher zusaetzlich 12 bis 45 Flow Agents auf
  // (jeweils mit fuenf Funkenstrahlen), 6 bis 24 Jump-Walker leuchteten auf und 1 bis 2 neue
  // Walker entstanden. Genau dieses Dauerblitzen liess das Bild chaotisch wirken, und
  // deshalb ist es hier heraus. Das grosse Aufleuchten bleibt dort, wo es hingehoert: beim
  // 200-Sterne-Ausbruch von P_2_2_1_02 (siehe handleSensorData) und beim Start.
  playBeatSound();
}

function getOxygenColor(value) {
  if (value > 0 && value < 94) {
    const lowProgress = constrain(map(value, SPO2_MIN, 94, 0, 1), 0, 1);
    return blendRgb([236, 77, 69], [222, 231, 240], lowProgress);
  }

  if (value <= 97) {
    return [222, 231, 240];
  }

  const highProgress = constrain(map(value, 97, SPO2_MAX, 0, 1), 0, 1);
  return blendRgb([222, 231, 240], [136, 203, 248], highProgress);
}

function blendRgb(start, end, amount) {
  return [
    lerp(start[0], end[0], amount),
    lerp(start[1], end[1], amount),
    lerp(start[2], end[2], amount)
  ];
}

function getConnectionLabel() {
  if (demoMode) {
    return 'DEMO';
  }

  if (!socket || !socket.connected) {
    return 'SERVER OFFLINE';
  }

  if (lastSensorMillis > 0 && millis() - lastSensorMillis < 10000) {
    return 'LIVE';
  }

  return 'WAITING';
}

class Wave {
  constructor(sourceBpm, sourceSpo2, sourceAccelX, sourceAccelY, sourceAccelZ, sampleId, frozenColor) {
    this.spo2 = sourceSpo2;
    this.color = frozenColor;
    this.radius = min(width, height) * 0.19;
    this.targetRadius = this.radius;
    this.maxRadius = sqrt(width * width + height * height) * 0.57;
    this.speed = map(constrain(sourceBpm, BPM_MIN, BPM_MAX), BPM_MIN, BPM_MAX, 0.045, 0.115) * 0.55;
    this.lineWeight = map(constrain(sourceBpm, BPM_MIN, BPM_MAX), BPM_MIN, BPM_MAX, 0.65, 1.7);
    this.motionX = constrain(sourceAccelX / ECLIPSE_ACCEL_REFERENCE, -1, 1);
    this.motionY = constrain(sourceAccelY / ECLIPSE_ACCEL_REFERENCE, -1, 1);
    this.motionZ = constrain(sourceAccelZ / ECLIPSE_ACCEL_REFERENCE, -1, 1);
    this.tiltAngle = atan2(sourceAccelY, sourceAccelX);
    this.seed = ECLIPSE_SEED + sampleId * 0.73;
    this.turbulence = map(constrain(sourceBpm, BPM_MIN, BPM_MAX), BPM_MIN, BPM_MAX, 0.008, 0.06);
    this.age = 0;
  }

  update() {
    const sessionGrowth = getSessionGrowth();
    this.maxRadius = sqrt(width * width + height * height) * 0.57 * lerp(0.3, 1, sessionGrowth);
    this.targetRadius += deltaTime * this.speed * lerp(0.5, 1, sessionGrowth);
    this.radius = lerp(this.radius, this.targetRadius, constrain(deltaTime * 0.004, 0.03, 0.08));
    this.age += deltaTime;
  }

  draw() {
    const remaining = constrain(1 - this.radius / this.maxRadius, 0, 1);
    const bornProgress = constrain(this.age / 260, 0, 1);
    const brightFlash = (1 - bornProgress) * 90;
    const tiltStrength = constrain(sqrt(this.motionX * this.motionX + this.motionY * this.motionY), 0, 1);
    const majorRadius = this.radius * (1 + tiltStrength * 0.16);
    const minorRadius = this.radius * lerp(1, 0.38, tiltStrength);
    const waveColor = getDepthColor(this.color, -this.motionZ, 1.1);
    const drawTiltedRing = (alpha, weight) => {
      stroke(waveColor[0] + brightFlash * 0.25, waveColor[1] + brightFlash * 0.25, waveColor[2] + brightFlash * 0.25, alpha);
      strokeWeight(weight);
      beginShape();
      // Groebere Schrittweite als vorher (0.12): 29 statt 53 Stuetzpunkte je Ring, und
      // jeder davon kostet einen noise()-Aufruf. Bei den weichen, grossen Ringen sieht man
      // den Unterschied nicht, die Rechenzeit halbiert sich aber nahezu.
      for (let angle = 0; angle <= TWO_PI + 0.22; angle += 0.22) {
        const ringX = cos(angle) * majorRadius;
        const ringY = sin(angle) * minorRadius;
        const depth = sin(angle) * majorRadius * tiltStrength * 0.7 + this.motionZ * majorRadius * 0.25;
        const noiseValue = (noise(this.seed, angle * 0.28, this.age * 0.00015) - 0.5) * this.radius * this.turbulence;
        const rotatedX = ringX * cos(this.tiltAngle) - ringY * sin(this.tiltAngle);
        const rotatedY = ringX * sin(this.tiltAngle) + ringY * cos(this.tiltAngle);
        const projected = project3D(rotatedX + noiseValue, rotatedY + noiseValue, depth);
        vertex(projected.x, projected.y);
      }
      endShape(CLOSE);
    };

    push();
    noFill();
    blendMode(ADD);
    // Deckkraft auf etwa ein Drittel (vorher 42 und 176). Die Wellen werden additiv
    // gezeichnet, dadurch summieren sich mehrere gleichzeitig sichtbare Ringe zu deutlich
    // helleren Stellen - bei den alten Werten war das der auffaelligste Teil des Bildes.
    drawTiltedRing(15 * remaining * remaining, this.lineWeight * 4.4);
    drawTiltedRing(58 * remaining * remaining, this.lineWeight * (0.9 + remaining * 0.5) + (1 - bornProgress) * 1.2);
    pop();
  }

  isFinished() {
    return this.radius >= this.maxRadius;
  }
}

function handleSensorData(data, isDemo = false) {
  const { bpm: nextBpm, spo2: nextSpo2, accelX: nextX, accelY: nextY, accelZ: nextZ, beat, sampleId } = data;

  if (![nextBpm, nextSpo2, nextX, nextY, nextZ].every(Number.isFinite)) {
    return;
  }

  if (!isDemo) {
    stopDemoMode();
  }

  bpm = nextBpm;
  spo2 = nextSpo2;
  accelX = nextX;
  accelY = nextY;
  accelZ = nextZ;
  applyLiveSensorValues();
  updateMotionColor();
  collectiveStarCount += 1;

  // P_2_2_1_02: alle 200 Sterne wiederholt sich der anfaengliche 42-Walker-Ausbruch aus
  // setup() - 42 Walker auf einmal, gleichmaessig in alle Richtungen ausgerichtet.
  if (collectiveStarCount % JUMP_WALKER_SPREAD_EVERY_STARS === 0) {
    const originWalker = jumpWalkers[floor(random(jumpWalkers.length))];
    const burstX = originWalker ? originWalker.x : width * 0.5;
    const burstY = originWalker ? originWalker.y : height * 0.5;
    // Statt eines Planeten bleibt nur ein kleiner, leuchtender Punkt an der Stelle zurueck -
    // siehe drawBurstMarkers().
    burstMarkers.push({ x: burstX, y: burstY });
    const burstColor = [...currentMotionColor];
    for (let i = 0; i < 42; i += 1) {
      const spreadWalker = new JumpWalker(burstX, burstY);
      spreadWalker.directionalBiasAngle = (i / 42) * TWO_PI;
      // Alle 42 gluehen gleichzeitig und in derselben Farbe auf - erst diese beiden Zeilen
      // machen aus dem Ausbruch den sichtbaren hellen Kreis von P_2_2_1_02.
      spreadWalker.forceGlowColor = burstColor;
      spreadWalker.glowUntil = millis() + JUMP_WALKER_GLOW_DURATION_MS * 1.4;
      spawnJumpWalker(spreadWalker);
    }
  }

  growAggregation();

  // Alle 300 Sterne beginnt das Geaest an seiner freiesten Stelle neu weiterzuwachsen.
  // Dadurch kann es nie dauerhaft steckenbleiben, egal wie dicht es innen schon ist.
  if (collectiveStarCount % DIFFUSION_GENERATION_EVERY_STARS === 0) {
    startDiffusionGeneration();
  }
  stampMeasurementStar(Number.isFinite(sampleId) ? sampleId : collectiveStarCount);
  // Genau ein Knoten je drei Sterne. Vorher entstanden 1 bis 3 Knoten pro Stern UND
  // zusaetzlich 3 bis 8 pro Herzschlag - das Geaest wuchs dadurch um ein Vielfaches
  // schneller, als es sein soll.
  starsSinceDiffusionNode += 1;
  if (starsSinceDiffusionNode >= DIFFUSION_STARS_PER_NODE) {
    starsSinceDiffusionNode = 0;
    addDiffusionNode();
  }
  lastSensorMillis = millis();

  if (beat === 1) {
    triggerBeat();
    const frozenColor = [...currentMotionColor];
    const baseSampleId = Number.isFinite(sampleId) ? sampleId : collectiveStarCount;

    // Zwei Plasmawellen je Herzschlag statt vier: eine normale und eine langsame, breite,
    // die laenger stehen bleibt. Die schnelle und die sehr dicke Welle sind weggelassen -
    // gerade ihr Tempo und ihre Staerke haben das Bild frueher unruhig gemacht.
    eclipseWaves.push(new Wave(bpm, spo2, accelX, accelY, accelZ, baseSampleId, frozenColor));

    const slowWave = new Wave(bpm, spo2, accelX, accelY, accelZ, baseSampleId + 1, frozenColor);
    slowWave.lineWeight *= 2.4;
    slowWave.speed *= 0.35;
    eclipseWaves.push(slowWave);

    // Aelteste Wellen entfernen, falls die Obergrenze ueberschritten ist - verhindert
    // unbegrenztes Ansammeln bei hoher Herzschlagrate
    while (eclipseWaves.length > ECLIPSE_WAVE_MAX) {
      eclipseWaves.shift();
    }
  }

  if (!isDemo) {
    setStatus('ESP32 verbunden - Live-Sensordaten aktiv');
  }
}

function draw3DDebris() {
  const mc = currentMotionColor;
  const motionX = constrain(accelX / ECLIPSE_ACCEL_REFERENCE, -1, 1) * 160;
  const motionY = constrain(accelY / ECLIPSE_ACCEL_REFERENCE, -1, 1) * 160;
  const travelSpeed = 2 + normalizedBpm * 5;

  push();
  blendMode(ADD);
  for (let d of floatingDebris) {
    d.z -= travelSpeed;
    if (d.z < 1) {
      d.z = 2000;
      d.x = random(-2000, 2000);
      d.y = random(-2000, 2000);
    }

    const projected = project3D(d.x + motionX, d.y + motionY, d.z);
    const depthColor = getDepthColor(mc, constrain(1 - d.z / 2000, -1, 1));
    const bokehSize = lerp(1.2, 8.5, constrain(projected.scale, 0, 1));
    if (motionAmount > 0.16) {
      const trailLength = lerp(0, 36, motionAmount) * projected.scale;
      stroke(depthColor[0], depthColor[1], depthColor[2], 34 * projected.scale);
      strokeWeight(max(0.35, bokehSize * 0.24));
      line(projected.x, projected.y, projected.x - motionX * trailLength * 0.02, projected.y - motionY * trailLength * 0.02);
    }
    noStroke();
    fill(depthColor[0], depthColor[1], depthColor[2], 24 + projected.scale * 72);
    circle(projected.x, projected.y, bokehSize);
  }
  pop();
}

function drawChromaticAberration() {
  if (!postProcessLayer || beatPulse < 0.2 || frameCount % 2 !== 0) {
    return;
  }

  const intensity = beatPulse * 0.09;
  const offset = lerp(0, 7, beatPulse);
  const sourceCanvas = drawingContext.canvas;
  const processContext = postProcessLayer.drawingContext;

  for (const [color, direction] of [[[255, 34, 76], -1], [[38, 126, 255], 1]]) {
    postProcessLayer.clear();
    processContext.save();
    processContext.drawImage(sourceCanvas, 0, 0);
    processContext.globalCompositeOperation = 'source-in';
    processContext.fillStyle = toRgba(color, intensity);
    processContext.fillRect(0, 0, width, height);
    processContext.restore();

    push();
    blendMode(ADD);
    image(postProcessLayer, offset * direction, 0);
    pop();
  }
}

function drawBioGlitch() {
  if (!(spo2 > 0 && spo2 < 94) || !postProcessLayer) {
    return;
  }

  if (millis() > glitchUntil && millis() > nextGlitchAt && random() < 0.006) {
    glitchUntil = millis() + random(55, 120);
    nextGlitchAt = millis() + random(900, 1700);
  }
  if (millis() > glitchUntil) {
    return;
  }

  const sourceCanvas = drawingContext.canvas;
  const processContext = postProcessLayer.drawingContext;
  postProcessLayer.clear();
  processContext.drawImage(sourceCanvas, 0, 0);

  const context = drawingContext;
  context.save();
  for (let index = 0; index < 2; index += 1) {
    const stripY = random(height);
    const stripHeight = random(3, 16);
    const shift = lerp(-18, 18, random()) * (1 + beatPulse);
    context.drawImage(postProcessLayer.canvas, 0, stripY, width, stripHeight, shift, stripY, width, stripHeight);
    context.globalCompositeOperation = 'difference';
    context.fillStyle = 'rgba(255, 255, 255, 0.13)';
    context.fillRect(0, stripY, width, stripHeight);
    context.globalCompositeOperation = 'source-over';
  }
  context.restore();
}