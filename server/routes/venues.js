/**
 * Theater-Bild-Gelöte - HTTP-Routen fuer die Venue-Verwaltung.
 *
 * Wird in server/index.js unter /api/venues eingehaengt:
 *
 *   import venueRoutes from './routes/venues.js';
 *   app.use('/api/venues', venueRoutes);
 *
 * Deshalb sind alle Pfade hier RELATIV zum Einhaengepunkt ('/' und '/:id') -
 * nicht noch einmal '/api/venues/...'.
 *
 *   GET    /                  Liste aller Venues (eigene und Vorlagen)
 *   GET    /template          Geruest fuer ein neues Venue
 *   POST   /validate          Pruefung waehrend des Tippens, immer 200
 *   GET    /:id               volles Venue
 *   POST   /                  neu anlegen bzw. eigenes ueberschreiben
 *   PUT    /:id               aendern - Vorlagen sind schreibgeschuetzt
 *   DELETE /:id               loeschen - Vorlagen sind schreibgeschuetzt
 *   POST   /:id/duplicate     kopieren
 *
 * Reihenfolge ist wichtig: '/template' und '/validate' stehen VOR '/:id',
 * sonst schluckt der Platzhalter die beiden Woerter.
 *
 * Jeder Fehler geht als { error, detail } mit passendem Status raus und steht
 * zusaetzlich im Serverlog. Nichts scheitert still.
 */

import express from 'express';

import * as venues from '../venues.js';

const router = express.Router();

/* ==========================================================================
 * Helfer
 * ========================================================================== */

/**
 * Fehler beantworten. Der Status kommt aus err.status (den setzt
 * server/venues.js), sonst aus fallback.
 */
function sendError(res, err, fallback = 500, where = '') {
  const status = Number.isInteger(err?.status) ? err.status : fallback;
  const message = err?.message || 'Unbekannter Fehler';
  if (status >= 500) {
    console.error(`[venues-api] ${where} -> ${status}: ${message}`);
    if (err?.stack) console.error(err.stack);
  } else {
    console.warn(`[venues-api] ${where} -> ${status}: ${message}`);
  }
  const body = { error: message, detail: err?.detail ?? null };
  if (Array.isArray(err?.problems)) body.problems = err.problems;
  res.status(status).json(body);
}

/** Body als Venue-Objekt holen. Wirft mit Status 400, wenn nichts brauchbar ist. */
function venueFromBody(req) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const err = new Error('Der Body enthaelt kein Venue.');
    err.status = 400;
    err.detail = 'Erwartet wird ein JSON-Objekt mit id, name, fps, walls und delivery.';
    throw err;
  }
  return body;
}

/** Zahl aus der Query, sonst Vorgabewert. */
function queryNum(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const err = new Error(`"${value}" ist keine Zahl.`);
    err.status = 400;
    throw err;
  }
  return n;
}

/** Fehlerliste in einen Satz fuer die Kopfzeile der Antwort. */
function errorSummary(problems) {
  const errors = problems.filter((p) => p.level === 'error');
  return {
    count: errors.length,
    detail: errors.map((p) => `${p.where}: ${p.msg}`).join('\n'),
  };
}

/* ==========================================================================
 * Lesen
 * ========================================================================== */

router.get('/', (req, res) => {
  try {
    res.json(venues.list());
  } catch (err) {
    sendError(res, err, 500, 'GET /');
  }
});

/**
 * Geruest fuer ein neues Venue.
 * Parameter: walls, panels, width, height (dazu optional fps, pixelPitchMm,
 * id, name). Das Ergebnis ist vollstaendig und besteht validate() ohne Fehler.
 */
router.get('/template', (req, res) => {
  try {
    const venue = venues.template({
      walls: queryNum(req.query.walls, undefined),
      panels: queryNum(req.query.panels, undefined),
      width: queryNum(req.query.width, undefined),
      height: queryNum(req.query.height, undefined),
      fps: queryNum(req.query.fps, undefined),
      pixelPitchMm: queryNum(req.query.pixelPitchMm, undefined),
      id: typeof req.query.id === 'string' ? req.query.id : undefined,
      name: typeof req.query.name === 'string' ? req.query.name : undefined,
    });
    res.json(venue);
  } catch (err) {
    sendError(res, err, 400, 'GET /template');
  }
});

/**
 * Live-Pruefung waehrend des Tippens: immer 200, die Bewertung steht in der
 * Liste. Ein HTTP-Fehler waere hier falsch - der Nutzer tippt ja noch.
 */
router.post('/validate', (req, res) => {
  try {
    res.json(venues.validate(req.body));
  } catch (err) {
    sendError(res, err, 500, 'POST /validate');
  }
});

router.get('/:id', (req, res) => {
  try {
    res.json(venues.get(req.params.id));
  } catch (err) {
    sendError(res, err, 404, `GET /${req.params.id}`);
  }
});

/* ==========================================================================
 * Schreiben
 * ========================================================================== */

router.post('/', (req, res) => {
  try {
    const venue = venueFromBody(req);
    const problems = venues.validate(venue);
    const { count, detail } = errorSummary(problems);
    if (count > 0) {
      res.status(400).json({
        error: `Das Venue hat ${count} Fehler und wurde nicht gespeichert.`,
        detail,
        problems,
      });
      console.warn(`[venues-api] POST / -> 400: ${count} Fehler im Venue "${venue.id}"`);
      return;
    }
    res.json(venues.save(venue));
  } catch (err) {
    sendError(res, err, 400, 'POST /');
  }
});

router.put('/:id', (req, res) => {
  const id = req.params.id;
  try {
    const body = venueFromBody(req);

    if (body.id !== undefined && body.id !== id) {
      res.status(400).json({
        error: `Die ID im Body ("${body.id}") passt nicht zur Adresse ("${id}").`,
        detail: 'Eine ID laesst sich nicht im Nachhinein aendern. Dafuer das Venue duplizieren und das alte loeschen.',
      });
      console.warn(`[venues-api] PUT /${id} -> 400: ID im Body weicht ab`);
      return;
    }

    const existing = venues.find(id);
    if (existing && existing._builtin) {
      res.status(403).json({
        error: `"${existing.name || id}" ist eine mitgelieferte Vorlage und ist schreibgeschuetzt.`,
        detail: 'Erst duplizieren (POST /api/venues/' + id + '/duplicate), dann die Kopie bearbeiten.',
      });
      console.warn(`[venues-api] PUT /${id} -> 403: Vorlage ist schreibgeschuetzt`);
      return;
    }

    const venue = { ...body, id };
    const problems = venues.validate(venue);
    const { count, detail } = errorSummary(problems);
    if (count > 0) {
      res.status(400).json({
        error: `Das Venue hat ${count} Fehler und wurde nicht gespeichert.`,
        detail,
        problems,
      });
      console.warn(`[venues-api] PUT /${id} -> 400: ${count} Fehler im Venue`);
      return;
    }
    res.json(venues.save(venue));
  } catch (err) {
    sendError(res, err, 400, `PUT /${id}`);
  }
});

router.delete('/:id', (req, res) => {
  const id = req.params.id;
  try {
    res.json({ ok: true, ...venues.remove(id) });
  } catch (err) {
    sendError(res, err, 500, `DELETE /${id}`);
  }
});

router.post('/:id/duplicate', (req, res) => {
  const id = req.params.id;
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.id !== undefined && typeof body.id !== 'string') {
      res.status(400).json({
        error: 'Die neue ID muss Text sein.',
        detail: 'Erwartet wird { "id": "kleines-theater", "name": "Kleines Theater" }.',
      });
      return;
    }
    res.json(venues.duplicate(id, body.id, body.name));
  } catch (err) {
    sendError(res, err, 400, `POST /${id}/duplicate`);
  }
});

export default router;
