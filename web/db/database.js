/**
 * PyCodeFlow — PostgreSQL database module
 * Sprint 12a: migratie van SQLite naar PostgreSQL (pg)
 * Sprint 17: DATABASE_URL automatisch opgebouwd uit POSTGRES_PASSWORD
 *
 * In .env is enkel dit nodig:
 *   POSTGRES_PASSWORD=jouwwachtwoord
 *
 * DATABASE_URL wordt automatisch opgebouwd als die niet ingesteld is.
 * Handig: wachtwoord hoeft maar op één plek ingesteld te worden.
 */
'use strict';

const { Pool } = require('pg');
const crypto   = require('crypto');

// ── Connection string ──────────────────────────────────────────────────────────
// Bouw DATABASE_URL automatisch op uit POSTGRES_PASSWORD als die niet ingesteld is.
// Dit voorkomt dat het wachtwoord op twee plaatsen in .env moet staan.
const connectionString = process.env.DATABASE_URL ||
  (() => {
    const pw = process.env.POSTGRES_PASSWORD;
    if (!pw) {
      console.error('[db] FATALE FOUT: POSTGRES_PASSWORD of DATABASE_URL moet ingesteld zijn in .env');
      process.exit(1);
    }
    const url = `postgresql://pycodeflow:${encodeURIComponent(pw)}@postgres:5432/pycodeflow`;
    console.log('[db] DATABASE_URL automatisch opgebouwd uit POSTGRES_PASSWORD');
    return url;
  })();

// ── Connection pool ────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[db] Onverwachte pool fout:', err.message);
});

// Helper: query uitvoeren
async function query(text, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// 36a: transactie-helper voor multi-step schrijfacties.
// Roept fn(client) aan binnen een BEGIN/COMMIT; bij een fout volgt ROLLBACK.
// Zo blijft de database consistent (geen half-geschreven toets bij een crash).
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) {
      console.error('[db] ROLLBACK mislukt:', rbErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

// ── Schema initialisatie ───────────────────────────────────────────────────────
async function initSchema() {
  await query(`
    -- ── Sprint 48a1: scholen ─────────────────────────────────────────────────
    -- Eerste steen van het multi-tenant fundament (model B). Volledig ADDITIEF:
    -- niets verwijst hier voorlopig naar, dus bestaande installaties merken niets.
    -- 48a2 koppelt leerkrachten eraan, 48a3 hangt er e-maildomeinen onder, en
    -- 48c1 zet school_id op de rest.
    CREATE TABLE IF NOT EXISTS schools (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      logo_path  TEXT NOT NULL DEFAULT '',
      license    TEXT NOT NULL DEFAULT '',
      contact    TEXT NOT NULL DEFAULT '',
      active     BOOLEAN NOT NULL DEFAULT true,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
    );
    -- Twee scholen met dezelfde naam is altijd een vergissing, en bij een schoolkeuze
    -- met twee identieke namen kan een leerkracht onmogelijk kiezen.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_name ON schools (LOWER(name));

    CREATE TABLE IF NOT EXISTS teachers (
      id           TEXT PRIMARY KEY,
      username     TEXT NOT NULL,
      pass_hash    TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      role         TEXT NOT NULL DEFAULT 'teacher',
      created_at   BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000,
      last_login   BIGINT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_username
      ON teachers (LOWER(username));

    -- ── Sprint 50a: echte login-sessies per leerkracht ────────────────────────
    -- Tot nu kreeg iedereen hetzelfde cookie (een HMAC van de gebruikersnaam uit
    -- .env), waardoor de app niet wist wíé er inlogde. Deze tabel geeft elke login
    -- een eigen sessie. We bewaren enkel de SHA-256 van het token: uit de databank
    -- valt dus geen bruikbare sessie te stelen.
    -- Additief: het oude cookie blijft voorlopig naast dit systeem bestaan (50f ruimt op).
    CREATE TABLE IF NOT EXISTS teacher_sessions (
      token_hash TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      last_seen  BIGINT,
      user_agent TEXT NOT NULL DEFAULT '',
      ip         TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_teacher_sessions_teacher ON teacher_sessions(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_teacher_sessions_expires ON teacher_sessions(expires_at);

    -- Sprint 48b1: welke school is actief in deze sessie?
    -- Staat BEWUST server-side in de sessie en niet in een cookie: de browser mag nooit
    -- kunnen kiezen namens welke school hij werkt.
    -- ON DELETE SET NULL: verdwijnt de school, dan valt de sessie terug op "geen school"
    -- i.p.v. te breken op een verwijzing naar iets dat niet meer bestaat.
    DO $$ BEGIN
      BEGIN
        ALTER TABLE teacher_sessions
          ADD COLUMN active_school_id TEXT REFERENCES schools(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_column THEN NULL; END;
    END $$;

    CREATE TABLE IF NOT EXISTS sessions (
      code            TEXT PRIMARY KEY,
      id              TEXT NOT NULL UNIQUE,
      name            TEXT NOT NULL,
      mode            TEXT NOT NULL DEFAULT 'class',
      editor_assist   INTEGER NOT NULL DEFAULT 1,
      created_at      BIGINT NOT NULL,
      closed          INTEGER NOT NULL DEFAULT 0,
      blocked         INTEGER NOT NULL DEFAULT 0,
      deleted         INTEGER NOT NULL DEFAULT 0,
      shared_code     TEXT NOT NULL DEFAULT '',
      announcement    TEXT NOT NULL DEFAULT '',
      workspace_mode  TEXT NOT NULL DEFAULT 'shared',
      students_json   TEXT NOT NULL DEFAULT '{}',
      -- Sprint 51a (Fase 2 — eigenaarschap): welke leerkracht maakte deze sessie aan.
      -- ON DELETE SET NULL: verdwijnt de leerkracht (account verwijderd), dan verweest
      -- de sessie i.p.v. mee te verdwijnen — de sessiedata van een klas hoort niet zomaar
      -- weg te vallen omdat een account weg is.
      teacher_id      TEXT REFERENCES teachers(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_teacher ON sessions(teacher_id);

    CREATE TABLE IF NOT EXISTS session_annotations (
      session_code     TEXT PRIMARY KEY,
      annotations_json TEXT NOT NULL DEFAULT '[]',
      updated_at       BIGINT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS code_snapshots (
      id           TEXT PRIMARY KEY,
      session_code TEXT NOT NULL,
      student_id   TEXT NOT NULL,
      student_name TEXT NOT NULL DEFAULT '',
      timestamp    BIGINT NOT NULL,
      code         TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_session_student
      ON code_snapshots (session_code, student_id, timestamp);

    -- Sprint 12b: klassen
    CREATE TABLE IF NOT EXISTS classes (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      school_year TEXT NOT NULL DEFAULT '2025-2026',
      archived    BOOLEAN NOT NULL DEFAULT false,
      created_at  BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
    );

    -- Sprint 12b: koppeling leerkracht ↔ klas
    -- ── Sprint 48a2: welke leerkracht hoort bij welke school ─────────────────
    -- Veel-op-veel: een leerkracht kan op meerdere scholen werken, een school heeft
    -- meerdere leerkrachten. Precies dit maakt de schoolkeuze bij het inloggen (48b2)
    -- mogelijk — en het sluit meteen model A uit: met een installatie per school zou
    -- die leerkracht twee losse omgevingen en twee logins hebben.
    -- Beide kanten CASCADE: verdwijnt de school of de leerkracht, dan verdwijnt de
    -- koppeling mee. Een koppeling zonder één van beide heeft geen betekenis.
    -- ── Sprint 48a3: e-maildomeinen per school ───────────────────────────────
    -- Domein is ALTIJD schoolniveau, nooit klasniveau: een klas heeft geen eigen
    -- mailomgeving. Dient nu om de klaslijst te valideren (52b) en straks als grendel
    -- bij zelfregistratie (52c).
    -- Twee vormen, met een bewust verschil:
    --   'athkiel.be'   → exact dat domein
    --   '*.athkiel.be' → enkel subdomeinen, NIET athkiel.be zelf
    CREATE TABLE IF NOT EXISTS school_domains (
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      domain    TEXT NOT NULL,
      PRIMARY KEY (school_id, domain)
    );
    CREATE INDEX IF NOT EXISTS idx_school_domains_domain ON school_domains(domain);

    CREATE TABLE IF NOT EXISTS teacher_schools (
      teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      school_id  TEXT NOT NULL REFERENCES schools(id)  ON DELETE CASCADE,
      PRIMARY KEY (teacher_id, school_id)
    );
    CREATE INDEX IF NOT EXISTS idx_teacher_schools_school ON teacher_schools(school_id);

    CREATE TABLE IF NOT EXISTS teacher_classes (
      teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      class_id   TEXT NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
      PRIMARY KEY (teacher_id, class_id)
    );

    -- Sprint 12c: leerlingen (de PERSOON — bestaat één keer, los van schooljaar)
    CREATE TABLE IF NOT EXISTS students (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'active',
      source       TEXT NOT NULL DEFAULT 'manual',
      google_email TEXT UNIQUE,
      google_sub   TEXT UNIQUE,
      created_at   BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000,
      last_seen    BIGINT,
      notes        TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_students_name ON students(name);

    -- Sprint 40: lidmaatschap van een klas, PER SCHOOLJAAR.
    -- Een klas (classes) is al jaargebonden via school_year; deze koppeltabel laat
    -- toe dat dezelfde leerling over de jaren heen in verschillende klassen zit,
    -- zonder de historiek te verliezen. school_year staat expliciet mee voor
    -- directe filtering en per-jaar status.
    CREATE TABLE IF NOT EXISTS class_memberships (
      student_id   TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      class_id     TEXT NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
      school_year  TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'active',   -- active | left | pending
      created_at   BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000,
      PRIMARY KEY (student_id, class_id, school_year)
    );
    CREATE INDEX IF NOT EXISTS idx_membership_class ON class_memberships(class_id);
    CREATE INDEX IF NOT EXISTS idx_membership_year  ON class_memberships(school_year);

    -- ── Sprint 52a: leerling-account ──────────────────────────────────────────
    -- email = login (uniek, wijzigbaar). Aparte voor-/achternaam (geen "Janssens Marie"-
    -- verwarring). pass_hash + must_change_password voor de klas-startcode-flow. De kolom
    -- name BLIJFT de weergavenaam (voor+achter) en blijft in álle schermen + de bevroren
    -- quiz_answers.student_name — zo breekt er niets aan bestaande data.
    DO $$
    BEGIN
      BEGIN ALTER TABLE students ADD COLUMN email TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE students ADD COLUMN pass_hash TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE students ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE students ADD COLUMN first_name TEXT NOT NULL DEFAULT ''; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE students ADD COLUMN last_name  TEXT NOT NULL DEFAULT ''; EXCEPTION WHEN duplicate_column THEN NULL; END;
    END $$;
    -- e-mail overnemen van de oude google_email waar mogelijk (eenmalig, idempotent)
    UPDATE students SET email = google_email WHERE email IS NULL AND google_email IS NOT NULL;
    -- e-mail hoofdletter-ongevoelig uniek, maar enkel wanneer ingevuld (leerlingen zonder
    -- e-mail — bv. handmatig aangemaakt — mogen naast elkaar bestaan).
    CREATE UNIQUE INDEX IF NOT EXISTS idx_students_email_unique ON students (LOWER(email)) WHERE email IS NOT NULL;

    -- ── Sprint 52b: klas-startcode ────────────────────────────────────────────
    -- Eén code per klas die de leerkracht op het bord zet; leerlingen registreren zich
    -- ermee (52c). De leerkracht kan het venster sluiten/heropenen (start_code_active) en
    -- een nieuwe code genereren.
    DO $$
    BEGIN
      BEGIN ALTER TABLE classes ADD COLUMN start_code TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE classes ADD COLUMN start_code_active BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
    END $$;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_start_code ON classes (start_code) WHERE start_code IS NOT NULL;

    -- ── Sprint 64: schoollogo in de DATABANK (niet meer als bestandspad) ──────
    -- Een logo is klein (tientallen kB) en verandert bijna nooit, maar het moet wél
    -- mee in de back-up en een container-rebuild overleven. Vandaar BYTEA i.p.v. een
    -- pad op de schijf. logo_path blijft bestaan als terugval voor oude installaties.
    DO $$
    BEGIN
      BEGIN ALTER TABLE schools ADD COLUMN logo_blob BYTEA; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE schools ADD COLUMN logo_mime TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE schools ADD COLUMN logo_updated_at BIGINT; EXCEPTION WHEN duplicate_column THEN NULL; END;
    END $$;

    -- ── Sprint 52d: leerling-sessies (login) ──────────────────────────────────
    -- Spiegelt teacher_sessions, maar apart gehouden (isolatie leerling/leerkracht).
    CREATE TABLE IF NOT EXISTS student_sessions (
      token_hash TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      last_seen  BIGINT,
      user_agent TEXT NOT NULL DEFAULT '',
      ip         TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_student_sessions_student ON student_sessions(student_id);

    -- Sprint 19g: sessie-config persistent
    DO $$ BEGIN
      ALTER TABLE sessions ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}';
    EXCEPTION WHEN duplicate_column THEN NULL; END $$;

    -- Sprint 51a (Fase 2 — eigenaarschap): bestaande installaties krijgen de kolom
    -- via migratie (nieuwe installaties hebben ze al via de CREATE TABLE hierboven).
    DO $$ BEGIN
      ALTER TABLE sessions ADD COLUMN teacher_id TEXT REFERENCES teachers(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    CREATE INDEX IF NOT EXISTS idx_sessions_teacher ON sessions(teacher_id);

    -- Backfill bestaande rijen (eenmalig zinvol, verder altijd idempotent: raakt enkel
    -- rijen die nog géén eigenaar hebben). We kunnen de WERKELIJKE aanmaker van sessies
    -- van vóór deze sprint niet meer achterhalen — er werd nergens geregistreerd wie een
    -- sessie aanmaakte. Bij precies één leerkrachtaccount is er maar één mogelijke
    -- eigenaar; die kennen we dus wél zeker. Bij meerdere accounts blijft teacher_id
    -- bewust NULL ("onbekend/legacy") in plaats van te gokken.
    DO $$ BEGIN
      UPDATE sessions SET teacher_id = (SELECT id FROM teachers LIMIT 1)
        WHERE teacher_id IS NULL AND (SELECT COUNT(*) FROM teachers) = 1;
    EXCEPTION WHEN others THEN NULL; END $$;

    -- Sprint 51e: bij precies één leerkrachtaccount koppelen we alle bestaande klassen
    -- aan die leerkracht (teacher_classes). Zo klopt "leerkracht ziet enkel eigen klassen"
    -- meteen op een single-teacher install zónder iets te verbergen. Idempotent (ON CONFLICT).
    -- Bij meerdere accounts blijven bestaande klassen bewust ongekoppeld ("legacy" →
    -- zichtbaar voor iedereen tot iemand ze aanmaakt/claimt) — we kunnen de maker niet raden.
    DO $$ BEGIN
      INSERT INTO teacher_classes (teacher_id, class_id)
      SELECT (SELECT id FROM teachers LIMIT 1), c.id
        FROM classes c
       WHERE (SELECT COUNT(*) FROM teachers) = 1
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN others THEN NULL; END $$;

    -- Sprint 20a: audit-log leerkrachtenacties
    CREATE TABLE IF NOT EXISTS audit_log (
      id          TEXT PRIMARY KEY,
      actor       TEXT NOT NULL DEFAULT '',
      action      TEXT NOT NULL,
      target      TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}',
      ip          TEXT NOT NULL DEFAULT '',
      created_at  BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

    -- Sprint 21: stresstest historiek
    CREATE TABLE IF NOT EXISTS stress_results (
      id              TEXT PRIMARY KEY,
      test_type       TEXT NOT NULL,
      ran_at          BIGINT NOT NULL,
      duration_sec    INTEGER NOT NULL DEFAULT 0,
      params_json     TEXT NOT NULL DEFAULT '{}',
      runs_total      INTEGER NOT NULL DEFAULT 0,
      runs_ok         INTEGER NOT NULL DEFAULT 0,
      runs_failed     INTEGER NOT NULL DEFAULT 0,
      avg_run_ms      INTEGER,
      max_run_ms      INTEGER,
      ram_web_mb      INTEGER,
      ram_runner_mb   INTEGER,
      cpu_runner_pct  INTEGER,
      pg_queries      INTEGER,
      pg_avg_ms       INTEGER,
      pg_pool_used    INTEGER,
      stress_pct      INTEGER NOT NULL DEFAULT 0,
      stress_label    TEXT NOT NULL DEFAULT 'OK',
      log_filename    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stress_ran ON stress_results(ran_at DESC);

    -- ══ Sprint 16: Toetsmodule ════════════════════════════════════════════════

    -- Sprint 43.5: hernoemen quiz_bank -> question_bank, quiz_meta -> assignment_bank (data-behoudend)
    DO $$ BEGIN
      IF EXISTS (SELECT FROM information_schema.tables WHERE table_name='quiz_bank')
         AND NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name='question_bank')
      THEN ALTER TABLE quiz_bank RENAME TO question_bank; END IF;
    END $$;
    DO $$ BEGIN
      IF EXISTS (SELECT FROM information_schema.tables WHERE table_name='quiz_meta')
         AND NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name='assignment_bank')
      THEN ALTER TABLE quiz_meta RENAME TO assignment_bank; END IF;
    END $$;
    ALTER INDEX IF EXISTS idx_quiz_bank_subject  RENAME TO idx_question_bank_subject;
    ALTER INDEX IF EXISTS idx_quiz_bank_archived RENAME TO idx_question_bank_archived;

    CREATE TABLE IF NOT EXISTS question_bank (
      id              TEXT PRIMARY KEY,
      text            TEXT NOT NULL,
      subject         TEXT NOT NULL DEFAULT '',
      difficulty      TEXT NOT NULL DEFAULT 'gemiddeld',
      max_points      INTEGER NOT NULL DEFAULT 4,
      question_type   TEXT NOT NULL DEFAULT 'code',
      -- 'code' = Python editor, 'open' = vrije tekst,
      -- 'multiple' = meerdere juiste, 'single' = één juiste
      choices_json    TEXT NOT NULL DEFAULT '[]',
      -- JSON: [{"id":"uuid","text":"...","correct":true/false}]
      tags            TEXT NOT NULL DEFAULT '',
      -- 33d: komma-gescheiden vrije labels voor filtering (bv. "hoofdstuk3,herhaling")
      model_answer    TEXT NOT NULL DEFAULT '',
      -- 37b: modelantwoord/modelcode van de leerkracht (getoond in nakijk-modus)
      created_by   TEXT REFERENCES teachers(id) ON DELETE SET NULL,
      created_at   BIGINT NOT NULL,
      updated_at   BIGINT NOT NULL,
      archived     BOOLEAN NOT NULL DEFAULT false
    );
    -- Migratie: kolommen toevoegen als ze nog niet bestaan
    DO $$ BEGIN
      BEGIN ALTER TABLE question_bank ADD COLUMN question_type TEXT NOT NULL DEFAULT 'code'; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE question_bank ADD COLUMN choices_json TEXT NOT NULL DEFAULT '[]'; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE question_bank ADD COLUMN tags TEXT NOT NULL DEFAULT ''; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE question_bank ADD COLUMN model_answer TEXT NOT NULL DEFAULT ''; EXCEPTION WHEN duplicate_column THEN NULL; END;
      -- Sprint 51c: zichtbaarheid van een vraag. 'private' (default) = enkel de eigenaar,
      -- 'school' = collega's van dezelfde school, 'public' = elke leerkracht. Bestaande
      -- vragen worden bewust privé: delen is een expliciete keuze, geen automatisme.
      BEGIN ALTER TABLE question_bank ADD COLUMN share_scope TEXT NOT NULL DEFAULT 'private'; EXCEPTION WHEN duplicate_column THEN NULL; END;
      -- Sprint 53d: moderatie-vlag. Los van share_scope (dat is de keuze van de eigenaar);
      -- 'hidden' is een admin-takedown die een publiek/gedeeld item onzichtbaar maakt voor
      -- anderen zónder dat de eigenaar het meteen opnieuw kan delen.
      BEGIN ALTER TABLE question_bank ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
    END $$;
    CREATE INDEX IF NOT EXISTS idx_question_bank_subject ON question_bank(subject);
    CREATE INDEX IF NOT EXISTS idx_question_bank_archived ON question_bank(archived);
    CREATE INDEX IF NOT EXISTS idx_question_bank_scope ON question_bank(share_scope);

    -- ── Sprint 51c: sjablonen voor toetsen/taken (Bibliotheek) ───────────────
    -- Een sjabloon is een HERBRUIKBARE definitie, los van een levende sessie: geen
    -- klas, geen tijdvenster, geen leerlingen, geen antwoorden. Die krijg je pas bij
    -- het materialiseren ("Maak toets/taak"), dat een nieuwe sessie aanmaakt met de
    -- kopieerder als eigenaar. Een sjabloon overleeft dus het wissen van het origineel.
    -- Enkel de herbruikbare instellingen staan hier; moment-/klasgebonden velden bewust niet.
    CREATE TABLE IF NOT EXISTS assignment_templates (
      id            TEXT PRIMARY KEY,
      owner_id      TEXT REFERENCES teachers(id) ON DELETE SET NULL,
      type          TEXT NOT NULL DEFAULT 'toets',   -- 'toets' | 'taak'
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      subject       TEXT NOT NULL DEFAULT '',
      share_scope   TEXT NOT NULL DEFAULT 'private', -- 'private' | 'school' | 'public'
      randomize               BOOLEAN NOT NULL DEFAULT true,
      timer_seconds           INTEGER,
      no_timer                BOOLEAN NOT NULL DEFAULT false,
      individual_timer        BOOLEAN NOT NULL DEFAULT true,
      min_runs_per_q          INTEGER NOT NULL DEFAULT 0,
      hide_question_on_screen BOOLEAN NOT NULL DEFAULT false,
      review_mode             BOOLEAN NOT NULL DEFAULT false,
      auto_submit_late        BOOLEAN NOT NULL DEFAULT true,
      created_at    BIGINT NOT NULL,
      updated_at    BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assignment_templates_owner ON assignment_templates(owner_id);
    CREATE INDEX IF NOT EXISTS idx_assignment_templates_scope ON assignment_templates(share_scope);
    -- Sprint 53d: moderatie-vlag (admin-takedown), idem als op question_bank.
    DO $$
    BEGIN
      BEGIN ALTER TABLE assignment_templates ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
    END $$;

    -- De koppeltabel sjabloon ↔ vraag. Dit is een LEVENDE referentie naar question_bank
    -- (geen bevroren kopie): een gedeelde vraag "volgt" zo automatisch haar eigen scope.
    -- ON DELETE CASCADE op template_id ruimt de koppelingen op als het sjabloon verdwijnt.
    -- Op question_id staat GEEN cascade: een vraag die nog aan een sjabloon hangt mag niet
    -- zomaar verdwijnen (zie deleteQuizQuestion) — dat zou een sjabloon stilletjes uithollen.
    CREATE TABLE IF NOT EXISTS template_questions (
      template_id  TEXT NOT NULL REFERENCES assignment_templates(id) ON DELETE CASCADE,
      question_id  TEXT NOT NULL REFERENCES question_bank(id) ON DELETE RESTRICT,
      order_index  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (template_id, question_id)
    );
    CREATE INDEX IF NOT EXISTS idx_template_questions_template ON template_questions(template_id);
    CREATE INDEX IF NOT EXISTS idx_template_questions_question ON template_questions(question_id);

    CREATE TABLE IF NOT EXISTS quiz_question_snapshots (
      id               TEXT PRIMARY KEY,
      session_code     TEXT NOT NULL REFERENCES sessions(code) ON DELETE CASCADE,
      bank_question_id TEXT REFERENCES question_bank(id) ON DELETE SET NULL,
      order_index      INTEGER NOT NULL,
      text_snapshot    TEXT NOT NULL,
      subject          TEXT NOT NULL DEFAULT '',
      points           INTEGER NOT NULL DEFAULT 4,
      question_type    TEXT NOT NULL DEFAULT 'code',
      choices_json     TEXT NOT NULL DEFAULT '[]',
      model_answer     TEXT NOT NULL DEFAULT ''
    );
    DO $$ BEGIN
      BEGIN ALTER TABLE quiz_question_snapshots ADD COLUMN question_type TEXT NOT NULL DEFAULT 'code'; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE quiz_question_snapshots ADD COLUMN choices_json TEXT NOT NULL DEFAULT '[]'; EXCEPTION WHEN duplicate_column THEN NULL; END;
      -- 37b: modelantwoord bevroren bij de toets (kan per toets afwijken van de bankvraag)
      BEGIN ALTER TABLE quiz_question_snapshots ADD COLUMN model_answer TEXT NOT NULL DEFAULT ''; EXCEPTION WHEN duplicate_column THEN NULL; END;
    END $$;
    CREATE INDEX IF NOT EXISTS idx_quiz_snapshots_session
      ON quiz_question_snapshots(session_code);

    CREATE TABLE IF NOT EXISTS assignment_bank (
      session_code           TEXT PRIMARY KEY
                             REFERENCES sessions(code) ON DELETE CASCADE,
      randomize              BOOLEAN NOT NULL DEFAULT true,
      timer_seconds          INTEGER,
      no_timer               BOOLEAN NOT NULL DEFAULT false,
      individual_timer       BOOLEAN NOT NULL DEFAULT true,
      min_runs_per_q         INTEGER NOT NULL DEFAULT 0,
      hide_question_on_screen BOOLEAN NOT NULL DEFAULT false,
      results_released       BOOLEAN NOT NULL DEFAULT false,
      warning_shown          BOOLEAN NOT NULL DEFAULT false,
      is_teacher_preview     BOOLEAN NOT NULL DEFAULT false,
      school_year            TEXT NOT NULL DEFAULT '2025-2026',
      target_class           TEXT NOT NULL DEFAULT '',
      archived               BOOLEAN NOT NULL DEFAULT false,
      archived_at            BIGINT,
      access_from            BIGINT,   -- Sprint 19j: tijdsvenster start (NULL = direct)
      access_until           BIGINT,   -- Sprint 19j: tijdsvenster einde (NULL = geen limiet)
      auto_submit_late       BOOLEAN NOT NULL DEFAULT true,  -- Sprint 19j: auto-submit bij deadline
      review_mode            BOOLEAN NOT NULL DEFAULT false, -- Sprint 37d: leerling-nakijkmodus
      created_at             BIGINT NOT NULL
    );
    -- Migratie: voeg kolommen toe als ze nog niet bestaan (bij update)
    DO $$ BEGIN
      BEGIN ALTER TABLE assignment_bank ADD COLUMN no_timer BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE assignment_bank ADD COLUMN timer_seconds INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE assignment_bank ADD COLUMN school_year TEXT NOT NULL DEFAULT '2025-2026'; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE assignment_bank ADD COLUMN target_class TEXT NOT NULL DEFAULT ''; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE assignment_bank ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE assignment_bank ADD COLUMN archived_at BIGINT; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE assignment_bank ADD COLUMN access_from BIGINT; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE assignment_bank ADD COLUMN access_until BIGINT; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE assignment_bank ADD COLUMN auto_submit_late BOOLEAN NOT NULL DEFAULT true; EXCEPTION WHEN duplicate_column THEN NULL; END;
      -- 37d: nakijk-modus. Leerkracht stelt expliciet open; leerlingen kunnen dan
      -- hun eigen toets read-only inzien (los van results_released).
      BEGIN ALTER TABLE assignment_bank ADD COLUMN review_mode BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
      -- Sprint 43.3: expliciet type (toets|taak) i.p.v. afleiden uit no_timer
      BEGIN ALTER TABLE assignment_bank ADD COLUMN type TEXT NOT NULL DEFAULT 'toets'; EXCEPTION WHEN duplicate_column THEN NULL; END;
    END $$;

    -- Sprint 43.3: bestaande rijen krijgen hun type afgeleid uit no_timer (timerloos = taak).
    -- Eenmalig: enkel rijen die nog op de default staan én timerloos zijn.
    DO $$ BEGIN
      UPDATE assignment_bank SET type = 'taak' WHERE no_timer = true AND type = 'toets';
    EXCEPTION WHEN others THEN NULL; END $$;

    -- Sprint 43.4: welke leerlingen mogen deze toets/taak maken.
    -- GEEN rijen voor een session_code = ALLE leerlingen van de gekoppelde klas mogen.
    CREATE TABLE IF NOT EXISTS assignment_students (
      session_code TEXT NOT NULL REFERENCES sessions(code) ON DELETE CASCADE,
      student_id   TEXT NOT NULL REFERENCES students(id)   ON DELETE CASCADE,
      PRIMARY KEY (session_code, student_id)
    );
    CREATE INDEX IF NOT EXISTS idx_assignment_students_code ON assignment_students(session_code);

    CREATE TABLE IF NOT EXISTS quiz_answers (
      id               TEXT PRIMARY KEY,
      session_code     TEXT NOT NULL,
      student_id       TEXT NOT NULL,
      student_name     TEXT NOT NULL DEFAULT '',
      student_class    TEXT NOT NULL DEFAULT '',
      question_id      TEXT NOT NULL REFERENCES quiz_question_snapshots(id)
                       ON DELETE CASCADE,
      personal_order   INTEGER NOT NULL DEFAULT 0,
      code             TEXT NOT NULL DEFAULT '',
      run_count        INTEGER NOT NULL DEFAULT 0,
      first_visit_at   BIGINT,
      first_run_at     BIGINT,
      saved_at         BIGINT NOT NULL,
      submitted_at     BIGINT,
      auto_submitted   BOOLEAN NOT NULL DEFAULT false,
      score            INTEGER,
      teacher_comment  TEXT NOT NULL DEFAULT '',
      selected_choices TEXT NOT NULL DEFAULT '[]',
      -- JSON array van gekozen choice IDs (bij multiple/single)
      auto_scored      BOOLEAN NOT NULL DEFAULT false,
      UNIQUE(session_code, student_id, question_id)
    );
    DO $$ BEGIN
      BEGIN ALTER TABLE quiz_answers ADD COLUMN selected_choices TEXT NOT NULL DEFAULT '[]'; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE quiz_answers ADD COLUMN auto_scored BOOLEAN NOT NULL DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
    END $$;
    CREATE INDEX IF NOT EXISTS idx_quiz_answers_session
      ON quiz_answers(session_code);
    CREATE INDEX IF NOT EXISTS idx_quiz_answers_student
      ON quiz_answers(session_code, student_id);

    CREATE TABLE IF NOT EXISTS quiz_general_comments (
      session_code TEXT NOT NULL,
      student_id   TEXT NOT NULL,
      comment      TEXT NOT NULL DEFAULT '',
      updated_at   BIGINT NOT NULL,
      PRIMARY KEY(session_code, student_id)
    );

    CREATE TABLE IF NOT EXISTS quiz_student_order (
      session_code TEXT NOT NULL,
      student_id   TEXT NOT NULL,
      question_id  TEXT NOT NULL,
      personal_pos INTEGER NOT NULL,
      PRIMARY KEY(session_code, student_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS quiz_run_history (
      id           TEXT PRIMARY KEY,
      session_code TEXT NOT NULL,
      student_id   TEXT NOT NULL,
      question_id  TEXT NOT NULL,
      code         TEXT NOT NULL DEFAULT '',
      ran_at       BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_quiz_run_history
      ON quiz_run_history(session_code, student_id, question_id);

    CREATE TABLE IF NOT EXISTS quiz_comment_templates (
      id         TEXT PRIMARY KEY,
      text       TEXT NOT NULL,
      created_by TEXT REFERENCES teachers(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL
    );

    -- ═══ Sprint 48c1 (Fase 3): school_id op de kern-datatabellen ═══════════════
    -- De tenant-sleutel voor multi-tenancy. Hier ENKEL het schema + de migratie van
    -- bestaande data; de eigenlijke afdwinging (elke lees/schrijf gescoped op school)
    -- volgt in 48c2. Kolommen zijn NULLbaar en additief → bestaande installaties breken
    -- niet. ON DELETE SET NULL: een school verwijderen vernietigt nooit data (conform het
    -- DB-beleid), het maakt de rijen enkel school-loos.
    -- Leerkrachten hangen NIET via een eigen kolom aan een school, maar via de bestaande
    -- M:N-tabel teacher_schools (+ active_school_id op de sessie); een enkele teachers.school_id
    -- zou dat model tegenspreken. We backfillen dus teacher_schools i.p.v. een kolom.
    DO $$
    BEGIN
      BEGIN ALTER TABLE classes       ADD COLUMN school_id TEXT REFERENCES schools(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE students      ADD COLUMN school_id TEXT REFERENCES schools(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE question_bank ADD COLUMN school_id TEXT REFERENCES schools(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE sessions      ADD COLUMN school_id TEXT REFERENCES schools(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END;
      BEGIN ALTER TABLE audit_log     ADD COLUMN school_id TEXT REFERENCES schools(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END;
    END $$;
    CREATE INDEX IF NOT EXISTS idx_classes_school       ON classes(school_id);
    CREATE INDEX IF NOT EXISTS idx_students_school       ON students(school_id);
    CREATE INDEX IF NOT EXISTS idx_question_bank_school  ON question_bank(school_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_school       ON sessions(school_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_school      ON audit_log(school_id);

    -- Migratie van bestaande data → "school 1": enkel wanneer er PRECIES ÉÉN school
    -- bestaat (single-school install). Bij 0 of meerdere scholen laten we school_id
    -- bewust NULL — dan valt de juiste school niet eenduidig af te leiden en gokken we niet
    -- (conform DB-beleid). Idempotent: enkel NULL-rijen worden ingevuld.
    DO $$
    DECLARE enige_school TEXT;
    BEGIN
      IF (SELECT COUNT(*) FROM schools) = 1 THEN
        SELECT id INTO enige_school FROM schools LIMIT 1;
        UPDATE classes       SET school_id = enige_school WHERE school_id IS NULL;
        UPDATE students      SET school_id = enige_school WHERE school_id IS NULL;
        UPDATE question_bank SET school_id = enige_school WHERE school_id IS NULL;
        UPDATE sessions      SET school_id = enige_school WHERE school_id IS NULL;
        UPDATE audit_log     SET school_id = enige_school WHERE school_id IS NULL;
        INSERT INTO teacher_schools (teacher_id, school_id)
          SELECT t.id, enige_school FROM teachers t
          ON CONFLICT DO NOTHING;
      END IF;
    END $$;
  `);
  console.log('[db] Schema geïnitialiseerd (PostgreSQL)');
}

// ── Public API (async) ─────────────────────────────────────────────────────────
module.exports = {

  // 27l: query direct exporteren zodat server.js DB viewer endpoints hem kunnen gebruiken
  query,

  // 36a: transactie-helper voor multi-step schrijfacties (getest in tests/)
  withTransaction,

  // Initialiseer schema — aanroepen bij serverstart
  async init() {
    await initSchema();
  },

  // ── Teachers ─────────────────────────────────────────────────────────────────
  async getTeacherByUsername(username) {
    const r = await query(
      `SELECT * FROM teachers WHERE LOWER(username) = LOWER($1) LIMIT 1`,
      [username]
    );
    return r.rows[0] || null;
  },

  async createTeacher(username, passHash, displayName = '', role = 'teacher') {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO teachers (id, username, pass_hash, display_name, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, username, passHash, displayName, role, Date.now()]
    );
    return id;
  },

  async updateLastLogin(id) {
    await query(`UPDATE teachers SET last_login = $1 WHERE id = $2`, [Date.now(), id]);
  },

  // ── Sprint 50a: login-sessies per leerkracht ───────────────────────────────
  // Deze laag ziet enkel de HASH van het token, nooit het token zelf. Het echte
  // token bestaat alleen in de cookie van de browser en even in het geheugen van
  // server.js. Lekt de databank, dan zijn de sessies daarmee niet bruikbaar.

  async createTeacherSession({ tokenHash, teacherId, expiresAt, userAgent = '', ip = '', activeSchoolId = null }) {
    const now = Date.now();
    await query(
      `INSERT INTO teacher_sessions (token_hash, teacher_id, created_at, expires_at, last_seen, user_agent, ip, active_school_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tokenHash, teacherId, now, expiresAt, now, String(userAgent).slice(0, 200),
       String(ip).slice(0, 64), activeSchoolId]
    );
    return tokenHash;
  },

  // Sprint 48b1/48b2: de actieve school van een lopende sessie zetten.
  // Server-side, dus de browser kan dit nooit zelf bepalen.
  async setSessionActiveSchool(tokenHash, schoolId) {
    const r = await query(
      `UPDATE teacher_sessions SET active_school_id = $1 WHERE token_hash = $2`,
      [schoolId, tokenHash]
    );
    return r.rowCount > 0;
  },

  // Geeft de sessie mét de leerkracht erbij, of null als ze niet bestaat of verlopen is.
  // Verlopen sessies geven bewust null i.p.v. een rij: zo kan een aanroeper niet per
  // ongeluk een verlopen sessie als geldig behandelen.
  async getTeacherSession(tokenHash) {
    // LEFT JOIN op scholen: een sessie zonder actieve school is normaal (nog geen school
    // gekoppeld, of nog niet gekozen) en mag zeker niet wegvallen uit het resultaat.
    const r = await query(
      `SELECT s.token_hash, s.teacher_id, s.created_at, s.expires_at, s.last_seen,
              s.active_school_id, sc.name AS active_school_name,
              t.username, t.display_name, t.role
         FROM teacher_sessions s
         JOIN teachers t ON t.id = s.teacher_id
         LEFT JOIN schools sc ON sc.id = s.active_school_id
        WHERE s.token_hash = $1 AND s.expires_at > $2
        LIMIT 1`,
      [tokenHash, Date.now()]
    );
    return r.rows[0] || null;
  },

  // Sprint 50d: verlengt de sessie en registreert activiteit.
  // Enkel aangeroepen wanneer de rekenregel zegt dat het nodig is (halfweg de looptijd),
  // dus dit is géén schrijfactie per verzoek.
  async touchTeacherSession(tokenHash, expiresAt) {
    await query(
      `UPDATE teacher_sessions SET expires_at = $1, last_seen = $2 WHERE token_hash = $3`,
      [expiresAt, Date.now(), tokenHash]
    );
  },

  async deleteTeacherSession(tokenHash) {
    await query(`DELETE FROM teacher_sessions WHERE token_hash = $1`, [tokenHash]);
  },

  // Bij wachtwoordwijziging of verwijdering: alle sessies van die leerkracht weg.
  async deleteTeacherSessionsFor(teacherId) {
    await query(`DELETE FROM teacher_sessions WHERE teacher_id = $1`, [teacherId]);
  },

  // Opruimen — anders groeit de tabel eeuwig aan met dode sessies.
  async deleteExpiredTeacherSessions() {
    const r = await query(`DELETE FROM teacher_sessions WHERE expires_at <= $1`, [Date.now()]);
    return r.rowCount || 0;
  },

  async listTeacherSessions(teacherId) {
    const r = await query(
      `SELECT token_hash, created_at, expires_at, last_seen, user_agent, ip
         FROM teacher_sessions WHERE teacher_id = $1 ORDER BY created_at DESC`,
      [teacherId]
    );
    return r.rows;
  },

  async listTeachers() {
    const r = await query(
      `SELECT id, username, display_name, role, created_at, last_login FROM teachers ORDER BY created_at`
    );
    return r.rows;
  },

  async deleteTeacher(username) {
    const r = await query(
      `DELETE FROM teachers WHERE LOWER(username) = LOWER($1)`, [username]
    );
    return r.rowCount > 0;
  },

  async updatePassHash(username, passHash) {
    const r = await query(
      `UPDATE teachers SET pass_hash = $1 WHERE LOWER(username) = LOWER($2)`,
      [passHash, username]
    );
    return r.rowCount > 0;
  },

  // ── Sprint 55: beheer-lijsten (gegroepeerd per school) ─────────────────────
  // scholenIds = null → super-admin/open: alles; anders enkel die scholen (admin)
  // plus school-loze rijen (legacy, mag niet onzichtbaar worden).
  async listClassesBeheer(scholenIds = null, includeArchived = false, schoolYear = null) {
    const params = [includeArchived, scholenIds];
    let yearFilter = '';
    if (schoolYear) { params.push(schoolYear); yearFilter = ` AND c.school_year = $${params.length}`; }
    const r = await query(
      `SELECT c.*, sch.name AS school_name, COUNT(m.student_id)::int AS student_count,
              -- Sprint 57: gekoppelde leerkrachten meegeven zodat Beheer ze kan tonen
              COALESCE((
                SELECT json_agg(json_build_object('id', t.id, 'username', t.username,
                                                  'displayName', t.display_name)
                                ORDER BY LOWER(COALESCE(t.display_name, t.username)))
                  FROM teacher_classes tc JOIN teachers t ON t.id = tc.teacher_id
                 WHERE tc.class_id = c.id
              ), '[]'::json) AS teachers
         FROM classes c
         LEFT JOIN schools sch ON sch.id = c.school_id
         LEFT JOIN class_memberships m
                ON m.class_id = c.id AND m.school_year = c.school_year
        WHERE ($1 OR c.archived = false)${yearFilter}
          AND ($2::text[] IS NULL OR c.school_id = ANY($2) OR c.school_id IS NULL)
        GROUP BY c.id, sch.name
        ORDER BY sch.name NULLS LAST, c.school_year DESC, c.name`,
      params
    );
    return r.rows;
  },

  // Eén rij per klas-lidmaatschap (leerling zonder klas → één rij met class_name NULL),
  // zodat de UI per school → klas kan groeperen.
  async listStudentsBeheer(scholenIds = null, includeBlocked = true) {
    const r = await query(
      `SELECT s.*, c.name AS class_name, c.school_year,
              COALESCE(c.school_id, s.school_id) AS groep_school_id,
              sch.name AS school_name
         FROM students s
         LEFT JOIN class_memberships m ON m.student_id = s.id
         LEFT JOIN classes c ON c.id = m.class_id AND c.school_year = m.school_year
         LEFT JOIN schools sch ON sch.id = COALESCE(c.school_id, s.school_id)
        WHERE ($1 OR s.status != 'blocked')
          AND ($2::text[] IS NULL OR COALESCE(c.school_id, s.school_id) = ANY($2)
               OR COALESCE(c.school_id, s.school_id) IS NULL)
        ORDER BY sch.name NULLS LAST, c.name NULLS LAST, s.name`,
      [includeBlocked, scholenIds]
    );
    return r.rows;
  },

  // Sprint 56: zit deze leerling in een klas waaraan deze leerkracht gekoppeld is?
  async isStudentInTeachersClasses(studentId, teacherId) {
    if (!studentId || !teacherId) return false;
    const r = await query(
      `SELECT 1 FROM class_memberships m
         JOIN teacher_classes tc ON tc.class_id = m.class_id
        WHERE m.student_id = $1 AND tc.teacher_id = $2 LIMIT 1`,
      [studentId, teacherId]);
    return r.rows.length > 0;
  },

  // Delen actor en doel minstens één school? (rolwijziging door een admin, 55)
  async delenSchool(teacherA, teacherB) {
    const r = await query(
      `SELECT 1 FROM teacher_schools a JOIN teacher_schools b ON b.school_id = a.school_id
        WHERE a.teacher_id = $1 AND b.teacher_id = $2 LIMIT 1`,
      [teacherA, teacherB]
    );
    return r.rows.length > 0;
  },

  // Sprint 48c4: bestaat er al een super-admin? (voor de bootstrap-regel bij rolwijziging)
  async heeftSuperAdmin() {
    const r = await query(`SELECT 1 FROM teachers WHERE role = 'superadmin' LIMIT 1`);
    return r.rows.length > 0;
  },

  async updateTeacherRole(username, role) {
    const r = await query(
      `UPDATE teachers SET role = $1 WHERE LOWER(username) = LOWER($2)`,
      [role, username]
    );
    return r.rowCount > 0;
  },

  // ── Sessions ──────────────────────────────────────────────────────────────────
  async persistSession(session) {
    const students = {};
    for (const [sid, s] of Object.entries(session.students || {})) {
      if (s.removed) continue;
      students[sid] = {
        id: s.id, name: s.name,
        code: s.code, personalCode: s.personalCode || '',
        personalOutput: '', output: '',
        socketId: null, runId: null,
        canRun: s.canRun, canEdit: s.canEdit,
        personalCanRun: s.personalCanRun, personalCanEdit: s.personalCanEdit,
        removed: false,
      };
    }
    await query(`
      INSERT INTO sessions
        (code, id, name, mode, editor_assist, created_at, closed, blocked, deleted,
         shared_code, announcement, workspace_mode, students_json, config_json, teacher_id, school_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (code) DO UPDATE SET
        name           = EXCLUDED.name,
        closed         = EXCLUDED.closed,
        blocked        = EXCLUDED.blocked,
        deleted        = EXCLUDED.deleted,
        shared_code    = EXCLUDED.shared_code,
        announcement   = EXCLUDED.announcement,
        workspace_mode = EXCLUDED.workspace_mode,
        students_json  = EXCLUDED.students_json,
        config_json    = EXCLUDED.config_json
        -- Sprint 51a: teacher_id BEWUST niet in de UPDATE SET — de eigenaar staat vast
        -- bij aanmaken en verandert niet meer bij latere persist-calls (autosave, sluiten, …).
    `, [
      session.code,
      session.id,
      session.name,
      session.mode,
      session.editorAssist ? 1 : 0,
      session.createdAt || Date.now(),
      session.closed  ? 1 : 0,
      session.blocked ? 1 : 0,
      session.deleted ? 1 : 0,
      session.sharedCode    || '',
      session.announcement  || '',
      session.classWorkspaceMode || 'shared',
      JSON.stringify(students),
      JSON.stringify(session.config || {}),
      session.teacherId || null,
      // Sprint 48c2: school_id wordt (net als teacher_id) bij aanmaak gezet en NIET in de
      // ON CONFLICT UPDATE herzien — de tenant van een sessie ligt vast.
      session.schoolId || null,
    ]);
  },

  async loadActiveSessions() {
    const r = await query(
      `SELECT * FROM sessions WHERE deleted = 0 AND closed = 0`
    );
    return r.rows.map(row => ({
      code:               row.code,
      id:                 row.id,
      name:               row.name,
      mode:               row.mode,
      editorAssist:       row.editor_assist === 1,
      createdAt:          Number(row.created_at),
      closed:             row.closed   === 1,
      blocked:            row.blocked  === 1,
      deleted:            row.deleted  === 1,
      sharedCode:         row.shared_code,
      announcement:       row.announcement,
      config:             (() => { try { return JSON.parse(row.config_json || '{}'); } catch { return {}; } })(),
      classWorkspaceMode: row.workspace_mode,
      students:           JSON.parse(row.students_json || '{}'),
      teacherId:          row.teacher_id || null, // Sprint 51a: eigenaar
      schoolId:           row.school_id || null,  // Sprint 48c2: tenant
      teacherSocketId: null, selectedStudentId: null,
      sharedOutput: '', teacherRunId: null, teacherPreviewOutput: '',
      statusText: 'Hersteld na herstart', statusType: 'info',
      sharedCodeRevision: 0, sharedCodeSourceSocketId: null,
      announcementVersion: 0,
    }));
  },

  async loadClosedSessions() {
    try {
      const r = await query(
        `SELECT * FROM sessions WHERE closed = 1 AND deleted = 0 ORDER BY created_at DESC LIMIT 100`
      );
      return r.rows.map(row => ({
        code:        row.code,
        id:          row.id,
        name:        row.name,
        mode:        row.mode,
        editorAssist: row.editor_assist === 1,
        createdAt:   Number(row.created_at),
        closed:      true,
        deleted:     row.deleted === 1,
        studentCount: 0,
        teacherId:   row.teacher_id || null, // Sprint 51b: eigenaar, voor lijst-filtering
        schoolId:    row.school_id || null,  // Sprint 48c2b: voor school-scoping van de lijst
      }));
    } catch { return []; }
  },

  // ── Sprint 51b (Fase 2 — autorisatie): eigenaar van één sessie ophalen ────────
  // Bron van waarheid is de databank, zodat dit óók klopt voor sessies die niet (meer)
  // in het geheugen staan (gesloten/gearchiveerde toetsen). Geeft:
  //   { found: false }                → sessie bestaat niet
  //   { found: true, teacherId: … }   → teacherId is de eigenaar, of null (legacy/onbekend)
  async getSessionOwner(code) {
    const r = await query(`SELECT teacher_id FROM sessions WHERE code = $1`, [code]);
    if (!r.rows.length) return { found: false, teacherId: null };
    return { found: true, teacherId: r.rows[0].teacher_id || null };
  },

  async markSessionDeleted(code) {
    await query(`UPDATE sessions SET deleted = 1 WHERE code = $1`, [code]);
  },

  async markSessionClosed(code) {
    await query(`UPDATE sessions SET closed = 1 WHERE code = $1`, [code]);
  },

  // ── Annotaties ────────────────────────────────────────────────────────────────
  async saveAnnotations(sessionCode, annotations) {
    try {
      const json = JSON.stringify(annotations || []);
      await query(`
        INSERT INTO session_annotations (session_code, annotations_json, updated_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (session_code) DO UPDATE SET
          annotations_json = EXCLUDED.annotations_json,
          updated_at       = EXCLUDED.updated_at
      `, [sessionCode, json, Date.now()]);
    } catch (e) { console.error('[db] saveAnnotations:', e.message); }
  },

  async getAnnotations(sessionCode) {
    try {
      const r = await query(
        `SELECT annotations_json FROM session_annotations WHERE session_code = $1`,
        [sessionCode]
      );
      return r.rows[0] ? JSON.parse(r.rows[0].annotations_json) : [];
    } catch { return []; }
  },

  // ── Snapshots ─────────────────────────────────────────────────────────────────
  async saveSnapshot(sessionCode, studentId, studentName, code) {
    try {
      await query(`
        INSERT INTO code_snapshots (id, session_code, student_id, student_name, timestamp, code)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [crypto.randomUUID(), sessionCode, studentId, studentName, Date.now(), code]);
    } catch (e) { /* stil falen — snapshot niet kritisch */ }
  },

  async getSnapshots(sessionCode, studentId) {
    const r = await query(`
      SELECT id, timestamp, code, student_name
      FROM code_snapshots
      WHERE session_code = $1 AND student_id = $2
      ORDER BY timestamp ASC
    `, [sessionCode, studentId]);
    return r.rows;
  },

  async deleteSnapshotsForSession(sessionCode) {
    await query(`DELETE FROM code_snapshots WHERE session_code = $1`, [sessionCode]);
  },

  // ── Klassen (Sprint 12b) ──────────────────────────────────────────────────────
  // Sprint 41: optioneel filteren op schooljaar.
  async listClasses(includeArchived = false, schoolYear = null) {
    // Sprint 40: leerlingtelling via class_memberships (matcht op klas + schooljaar).
    const params = [includeArchived];
    let yearFilter = '';
    if (schoolYear) { params.push(schoolYear); yearFilter = ` AND c.school_year = $${params.length}`; }
    const r = await query(
      `SELECT c.*, COUNT(m.student_id)::int AS student_count
       FROM classes c
       LEFT JOIN class_memberships m
              ON m.class_id = c.id AND m.school_year = c.school_year
       WHERE ($1 OR c.archived = false)${yearFilter}
       GROUP BY c.id
       ORDER BY c.school_year DESC, c.name`,
      params
    );
    return r.rows;
  },

  // Sprint 41: alle schooljaren waarvoor klassen bestaan (bron van waarheid voor
  // het membership-model). Nieuwste eerst. Met per jaar of het volledig gearchiveerd is.
  async getSchoolYears() {
    const r = await query(
      `SELECT c.school_year,
              bool_and(c.archived) AS all_archived,
              COUNT(*)::int        AS class_count
         FROM classes c
        GROUP BY c.school_year
        ORDER BY c.school_year DESC`
    );
    return r.rows.map(row => ({
      schoolYear: row.school_year,
      allArchived: row.all_archived === true,
      classCount: row.class_count,
    }));
  },

  // Sprint 41: is deze klas gearchiveerd? Wordt gebruikt om schrijfacties op
  // gearchiveerde (read-only) jaren server-side te weigeren.
  async isClassArchived(classId) {
    const r = await query(`SELECT archived FROM classes WHERE id = $1`, [classId]);
    if (!r.rows.length) return null; // klas bestaat niet
    return r.rows[0].archived === true;
  },

  // ── Sprint 48a1: scholen ───────────────────────────────────────────────────

  async listSchools(includeInactive = false) {
    const r = await query(
      `SELECT id, name, logo_path, license, contact, active, created_at,
              logo_mime, logo_updated_at, (logo_blob IS NOT NULL) AS heeft_logo
         FROM schools ${includeInactive ? '' : 'WHERE active = true'}
        ORDER BY LOWER(name)`
    );
    return r.rows;
  },

  async getSchool(id) {
    // Sprint 64: bewust NIET `SELECT *` — logo_blob zou dan bij elke paginalading
    // meekomen. We geven enkel de vlag mee dat er een logo ís.
    const r = await query(
      `SELECT id, name, logo_path, license, contact, active, created_at,
              logo_mime, logo_updated_at, (logo_blob IS NOT NULL) AS heeft_logo
         FROM schools WHERE id = $1`, [id]);
    return r.rows[0] || null;
  },

  // ── Sprint 48c1: standaardschool + dekkingscontrole ─────────────────────────
  // De "standaardschool" bestaat enkel eenduidig bij een single-school install: dan is er
  // precies één school en hoort alles daaraan. Bij 0 of meerdere scholen → null (ambigu).
  async getStandaardSchoolId() {
    const c = await query(`SELECT COUNT(*)::int AS n FROM schools`);
    if (c.rows[0].n !== 1) return null;
    const r = await query(`SELECT id FROM schools LIMIT 1`);
    return r.rows[0]?.id || null;
  },

  // Hoeveel rijen hebben nog GÉÉN school_id, per tabel? Handig om na de 48c1-migratie te
  // controleren dat "alle bestaande data aan school 1 hangt" (alles 0), en later voor de
  // isolatietests (48c3).
  async schoolDekking() {
    const r = await query(`
      SELECT
        (SELECT COUNT(*)::int FROM classes       WHERE school_id IS NULL) AS classes_zonder,
        (SELECT COUNT(*)::int FROM students      WHERE school_id IS NULL) AS students_zonder,
        (SELECT COUNT(*)::int FROM question_bank WHERE school_id IS NULL) AS question_bank_zonder,
        (SELECT COUNT(*)::int FROM sessions      WHERE school_id IS NULL) AS sessions_zonder,
        (SELECT COUNT(*)::int FROM audit_log     WHERE school_id IS NULL) AS audit_log_zonder
    `);
    return r.rows[0];
  },

  // ── Sprint 64: schoollogo als blob ─────────────────────────────────────────
  async setSchoolLogo(id, buffer, mime) {
    const r = await query(
      `UPDATE schools SET logo_blob = $2, logo_mime = $3, logo_updated_at = $4 WHERE id = $1`,
      [id, buffer, mime, Date.now()]
    );
    return r.rowCount > 0;
  },

  // Enkel de metadata (voor lijsten) — haalt de blob NIET op, dat scheelt geheugen.
  async getSchoolLogoInfo(id) {
    const r = await query(
      `SELECT logo_mime, logo_updated_at, (logo_blob IS NOT NULL) AS heeft_logo,
              COALESCE(LENGTH(logo_blob), 0)::int AS bytes
         FROM schools WHERE id = $1`, [id]);
    return r.rows[0] || null;
  },

  async getSchoolLogo(id) {
    const r = await query(
      `SELECT logo_blob, logo_mime, logo_updated_at FROM schools WHERE id = $1`, [id]);
    const rij = r.rows[0];
    if (!rij || !rij.logo_blob) return null;
    return { data: rij.logo_blob, mime: rij.logo_mime || 'image/png', updatedAt: Number(rij.logo_updated_at) || 0 };
  },

  async deleteSchoolLogo(id) {
    const r = await query(
      `UPDATE schools SET logo_blob = NULL, logo_mime = NULL, logo_updated_at = $2 WHERE id = $1`,
      [id, Date.now()]);
    return r.rowCount > 0;
  },

  async createSchool({ name, logoPath = '', license = '', contact = '' }) {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO schools (id, name, logo_path, license, contact, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, name, logoPath, license, contact, Date.now()]
    );
    return id;
  },

  // Enkel meegegeven velden wijzigen — zo kan een scherm één veld aanpassen zonder
  // de rest per ongeluk leeg te maken.
  async updateSchool(id, velden = {}) {
    const kolommen = { name: 'name', logoPath: 'logo_path', license: 'license',
                       contact: 'contact', active: 'active' };
    const sets = [], waarden = [];
    for (const [sleutel, kolom] of Object.entries(kolommen)) {
      if (velden[sleutel] !== undefined) {
        waarden.push(velden[sleutel]);
        sets.push(`${kolom} = $${waarden.length}`);
      }
    }
    if (!sets.length) return false;
    waarden.push(id);
    const r = await query(`UPDATE schools SET ${sets.join(', ')} WHERE id = $${waarden.length}`, waarden);
    return r.rowCount > 0;
  },

  async deleteSchool(id) {
    const r = await query(`DELETE FROM schools WHERE id = $1`, [id]);
    return r.rowCount > 0;
  },

  async createClass(name, schoolYear = '2025-2026', schoolId = null) {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO classes (id, name, school_year, school_id, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [id, name, schoolYear, schoolId, Date.now()]
    );
    return id;
  },

  async archiveClass(id) {
    await query(`UPDATE classes SET archived = true WHERE id = $1`, [id]);
  },

  async deleteClass(id) {
    const r = await query(`DELETE FROM classes WHERE id = $1`, [id]);
    return r.rowCount > 0;
  },

  // ── Sprint 48a2: leerkracht ↔ school ───────────────────────────────────────

  // ── Sprint 48a3: e-maildomeinen per school ─────────────────────────────────

  async listSchoolDomains(schoolId) {
    const r = await query(
      `SELECT domain FROM school_domains WHERE school_id = $1 ORDER BY domain`, [schoolId]
    );
    return r.rows.map(x => x.domain);
  },

  async addSchoolDomain(schoolId, domain) {
    await query(
      `INSERT INTO school_domains (school_id, domain) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [schoolId, domain]
    );
  },

  async removeSchoolDomain(schoolId, domain) {
    const r = await query(
      `DELETE FROM school_domains WHERE school_id = $1 AND domain = $2`, [schoolId, domain]
    );
    return r.rowCount > 0;
  },

  // Bij welke school hoort dit adres? Geeft null als geen enkel domein past.
  // Straks de kern van de zelfregistratie (52c): het domein zegt WELKE school,
  // de klascode zegt welke klas. Komen ze niet overeen → weigeren.
  // De vergelijking gebeurt in JS en niet in SQL, want de wildcard-regel
  // ('*.athkiel.be' dekt niet 'athkiel.be') is met LIKE niet correct uit te drukken.
  async findSchoolByEmailDomain(email, matcher) {
    const r = await query(
      `SELECT sd.school_id, sd.domain, s.name, s.active
         FROM school_domains sd JOIN schools s ON s.id = sd.school_id`
    );
    const treffer = r.rows.find(rij => matcher(email, rij.domain));
    return treffer || null;
  },

  async linkTeacherSchool(teacherId, schoolId) {
    await query(
      `INSERT INTO teacher_schools (teacher_id, school_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [teacherId, schoolId]
    );
  },

  async unlinkTeacherSchool(teacherId, schoolId) {
    await query(
      `DELETE FROM teacher_schools WHERE teacher_id = $1 AND school_id = $2`,
      [teacherId, schoolId]
    );
  },

  // De scholen van één leerkracht. Dit is straks de bron voor het keuzescherm (48b2),
  // dus enkel ACTIEVE scholen: je kan niet inloggen op een school die niet meer draait.
  async getSchoolsForTeacher(teacherId, includeInactive = false) {
    const r = await query(
      `SELECT s.id, s.name, s.logo_path, s.active
         FROM teacher_schools ts
         JOIN schools s ON s.id = ts.school_id
        WHERE ts.teacher_id = $1 ${includeInactive ? '' : 'AND s.active = true'}
        ORDER BY LOWER(s.name)`,
      [teacherId]
    );
    return r.rows;
  },

  async getTeachersForSchool(schoolId) {
    const r = await query(
      `SELECT t.id, t.username, t.display_name, t.role
         FROM teacher_schools ts
         JOIN teachers t ON t.id = ts.teacher_id
        WHERE ts.school_id = $1
        ORDER BY LOWER(t.username)`,
      [schoolId]
    );
    return r.rows;
  },

  async linkTeacherClass(teacherId, classId) {
    await query(
      `INSERT INTO teacher_classes (teacher_id, class_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [teacherId, classId]
    );
  },

  async unlinkTeacherClass(teacherId, classId) {
    await query(
      `DELETE FROM teacher_classes WHERE teacher_id = $1 AND class_id = $2`,
      [teacherId, classId]
    );
  },

  async getClassesForTeacher(teacherId) {
    const r = await query(
      `SELECT c.* FROM classes c
       JOIN teacher_classes tc ON tc.class_id = c.id
       WHERE tc.teacher_id = $1 AND c.archived = false
       ORDER BY c.name`,
      [teacherId]
    );
    return r.rows;
  },

  // Sprint 51e: is deze leerkracht aan deze klas gekoppeld? (voor klasbeheer-rechten)
  async isTeacherLinkedToClass(teacherId, classId) {
    if (!teacherId || !classId) return false;
    const r = await query(
      `SELECT 1 FROM teacher_classes WHERE teacher_id = $1 AND class_id = $2 LIMIT 1`,
      [teacherId, classId]
    );
    return r.rows.length > 0;
  },

  async getClassById(id) {
    const r = await query(`SELECT * FROM classes WHERE id = $1`, [id]);
    return r.rows[0] || null;
  },

  // ── Sprint 52b: klas-startcode ─────────────────────────────────────────────
  async classCodeInGebruik(code) {
    const r = await query(`SELECT 1 FROM classes WHERE start_code = $1 LIMIT 1`, [code]);
    return r.rows.length > 0;
  },

  async setClassStartCode(classId, code, active = true) {
    const r = await query(
      `UPDATE classes SET start_code = $2, start_code_active = $3 WHERE id = $1`,
      [classId, code, !!active]
    );
    return r.rowCount > 0;
  },

  async setClassStartCodeActive(classId, active) {
    const r = await query(
      `UPDATE classes SET start_code_active = $2 WHERE id = $1`, [classId, !!active]
    );
    return r.rowCount > 0;
  },

  // De klas die bij een ACTIEVE startcode hoort (voor zelfregistratie, 52c).
  // Inactieve of onbestaande code → null (registratie geweigerd).
  async getClassByActiveStartCode(code) {
    if (!code) return null;
    const r = await query(
      `SELECT * FROM classes WHERE start_code = $1 AND start_code_active = true AND archived = false LIMIT 1`,
      [code]
    );
    return r.rows[0] || null;
  },

  // Sprint 51e: klassenlijst zoals listClasses (incl. leerlingtelling + jaar/archief-filter),
  // maar beperkt tot wat deze leerkracht mag zien: een admin ziet alles; een leerkracht ziet
  // klassen waaraan hij gekoppeld is (teacher_classes) plus klassen zónder enige koppeling
  // ("legacy" → nog niemands eigendom, blijft zichtbaar zodat niets breekt).
  async listClassesVisibleTo({ teacherId = null, isAdmin = false, includeArchived = false, schoolYear = null, actieveSchoolId = null } = {}) {
    // Sprint 48c2b: óók de admin volgt de actieve school (de cross-school super-admin
    // komt in 48c4). NULL-rijen (legacy/school-loos) blijven altijd zichtbaar.
    if (isAdmin) {
      const params = [includeArchived, actieveSchoolId];
      let yearFilter = '';
      if (schoolYear) { params.push(schoolYear); yearFilter = ` AND c.school_year = $${params.length}`; }
      const r = await query(
        `SELECT c.*, COUNT(m.student_id)::int AS student_count
           FROM classes c
           LEFT JOIN class_memberships m
                  ON m.class_id = c.id AND m.school_year = c.school_year
          WHERE ($1 OR c.archived = false)${yearFilter}
            AND (c.school_id IS NULL OR $2::text IS NULL OR c.school_id = $2)
          GROUP BY c.id
          ORDER BY c.school_year DESC, c.name`,
        params
      );
      return r.rows;
    }
    const params = [includeArchived, teacherId, actieveSchoolId];
    let yearFilter = '';
    if (schoolYear) { params.push(schoolYear); yearFilter = ` AND c.school_year = $${params.length}`; }
    const r = await query(
      `SELECT c.*, COUNT(m.student_id)::int AS student_count
         FROM classes c
         LEFT JOIN class_memberships m
                ON m.class_id = c.id AND m.school_year = c.school_year
        WHERE ($1 OR c.archived = false)${yearFilter}
          AND (
            EXISTS (SELECT 1 FROM teacher_classes tc WHERE tc.class_id = c.id AND tc.teacher_id = $2)
            OR NOT EXISTS (SELECT 1 FROM teacher_classes tc WHERE tc.class_id = c.id)
          )
          AND (c.school_id IS NULL OR $3::text IS NULL OR c.school_id = $3)
        GROUP BY c.id
        ORDER BY c.school_year DESC, c.name`,
      params
    );
    return r.rows;
  },

  // ── Leerlingen (Sprint 12c, herzien in sprint 40) ─────────────────────────────
  // Een leerling is een persoon; het klaslidmaatschap zit in class_memberships.
  // listStudents(classId) geeft de leerlingen van één klas (via de koppeltabel),
  // met class_name en school_year erbij. Zonder classId: alle leerlingen, elk met
  // hun (eventuele) lidmaatschappen samengevat.
  async listStudents(classId = null, includeBlocked = true, actieveSchoolId = null) {
    if (classId) {
      // Eén specifieke klas: de klas zélf is al de scope (48c2b hoeft hier niet te filteren —
      // wie de klas mag zien is de vraag van magKlasZien/listClassesVisibleTo).
      const r = await query(
        `SELECT s.*, c.name AS class_name, c.school_year, m.status AS membership_status
         FROM class_memberships m
         JOIN students s ON s.id = m.student_id
         JOIN classes  c ON c.id = m.class_id AND c.school_year = m.school_year
         WHERE m.class_id = $1
           AND ($2 OR s.status != 'blocked')
         ORDER BY s.name`,
        [classId, includeBlocked]
      );
      return r.rows;
    }
    // Geen klas opgegeven: alle leerlingen (persoon), met een samenvatting van hun
    // klassen (kan leeg zijn als de leerling nog nergens lid is).
    // Sprint 48c2b: gescoped op de actieve school (NULL-rijen blijven zichtbaar).
    const r = await query(
      `SELECT s.*,
              STRING_AGG(DISTINCT c.name, ', ' ORDER BY c.name) AS class_name
       FROM students s
       LEFT JOIN class_memberships m ON m.student_id = s.id
       LEFT JOIN classes c ON c.id = m.class_id AND c.school_year = m.school_year
       WHERE ($1 OR s.status != 'blocked')
         AND (s.school_id IS NULL OR $2::text IS NULL OR s.school_id = $2)
       GROUP BY s.id
       ORDER BY s.name`,
      [includeBlocked, actieveSchoolId]
    );
    return r.rows;
  },

  // Zoek een leerling op naam binnen een specifieke klas (via lidmaatschap).
  async getStudentByName(name, classId) {
    const r = await query(
      `SELECT s.* FROM students s
       JOIN class_memberships m ON m.student_id = s.id
       WHERE LOWER(s.name) = LOWER($1) AND m.class_id = $2 LIMIT 1`,
      [name, classId]
    );
    return r.rows[0] || null;
  },

  // ── Sprint 52a: leerling-account (e-mail = login) ──────────────────────────
  async getStudentByEmail(email) {
    if (!email) return null;
    const r = await query(`SELECT * FROM students WHERE LOWER(email) = LOWER($1) LIMIT 1`, [email]);
    return r.rows[0] || null;
  },

  async getStudentById(id) {
    const r = await query(`SELECT * FROM students WHERE id = $1`, [id]);
    return r.rows[0] || null;
  },

  // Wachtwoord (her)instellen. mustChange=true dwingt een nieuwe keuze af (klas-startcode-flow).
  async setStudentPassword(id, passHash, mustChange = false) {
    const r = await query(
      `UPDATE students SET pass_hash = $2, must_change_password = $3 WHERE id = $1`,
      [id, passHash, !!mustChange]
    );
    return r.rowCount > 0;
  },

  // Sprint 52f (herstel): zet de "moet wachtwoord kiezen"-vlag zonder het wachtwoord te wissen.
  async setStudentMustChangePassword(id, must) {
    const r = await query(`UPDATE students SET must_change_password = $2 WHERE id = $1`, [id, !!must]);
    return r.rowCount > 0;
  },

  // Sprint 52c: volledig leerling-account aanmaken (zelfregistratie). name = voor+achter
  // (weergavenaam), status meestal 'pending'. Koppelt aan de klas van de startcode.
  async createStudentAccount({ firstName, lastName, email, passHash, classId, schoolYear = null, status = 'pending', source = 'self' }) {
    const id = crypto.randomUUID();
    const naam = `${String(firstName).trim()} ${String(lastName).trim()}`.trim();
    // Sprint 48c2: de leerling valt onder de school van zijn klas.
    let schoolId = null;
    if (classId) {
      const c = await query(`SELECT school_id FROM classes WHERE id = $1`, [classId]);
      schoolId = c.rows[0]?.school_id || null;
    }
    await query(
      `INSERT INTO students (id, name, first_name, last_name, email, pass_hash, status, source, school_id, must_change_password, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10)`,
      [id, naam, String(firstName).trim().slice(0, 80), String(lastName).trim().slice(0, 80),
       String(email).trim(), passHash, status, source, schoolId, Date.now()]
    );
    if (classId) {
      // Koppel aan de klas voor het juiste schooljaar (van de klas).
      const jaar = schoolYear || (await this.getClassById(classId))?.school_year || null;
      await query(
        `INSERT INTO class_memberships (student_id, class_id, school_year, status, created_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [id, classId, jaar, status === 'blocked' ? 'active' : status, Date.now()]
      );
    }
    return id;
  },

  // Sprint 52c: bestaan er überhaupt schooldomeinen? Zo niet, dan kan de domeincheck
  // (nog) niet afdwingen (test-/beginfase) en laten we registratie door met een waarschuwing.
  async heeftSchoolDomeinen() {
    const r = await query(`SELECT 1 FROM school_domains LIMIT 1`);
    return r.rows.length > 0;
  },

  // ── Sprint 52d: leerling-sessies ───────────────────────────────────────────
  async createStudentSession({ tokenHash, studentId, expiresAt, userAgent = '', ip = '' }) {
    const now = Date.now();
    await query(
      `INSERT INTO student_sessions (token_hash, student_id, created_at, expires_at, last_seen, user_agent, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tokenHash, studentId, now, expiresAt, now, String(userAgent).slice(0, 200), String(ip).slice(0, 64)]
    );
    return tokenHash;
  },

  async getStudentSession(tokenHash) {
    const r = await query(
      `SELECT s.token_hash, s.student_id, s.expires_at,
              st.name, st.email, st.status, st.must_change_password
         FROM student_sessions s
         JOIN students st ON st.id = s.student_id
        WHERE s.token_hash = $1 AND s.expires_at > $2
        LIMIT 1`,
      [tokenHash, Date.now()]
    );
    return r.rows[0] || null;
  },

  async deleteStudentSession(tokenHash) {
    await query(`DELETE FROM student_sessions WHERE token_hash = $1`, [tokenHash]);
  },

  // Sprint 52f: is deze leerling lid van deze klas? (herstel-flow: e-mail moet bij de
  // klas van de startcode horen.)
  async isStudentInClass(studentId, classId) {
    const r = await query(
      `SELECT 1 FROM class_memberships WHERE student_id = $1 AND class_id = $2 LIMIT 1`,
      [studentId, classId]
    );
    return r.rows.length > 0;
  },

  // Sprint 52h: voor-/achternaam + e-mail bewerken (leerkracht). name = voor+achter.
  async updateStudentIdentity(id, { firstName, lastName, email }) {
    const naam = `${String(firstName).trim()} ${String(lastName).trim()}`.trim();
    const r = await query(
      `UPDATE students SET first_name = $2, last_name = $3, name = $4, email = $5 WHERE id = $1`,
      [id, String(firstName).trim().slice(0, 80), String(lastName).trim().slice(0, 80),
       naam || 'Leerling', email ? String(email).trim() : null]
    );
    return r.rowCount > 0;
  },

  // Maak een leerling aan én koppel die aan een klas (indien opgegeven).
  // De klas bepaalt het schooljaar (classes.school_year). Bestaat de persoon met
  // dezelfde naam al in die klas, dan wordt niets dubbel aangemaakt.
  async createStudent(name, classId, source = 'manual', status = 'active') {
    if (classId) {
      // Bestaat deze leerling al in deze klas?
      const exists = await query(
        `SELECT s.id FROM students s
         JOIN class_memberships m ON m.student_id = s.id
         WHERE LOWER(s.name) = LOWER($1) AND m.class_id = $2 LIMIT 1`,
        [name, classId]
      );
      if (exists.rows.length > 0) return exists.rows[0].id;
    }
    const id = crypto.randomUUID();
    // Sprint 48c2: een leerling valt onder de school van zijn klas.
    let schoolId = null;
    if (classId) {
      const c = await query(`SELECT school_id FROM classes WHERE id = $1`, [classId]);
      schoolId = c.rows[0]?.school_id || null;
    }
    await query(
      `INSERT INTO students (id, name, status, source, school_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, name, status, source, schoolId, Date.now()]
    );
    if (classId) await this.addStudentToClass(id, classId);
    return id;
  },

  // Sprint 40: koppel een bestaande leerling aan een klas voor het schooljaar
  // van die klas. Idempotent (PK vangt duplicaten af).
  async addStudentToClass(studentId, classId, status = 'active') {
    const cls = await query(`SELECT school_year FROM classes WHERE id = $1`, [classId]);
    if (!cls.rows.length) return false;
    const schoolYear = cls.rows[0].school_year;
    await query(
      `INSERT INTO class_memberships (student_id, class_id, school_year, status, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (student_id, class_id, school_year) DO NOTHING`,
      [studentId, classId, schoolYear, status, Date.now()]
    );
    return true;
  },

  async removeStudentFromClass(studentId, classId) {
    const r = await query(
      `DELETE FROM class_memberships WHERE student_id = $1 AND class_id = $2`,
      [studentId, classId]
    );
    return r.rowCount > 0;
  },

  async updateStudentStatus(id, status) {
    await query(`UPDATE students SET status = $1 WHERE id = $2`, [status, id]);
  },

  // Sprint 40: "verplaats" een leerling naar een andere klas. Omdat lidmaatschap
  // nu per jaar geldt, betekent dit: koppel aan de nieuwe klas (voor haar jaar).
  // Oude lidmaatschappen blijven staan → historiek behouden.
  async updateStudentClass(id, classId) {
    if (classId) await this.addStudentToClass(id, classId);
  },

  async updateStudentLastSeen(id) {
    await query(`UPDATE students SET last_seen = $1 WHERE id = $2`, [Date.now(), id]);
  },

  async updateStudentNotes(id, notes) {
    await query(`UPDATE students SET notes = $1 WHERE id = $2`, [notes.slice(0, 500), id]);
  },

  async deleteStudent(id) {
    const r = await query(`DELETE FROM students WHERE id = $1`, [id]);
    return r.rowCount > 0;
  },

  async getStudentByGoogleEmail(email) {
    const r = await query(
      `SELECT * FROM students WHERE google_email = $1 LIMIT 1`, [email]
    );
    return r.rows[0] || null;
  },

  async linkStudentGoogle(id, email, sub) {
    await query(
      `UPDATE students SET google_email = $1, google_sub = $2 WHERE id = $3`,
      [email, sub, id]
    );
  },

  async importStudentsFromCSV(rows) {
    // rows: [{ name, className }]
    let added = 0, skipped = 0, classesCreated = 0, errors = [];
    for (const row of rows) {
      try {
        const name = String(row.name || '').trim().slice(0, 64);
        const className = String(row.className || '').trim().slice(0, 64);
        if (!name) { errors.push(`Lege naam overgeslagen`); continue; }

        // Zoek of maak klas aan
        let classRow = null;
        if (className) {
          const cr = await query(
            `SELECT * FROM classes WHERE LOWER(name) = LOWER($1) LIMIT 1`, [className]
          );
          if (cr.rows[0]) {
            classRow = cr.rows[0];
          } else {
            const newId = crypto.randomUUID();
            await query(
              `INSERT INTO classes (id, name, created_at) VALUES ($1, $2, $3)`,
              [newId, className, Date.now()]
            );
            classRow = { id: newId, name: className };
            classesCreated++;
          }
        }

        // Check duplicaat (leerling al in deze klas via lidmaatschap?)
        if (classRow) {
          const existing = await query(
            `SELECT s.id FROM students s
             JOIN class_memberships m ON m.student_id = s.id
             WHERE LOWER(s.name) = LOWER($1) AND m.class_id = $2 LIMIT 1`,
            [name, classRow.id]
          );
          if (existing.rows.length > 0) { skipped++; continue; }
        }

        // Sprint 40: maak de persoon aan en koppel via class_memberships.
        const id = crypto.randomUUID();
        await query(
          `INSERT INTO students (id, name, status, source, created_at)
           VALUES ($1, $2, 'active', 'csv', $3)`,
          [id, name, Date.now()]
        );
        if (classRow) await this.addStudentToClass(id, classRow.id);
        added++;
      } catch (e) {
        errors.push(`${row.name}: ${e.message}`);
      }
    }
    return { added, skipped, classesCreated, errors };
  },

  // ── Quiz Bank (Sprint 16a) ───────────────────────────────────────────────────

  async listQuizBank({ subject = null, difficulty = null, archived = false, actieveSchoolId = null } = {}) {
    let where = 'WHERE q.archived = $1';
    const params = [archived];
    if (subject) { params.push(subject); where += ` AND q.subject = $${params.length}`; }
    if (difficulty) { params.push(difficulty); where += ` AND q.difficulty = $${params.length}`; }
    // Sprint 48c2b: leesscoping — spiegelt magRijVanSchoolZien (NULL-rij of geen actieve
    // school → zichtbaar; anders enkel de actieve school).
    params.push(actieveSchoolId);
    where += ` AND (q.school_id IS NULL OR $${params.length}::text IS NULL OR q.school_id = $${params.length})`;
    const r = await query(
      `SELECT q.*, t.display_name AS created_by_name
       FROM question_bank q
       LEFT JOIN teachers t ON t.id = q.created_by
       ${where}
       ORDER BY q.subject, q.created_at DESC`,
      params
    );
    return r.rows;
  },

  async getQuizBankSubjects() {
    const r = await query(
      `SELECT DISTINCT subject FROM question_bank WHERE archived = false AND subject != '' ORDER BY subject`
    );
    return r.rows.map(r => r.subject);
  },

  async createQuizQuestion({ text, subject = '', difficulty = 'gemiddeld', maxPoints = 4,
                               questionType = 'code', choicesJson = '[]', tags = '',
                               modelAnswer = '', createdBy = null, schoolId = null }) {
    const id = crypto.randomUUID();
    const now = Date.now();
    await query(
      `INSERT INTO question_bank (id, text, subject, difficulty, max_points,
         question_type, choices_json, tags, model_answer, created_by, school_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, text.trim(), subject.trim(), difficulty, maxPoints,
       questionType, choicesJson, (tags || '').trim(), String(modelAnswer || ''), createdBy, schoolId, now, now]
    );
    return id;
  },

  async updateQuizQuestion(id, { text, subject, difficulty, maxPoints, questionType,
                                 choicesJson, tags, modelAnswer }) {
    const r = await query(
      `UPDATE question_bank SET text=$1, subject=$2, difficulty=$3, max_points=$4,
         question_type=$5, choices_json=$6, tags=$7, model_answer=$8, updated_at=$9
       WHERE id=$10`,
      [text.trim(), subject.trim(), difficulty, maxPoints,
       questionType || 'code', choicesJson || '[]', (tags || '').trim(),
       String(modelAnswer || ''), Date.now(), id]
    );
    return r.rowCount > 0;
  },

  // 37b: modelantwoord van één vraag-snapshot bijwerken (per toets).
  async setSnapshotModelAnswer(sessionCode, questionId, modelAnswer) {
    const r = await query(
      `UPDATE quiz_question_snapshots SET model_answer = $3
        WHERE session_code = $1 AND id = $2`,
      [sessionCode, questionId, String(modelAnswer || '').slice(0, 10000)]
    );
    return r.rowCount > 0;
  },

  // 37b: haal volledige bankvragen op voor een lijst id's (behoudt vraagtype,
  // keuzes én modelantwoord bij het aanmaken van een toets uit de bank).
  async getQuizBankByIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const r = await query(`SELECT * FROM question_bank WHERE id = ANY($1::text[])`, [ids]);
    const byId = new Map(r.rows.map(row => [row.id, row]));
    return byId;
  },

  // 38: dupliceer één bankvraag. Alle velden mee (incl. tags + modelantwoord).
  // 🔴 Meerkeuze-opties krijgen NIEUWE id's, anders delen origineel en kopie
  //    dezelfde optie-id's (zelfde valkuil als de 33e-bug).
  async duplicateQuizQuestion(id, createdBy = null) {
    const src = await query(`SELECT * FROM question_bank WHERE id = $1`, [id]);
    if (!src.rows.length) return null;
    const q = src.rows[0];

    // Optie-id's vernieuwen bij keuzevragen.
    let choicesJson = q.choices_json || '[]';
    if (q.question_type === 'multiple' || q.question_type === 'single') {
      try {
        const opts = JSON.parse(choicesJson);
        if (Array.isArray(opts)) {
          choicesJson = JSON.stringify(opts.map(o => ({
            id: crypto.randomUUID(),
            text: String(o?.text ?? ''),
            correct: o?.correct === true,
          })));
        }
      } catch { choicesJson = '[]'; }
    }

    return await this.createQuizQuestion({
      text: `${q.text} (kopie)`,
      subject: q.subject || '',
      difficulty: q.difficulty || 'gemiddeld',
      maxPoints: q.max_points || 4,
      questionType: q.question_type || 'code',
      choicesJson,
      tags: q.tags || '',
      modelAnswer: q.model_answer || '',
      createdBy,
    });
  },

  async archiveQuizQuestion(id) {
    await query(`UPDATE question_bank SET archived = true, updated_at = $1 WHERE id = $2`, [Date.now(), id]);
  },

  // 22f: gearchiveerde vraag herstellen
  async unarchiveQuizQuestion(id) {
    await query(`UPDATE question_bank SET archived = false, updated_at = $1 WHERE id = $2`, [Date.now(), id]);
  },

  async getQuizQuestionById(id) {
    const r = await query(`SELECT * FROM question_bank WHERE id = $1`, [id]);
    return r.rows[0] || null;
  },

  // Sprint 51c: hoeveel sjablonen gebruiken deze vraag? (voor de scope-grendel)
  async countTemplatesForQuestion(id) {
    const r = await query(`SELECT COUNT(*)::int AS n FROM template_questions WHERE question_id = $1`, [id]);
    return r.rows[0]?.n || 0;
  },

  // Sprint 51c: zichtbaarheid van een vraag wijzigen (private/school/public).
  // De aanroeper controleert eerst de eigenaar én de sjabloon-grendel.
  async setQuestionScope(id, scope) {
    const r = await query(
      `UPDATE question_bank SET share_scope = $2, updated_at = $3 WHERE id = $1`,
      [id, scope, Date.now()]
    );
    return r.rowCount > 0;
  },

  // Sprint 53d: admin-takedown van een vraag (verbergen/terugzetten).
  async setQuestionHidden(id, hidden) {
    const r = await query(
      `UPDATE question_bank SET hidden = $2, updated_at = $3 WHERE id = $1`,
      [id, !!hidden, Date.now()]
    );
    return r.rowCount > 0;
  },

  async deleteQuizQuestion(id) {
    // Enkel verwijderen als nog niet gebruikt in een toets
    const used = await query(
      `SELECT 1 FROM quiz_question_snapshots WHERE bank_question_id = $1 LIMIT 1`, [id]
    );
    if (used.rows.length > 0) return { ok: false, reason: 'Vraag is al gebruikt in een toets.' };
    // Sprint 51c: ook niet verwijderen zolang ze aan een sjabloon hangt (zou het uithollen).
    const inTemplate = await query(
      `SELECT 1 FROM template_questions WHERE question_id = $1 LIMIT 1`, [id]
    );
    if (inTemplate.rows.length > 0) return { ok: false, reason: 'Vraag hangt nog aan een sjabloon. Maak ze daar eerst los.' };
    await query(`DELETE FROM question_bank WHERE id = $1`, [id]);
    return { ok: true };
  },

  async importQuizQuestionsCSV(rows, teacherId) {
    let added = 0, skipped = 0, errors = [];
    for (const row of rows) {
      try {
        const text = String(row.vraag || '').trim();
        if (!text) { errors.push('Lege vraag overgeslagen'); continue; }
        // Duplicaat check op exacte vraagtekst
        const exists = await query(`SELECT 1 FROM question_bank WHERE text = $1 LIMIT 1`, [text]);
        if (exists.rows.length > 0) { skipped++; continue; }
        await this.createQuizQuestion({
          text,
          subject: row.onderwerp || '',
          difficulty: row.moeilijkheid || 'gemiddeld',
          maxPoints: parseInt(row.max_punten) || 4,
          createdBy: teacherId,
        });
        added++;
      } catch (e) { errors.push(`Fout bij rij: ${e.message}`); }
    }
    return { added, skipped, errors };
  },

  // ── Quiz Sessie (Sprint 16b) ──────────────────────────────────────────────────

  // ── Sprint 43.4: leerling-selectie per toets/taak ──────────────────────────
  // Geen rijen voor een session_code = ALLE leerlingen van de gekoppelde klas mogen meedoen.
  async listAssignmentStudents(sessionCode) {
    const r = await query(`SELECT student_id FROM assignment_students WHERE session_code = $1`, [sessionCode]);
    return r.rows.map(x => x.student_id);
  },

  // studentIds = volledige lijst toegelaten leerlingen. Lege array = beperking opheffen (iedereen mag).
  async setAssignmentStudents(sessionCode, studentIds) {
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM assignment_students WHERE session_code = $1`, [sessionCode]);
      for (const id of (studentIds || [])) {
        await client.query(
          `INSERT INTO assignment_students (session_code, student_id) VALUES ($1,$2)
           ON CONFLICT DO NOTHING`, [sessionCode, id]);
      }
    });
  },

  // true = deze leerling mag; ook true wanneer er geen selectie is vastgelegd.
  async isStudentAllowed(sessionCode, studentId) {
    const r = await query(`SELECT 1 FROM assignment_students WHERE session_code = $1 LIMIT 1`, [sessionCode]);
    if (!r.rows.length) return true;                       // geen selectie → iedereen mag
    const m = await query(`SELECT 1 FROM assignment_students WHERE session_code = $1 AND student_id = $2`,
                          [sessionCode, studentId]);
    return m.rows.length > 0;
  },

  async createQuizSession({ sessionCode, questions, randomize, timerSeconds,
                             noTimer, minRunsPerQ, hideQuestionOnScreen, isTeacherPreview,
                             schoolYear, targetClass, accessFrom, accessUntil, autoSubmitLate,
                             type }) {
    const now = Date.now();
    // noTimer = true → geen tijdslimiet (taak)
    // timerSeconds = null + noTimer = false → gebruik standaard 2700s
    const effectiveTimer = noTimer ? null : (timerSeconds || 2700);
    const currentYear = (() => {
      const d = new Date();
      // Augustus = nieuw schooljaar
      const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
      return `${y}-${y + 1}`;
    })();
    // 36a: assignment_bank + alle vraag-snapshots in één transactie — anders kan een crash
    // een toets met meta maar zonder (of met halve) vragen achterlaten.
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO assignment_bank (session_code, randomize, timer_seconds, no_timer, individual_timer,
          min_runs_per_q, hide_question_on_screen, results_released, is_teacher_preview,
          school_year, target_class, access_from, access_until, auto_submit_late, type, created_at)
         VALUES ($1,$2,$3,$4,true,$5,$6,false,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [sessionCode, randomize, effectiveTimer, noTimer || false,
         minRunsPerQ, hideQuestionOnScreen, isTeacherPreview,
         schoolYear || currentYear, targetClass || '',
         accessFrom || null, accessUntil || null, autoSubmitLate !== false,
         // Sprint 43.14: vertrouw een expliciet type ('toets'/'taak') — dat staat al
         // vast bij het openen van het aanmaakscherm. De noTimer-afleiding is enkel
         // nog een vangnet voor een aanroeper die (nog) geen type meegeeft.
         (type === 'taak' || type === 'toets') ? type : (noTimer ? 'taak' : 'toets'),
         now]
      );
      for (const q of questions) {
        await client.query(
          `INSERT INTO quiz_question_snapshots
             (id, session_code, bank_question_id, order_index, text_snapshot, subject, points,
              question_type, choices_json, model_answer)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [crypto.randomUUID(), sessionCode, q.bankId, q.orderIndex, q.text, q.subject, q.points,
           q.questionType || 'code', q.choicesJson || '[]', q.modelAnswer || '']
        );
      }
    });
  },

  async getQuizMeta(sessionCode) {
    const r = await query(`SELECT * FROM assignment_bank WHERE session_code = $1`, [sessionCode]);
    return r.rows[0] || null;
  },

  async getQuizQuestions(sessionCode) {
    const r = await query(
      `SELECT * FROM quiz_question_snapshots WHERE session_code = $1 ORDER BY order_index`,
      [sessionCode]
    );
    return r.rows;
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Sprint 51c — Bibliotheek: gedeelde vragen + sjablonen
  // Zichtbaarheid: een item is zichtbaar als het van jou is, publiek is, of school
  // is én je deelt een school met de eigenaar (admin ziet ook alle school-items).
  // De school-toets gebeurt in SQL met de schoollijst van de kijker als parameter.
  // ═══════════════════════════════════════════════════════════════════════════

  // Gedeelde vragen die zichtbaar zijn voor deze kijker (voor de Bibliotheek).
  async listSharedQuestions({ viewerId = null, schoolIds = [], isAdmin = false, subject = null } = {}) {
    const params = [viewerId, schoolIds, isAdmin];
    let where = `q.archived = false AND (
        q.share_scope = 'public'
        OR q.created_by = $1
        OR (q.share_scope = 'school' AND (
             $3::boolean = true
             OR EXISTS (SELECT 1 FROM teacher_schools ts
                          WHERE ts.teacher_id = q.created_by AND ts.school_id = ANY($2::text[]))
        ))
      )`;
    if (subject) { params.push(subject); where += ` AND q.subject = $${params.length}`; }
    // Sprint 53d: door een admin verborgen vragen verdwijnen voor iedereen behalve de
    // eigenaar (die ziet dat het weg is) en een admin (die kan terugzetten).
    where += ` AND (NOT q.hidden OR q.created_by = $1 OR $3::boolean = true)`;
    const r = await query(
      `SELECT q.*, t.display_name AS owner_name,
              (SELECT COUNT(*)::int FROM template_questions tq WHERE tq.question_id = q.id) AS template_count
         FROM question_bank q
         LEFT JOIN teachers t ON t.id = q.created_by
        WHERE ${where}
        ORDER BY q.share_scope DESC, q.subject, q.created_at DESC`,
      params
    );
    return r.rows;
  },

  // Sjablonen die zichtbaar zijn voor deze kijker (voor de Bibliotheek).
  async listTemplates({ viewerId = null, schoolIds = [], isAdmin = false, type = null } = {}) {
    const params = [viewerId, schoolIds, isAdmin];
    let where = `(
        tpl.share_scope = 'public'
        OR tpl.owner_id = $1
        OR (tpl.share_scope = 'school' AND (
             $3::boolean = true
             OR EXISTS (SELECT 1 FROM teacher_schools ts
                          WHERE ts.teacher_id = tpl.owner_id AND ts.school_id = ANY($2::text[]))
        ))
      )`;
    if (type) { params.push(type); where += ` AND tpl.type = $${params.length}`; }
    // Sprint 53d: door een admin verborgen sjablonen enkel nog voor eigenaar + admin.
    where += ` AND (NOT tpl.hidden OR tpl.owner_id = $1 OR $3::boolean = true)`;
    const r = await query(
      `SELECT tpl.*, t.display_name AS owner_name,
              (SELECT COUNT(*)::int FROM template_questions tq WHERE tq.template_id = tpl.id) AS question_count
         FROM assignment_templates tpl
         LEFT JOIN teachers t ON t.id = tpl.owner_id
        WHERE ${where}
        ORDER BY tpl.type, tpl.share_scope DESC, LOWER(tpl.name)`,
      params
    );
    return r.rows;
  },

  async getTemplate(id) {
    const r = await query(`SELECT * FROM assignment_templates WHERE id = $1`, [id]);
    return r.rows[0] || null;
  },

  // De gekoppelde vragen van een sjabloon, met hun huidige bankinhoud + scope, op volgorde.
  async getTemplateQuestions(templateId) {
    const r = await query(
      `SELECT q.*, tq.order_index
         FROM template_questions tq
         JOIN question_bank q ON q.id = tq.question_id
        WHERE tq.template_id = $1
        ORDER BY tq.order_index`,
      [templateId]
    );
    return r.rows;
  },

  // Enkel de scopes van de gekoppelde vragen (voor de sjabloon-scope-validatie).
  async getTemplateQuestionScopes(templateId) {
    const r = await query(
      `SELECT q.share_scope
         FROM template_questions tq JOIN question_bank q ON q.id = tq.question_id
        WHERE tq.template_id = $1`,
      [templateId]
    );
    return r.rows.map(x => x.share_scope);
  },

  async createTemplate({ ownerId = null, type = 'toets', name, description = '', subject = '',
                          randomize = true, timerSeconds = null, noTimer = false,
                          individualTimer = true, minRunsPerQ = 0, hideQuestionOnScreen = false,
                          reviewMode = false, autoSubmitLate = true }) {
    const id = crypto.randomUUID();
    const now = Date.now();
    await query(
      `INSERT INTO assignment_templates
         (id, owner_id, type, name, description, subject, share_scope,
          randomize, timer_seconds, no_timer, individual_timer, min_runs_per_q,
          hide_question_on_screen, review_mode, auto_submit_late, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'private',$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
      [id, ownerId, (type === 'taak' ? 'taak' : 'toets'), String(name).slice(0, 120),
       String(description).slice(0, 500), String(subject).slice(0, 64),
       randomize, timerSeconds, noTimer, individualTimer, minRunsPerQ,
       hideQuestionOnScreen, reviewMode, autoSubmitLate, now]
    );
    return id;
  },

  async updateTemplate(id, { name, description, subject, randomize, timerSeconds, noTimer,
                              individualTimer, minRunsPerQ, hideQuestionOnScreen, reviewMode, autoSubmitLate }) {
    const r = await query(
      `UPDATE assignment_templates SET
         name=$2, description=$3, subject=$4, randomize=$5, timer_seconds=$6, no_timer=$7,
         individual_timer=$8, min_runs_per_q=$9, hide_question_on_screen=$10, review_mode=$11,
         auto_submit_late=$12, updated_at=$13
       WHERE id=$1`,
      [id, String(name).slice(0, 120), String(description || '').slice(0, 500), String(subject || '').slice(0, 64),
       randomize, timerSeconds, noTimer, individualTimer, minRunsPerQ, hideQuestionOnScreen,
       reviewMode, autoSubmitLate, Date.now()]
    );
    return r.rowCount > 0;
  },

  async setTemplateScope(id, scope) {
    const r = await query(
      `UPDATE assignment_templates SET share_scope = $2, updated_at = $3 WHERE id = $1`,
      [id, scope, Date.now()]
    );
    return r.rowCount > 0;
  },

  // Sprint 53d: admin-takedown van een sjabloon (verbergen/terugzetten).
  async setTemplateHidden(id, hidden) {
    const r = await query(
      `UPDATE assignment_templates SET hidden = $2, updated_at = $3 WHERE id = $1`,
      [id, !!hidden, Date.now()]
    );
    return r.rowCount > 0;
  },

  async deleteTemplate(id) {
    // template_questions verdwijnt mee via ON DELETE CASCADE.
    const r = await query(`DELETE FROM assignment_templates WHERE id = $1`, [id]);
    return r.rowCount > 0;
  },

  // Een vraag achteraan een sjabloon koppelen (idempotent). De aanroeper valideert
  // eigenaarschap, zichtbaarheid en scope-compatibiliteit vóór dit punt.
  async attachQuestionToTemplate(templateId, questionId) {
    const pos = await query(
      `SELECT COALESCE(MAX(order_index)+1, 0) AS next FROM template_questions WHERE template_id = $1`,
      [templateId]
    );
    await query(
      `INSERT INTO template_questions (template_id, question_id, order_index)
       VALUES ($1,$2,$3) ON CONFLICT (template_id, question_id) DO NOTHING`,
      [templateId, questionId, pos.rows[0]?.next || 0]
    );
    await query(`UPDATE assignment_templates SET updated_at = $2 WHERE id = $1`, [templateId, Date.now()]);
    return true;
  },

  async detachQuestionFromTemplate(templateId, questionId) {
    const r = await query(
      `DELETE FROM template_questions WHERE template_id = $1 AND question_id = $2`,
      [templateId, questionId]
    );
    await query(`UPDATE assignment_templates SET updated_at = $2 WHERE id = $1`, [templateId, Date.now()]);
    return r.rowCount > 0;
  },

  async setTemplateQuestionOrder(templateId, orderedQuestionIds) {
    await withTransaction(async (client) => {
      for (let i = 0; i < orderedQuestionIds.length; i++) {
        await client.query(
          `UPDATE template_questions SET order_index = $3 WHERE template_id = $1 AND question_id = $2`,
          [templateId, orderedQuestionIds[i], i]
        );
      }
      await client.query(`UPDATE assignment_templates SET updated_at = $2 WHERE id = $1`, [templateId, Date.now()]);
    });
    return true;
  },

  // "Bewaar als sjabloon": maak een (privé) sjabloon uit een bestaande toets/taak-sessie.
  // Vragen worden gekoppeld via hun bank-id; snapshot-vragen die (nog) niet in de bank
  // staan, worden als privé bankvraag van de eigenaar aangemaakt en dan gekoppeld — zo is
  // het sjabloon volledig bank-gedekt en herbruikbaar. Alles in één transactie.
  async createTemplateFromSession({ sessionCode, ownerId = null, name }) {
    const meta = await this.getQuizMeta(sessionCode);
    if (!meta) return null;
    const snaps = await this.getQuizQuestions(sessionCode);
    const now = Date.now();
    const templateId = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO assignment_templates
           (id, owner_id, type, name, description, subject, share_scope,
            randomize, timer_seconds, no_timer, individual_timer, min_runs_per_q,
            hide_question_on_screen, review_mode, auto_submit_late, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'','','private',$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
        [templateId, ownerId,
         (meta.type === 'taak' || meta.type === 'toets') ? meta.type : (meta.no_timer ? 'taak' : 'toets'),
         String(name).slice(0, 120),
         meta.randomize, meta.timer_seconds ?? null, meta.no_timer || false,
         meta.individual_timer ?? true, meta.min_runs_per_q || 0,
         meta.hide_question_on_screen || false, meta.review_mode || false,
         meta.auto_submit_late !== false, now]
      );
      let order = 0;
      for (const s of snaps) {
        let qid = s.bank_question_id;
        // Bestaat de bankvraag nog? Zo niet (of nooit uit de bank): maak een privé kopie.
        if (qid) {
          const still = await client.query(`SELECT 1 FROM question_bank WHERE id = $1`, [qid]);
          if (!still.rows.length) qid = null;
        }
        if (!qid) {
          qid = crypto.randomUUID();
          await client.query(
            `INSERT INTO question_bank (id, text, subject, difficulty, max_points, question_type,
               choices_json, tags, model_answer, share_scope, created_by, created_at, updated_at)
             VALUES ($1,$2,$3,'gemiddeld',$4,$5,$6,'',$7,'private',$8,$9,$9)`,
            [qid, s.text_snapshot, s.subject || '', s.points || 4, s.question_type || 'code',
             s.choices_json || '[]', s.model_answer || '', ownerId, now]
          );
        }
        await client.query(
          `INSERT INTO template_questions (template_id, question_id, order_index)
           VALUES ($1,$2,$3) ON CONFLICT (template_id, question_id) DO NOTHING`,
          [templateId, qid, order++]
        );
      }
    });
    return templateId;
  },

  async releaseQuizResults(sessionCode) {
    await query(`UPDATE assignment_bank SET results_released = true WHERE session_code = $1`, [sessionCode]);
  },

  // 37d: nakijk-modus aan/uit. Los van results_released — de leerkracht stelt
  // expliciet open wanneer leerlingen hun toets mogen inzien.
  async setReviewMode(sessionCode, enabled) {
    const r = await query(
      `UPDATE assignment_bank SET review_mode = $2 WHERE session_code = $1`,
      [sessionCode, !!enabled]
    );
    return r.rowCount > 0;
  },

  // 37d: zoek het student_id van een leerling binnen één toets, op naam + klas.
  // Sprint 52i: quiz_answers.student_id is voor een INGELOGDE leerling zijn students.id,
  // en voor een gast een sessie-gebonden UUID. In beide gevallen is de naam+klas in
  // quiz_answers de betrouwbare tekst-momentopname, dus die opzoeking blijft geldig en
  // werkt ook nadat de live sessie uit het geheugen verdwenen is.
  async findAnswerStudent(sessionCode, naam, klas) {
    const r = await query(
      `SELECT DISTINCT student_id, student_name, student_class
         FROM quiz_answers
        WHERE session_code = $1
          AND lower(trim(student_name))  = lower(trim($2))
          AND lower(trim(student_class)) = lower(trim($3))`,
      [sessionCode, String(naam || ''), String(klas || '')]
    );
    return r.rows;
  },

  // ── Quiz Antwoorden (Sprint 16c) ──────────────────────────────────────────────

  async saveQuizAnswer({ sessionCode, studentId, studentName, studentClass,
                          questionId, personalOrder, code, runCount,
                          firstVisitAt, firstRunAt, selectedChoices = '[]' }) {
    const now = Date.now();
    await query(
      `INSERT INTO quiz_answers
         (id, session_code, student_id, student_name, student_class,
          question_id, personal_order, code, run_count,
          first_visit_at, first_run_at, saved_at, selected_choices)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (session_code, student_id, question_id) DO UPDATE SET
         code             = EXCLUDED.code,
         run_count        = EXCLUDED.run_count,
         selected_choices = EXCLUDED.selected_choices,
         first_run_at     = COALESCE(quiz_answers.first_run_at, EXCLUDED.first_run_at),
         first_visit_at   = COALESCE(quiz_answers.first_visit_at, EXCLUDED.first_visit_at),
         saved_at         = EXCLUDED.saved_at`,
      [crypto.randomUUID(), sessionCode, studentId, studentName, studentClass,
       questionId, personalOrder, code, runCount, firstVisitAt, firstRunAt, now,
       selectedChoices]
    );
  },

  async submitQuizAnswers(sessionCode, studentId, autoSubmitted = false) {
    const now = Date.now();
    await query(
      `UPDATE quiz_answers
       SET submitted_at = $1, auto_submitted = $2
       WHERE session_code = $3 AND student_id = $4 AND submitted_at IS NULL`,
      [now, autoSubmitted, sessionCode, studentId]
    );
  },

  async saveQuizStudentOrder(sessionCode, studentId, orderedQuestionIds) {
    // 36a: volledige volgorde per leerling in één transactie (alles of niets).
    await withTransaction(async (client) => {
      for (let i = 0; i < orderedQuestionIds.length; i++) {
        await client.query(
          `INSERT INTO quiz_student_order (session_code, student_id, question_id, personal_pos)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [sessionCode, studentId, orderedQuestionIds[i], i]
        );
      }
    });
  },

  async getQuizStudentOrder(sessionCode, studentId) {
    const r = await query(
      `SELECT question_id, personal_pos FROM quiz_student_order
       WHERE session_code = $1 AND student_id = $2 ORDER BY personal_pos`,
      [sessionCode, studentId]
    );
    return r.rows;
  },

  async saveQuizRunHistory({ sessionCode, studentId, questionId, code }) {
    await query(
      `INSERT INTO quiz_run_history (id, session_code, student_id, question_id, code, ran_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [crypto.randomUUID(), sessionCode, studentId, questionId, code, Date.now()]
    );
  },

  async getQuizRunHistory(sessionCode, studentId, questionId) {
    const r = await query(
      `SELECT id, code, ran_at FROM quiz_run_history
       WHERE session_code=$1 AND student_id=$2 AND question_id=$3
       ORDER BY ran_at`,
      [sessionCode, studentId, questionId]
    );
    return r.rows;
  },

  // ── Quiz Verbetering (Sprint 16d) ─────────────────────────────────────────────

  async getQuizAnswers(sessionCode) {
    const r = await query(
      `SELECT a.*, q.text_snapshot, q.subject, q.points, q.order_index
       FROM quiz_answers a
       JOIN quiz_question_snapshots q ON q.id = a.question_id
       WHERE a.session_code = $1
       ORDER BY a.student_name, q.order_index`,
      [sessionCode]
    );
    return r.rows;
  },

  // 37a: alle vragen van één toets met het eigen antwoord van één leerling.
  // LEFT JOIN: ook niet-beantwoorde vragen komen mee (score = null).
  // choices_json wordt hier RUW teruggegeven; de server strippt de `correct`-vlag
  // vóór verzending naar de leerling (zie sanitizeChoicesForStudent in server.js).
  // teacher_comment wordt sinds 37c wél meegestuurd (commentaar per vraag).
  async getMyResult(sessionCode, studentId) {
    const r = await query(
      `SELECT q.id            AS question_id,
              q.order_index,
              q.text_snapshot,
              q.subject,
              q.points,
              q.question_type,
              q.choices_json,
              q.model_answer,
              a.code,
              a.score,
              a.selected_choices,
              a.auto_scored,
              a.teacher_comment
         FROM quiz_question_snapshots q
         LEFT JOIN quiz_answers a
                ON a.question_id  = q.id
               AND a.session_code = q.session_code
               AND a.student_id   = $2
        WHERE q.session_code = $1
        ORDER BY q.order_index`,
      [sessionCode, studentId]
    );
    return r.rows;
  },

  async getQuizAnswersByStudent(sessionCode, studentId) {
    const r = await query(
      `SELECT a.*, q.text_snapshot, q.subject, q.points, q.order_index
       FROM quiz_answers a
       JOIN quiz_question_snapshots q ON q.id = a.question_id
       WHERE a.session_code = $1 AND a.student_id = $2
       ORDER BY q.order_index`,
      [sessionCode, studentId]
    );
    return r.rows;
  },

  async scoreQuizAnswer(answerId, score, teacherComment) {
    await query(
      `UPDATE quiz_answers SET score=$1, teacher_comment=$2 WHERE id=$3`,
      [score, teacherComment, answerId]
    );
  },

  async saveQuizGeneralComment(sessionCode, studentId, comment) {
    await query(
      `INSERT INTO quiz_general_comments (session_code, student_id, comment, updated_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (session_code, student_id) DO UPDATE SET comment=EXCLUDED.comment, updated_at=EXCLUDED.updated_at`,
      [sessionCode, studentId, comment, Date.now()]
    );
  },

  async getQuizGeneralComment(sessionCode, studentId) {
    const r = await query(
      `SELECT comment FROM quiz_general_comments WHERE session_code=$1 AND student_id=$2`,
      [sessionCode, studentId]
    );
    return r.rows[0]?.comment || '';
  },

  async listQuizCommentTemplates(teacherId) {
    const r = await query(
      `SELECT * FROM quiz_comment_templates WHERE created_by=$1 ORDER BY created_at`,
      [teacherId]
    );
    return r.rows;
  },

  async createQuizCommentTemplate(text, teacherId) {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO quiz_comment_templates (id, text, created_by, created_at) VALUES ($1,$2,$3,$4)`,
      [id, text.trim(), teacherId, Date.now()]
    );
    return id;
  },

  async deleteQuizCommentTemplate(id) {
    await query(`DELETE FROM quiz_comment_templates WHERE id=$1`, [id]);
  },

  // ── Quiz Archief (Sprint 17b) ─────────────────────────────────────────────────

  async archiveQuiz(sessionCode) {
    await query(
      `UPDATE assignment_bank SET archived = true, archived_at = $1 WHERE session_code = $2`,
      [Date.now(), sessionCode]
    );
  },

  async unarchiveQuiz(sessionCode) {
    await query(
      `UPDATE assignment_bank SET archived = false, archived_at = NULL WHERE session_code = $1`,
      [sessionCode]
    );
  },

  async deleteQuizFully(sessionCode) {
    // Verwijder alle quiz-data maar behoudt de vragen in question_bank
    await query(`DELETE FROM quiz_run_history   WHERE session_code = $1`, [sessionCode]);
    await query(`DELETE FROM quiz_general_comments WHERE session_code = $1`, [sessionCode]);
    await query(`DELETE FROM quiz_student_order  WHERE session_code = $1`, [sessionCode]);
    await query(`DELETE FROM quiz_answers        WHERE session_code = $1`, [sessionCode]);
    await query(`DELETE FROM quiz_question_snapshots WHERE session_code = $1`, [sessionCode]);
    await query(`DELETE FROM assignment_bank           WHERE session_code = $1`, [sessionCode]);
    // Markeer de sessie als verwijderd
    await query(`UPDATE sessions SET deleted = 1 WHERE code = $1`, [sessionCode]);
  },

  async getQuizArchive({ year = null, classId = null, subject = null, archived = null } = {}) {
    // Haal alle toetsen op met filters
    let where = [];
    let params = [];
    let i = 1;

    if (year)     { where.push(`m.school_year = $${i++}`); params.push(year); }
    if (archived !== null) { where.push(`m.archived = $${i++}`); params.push(archived); }
    if (subject) {
      // Toetsen met minstens één vraag van dit onderwerp
      where.push(`s.code IN (
        SELECT DISTINCT q.session_code FROM quiz_question_snapshots q WHERE q.subject = $${i++}
      )`); params.push(subject);
    }
    if (classId) {
      where.push(`m.target_class = $${i++}`); params.push(classId);
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const r = await query(`
      SELECT s.code, s.name, s.created_at, s.deleted,
             m.school_year, m.target_class, m.timer_seconds, m.no_timer,
             m.randomize, m.results_released, m.archived, m.archived_at,
             COUNT(DISTINCT a.student_id)::int AS student_count,
             COUNT(DISTINCT qs.id)::int        AS question_count,
             ROUND(AVG(a.score), 1)            AS avg_score,
             SUM(qs.points)                    AS max_score_per_student
      FROM sessions s
      JOIN assignment_bank m ON m.session_code = s.code
      LEFT JOIN quiz_answers a ON a.session_code = s.code AND a.submitted_at IS NOT NULL
      LEFT JOIN quiz_question_snapshots qs ON qs.session_code = s.code
      ${whereClause}
      GROUP BY s.code, s.name, s.created_at, s.deleted,
               m.school_year, m.target_class, m.timer_seconds, m.no_timer,
               m.randomize, m.results_released, m.archived, m.archived_at
      ORDER BY s.created_at DESC
    `, params);
    return r.rows;
  },

  async getStudentHistory({ name, classId = null, year = null } = {}) {
    // Alle toetsen + scores voor één leerling
    let params = [name.toLowerCase()];
    let i = 2;
    let extra = '';
    if (year)    { extra += ` AND m.school_year = $${i++}`; params.push(year); }
    if (classId) { extra += ` AND m.target_class = $${i++}`; params.push(classId); }

    const r = await query(`
      SELECT s.name AS quiz_name, s.code AS session_code, s.created_at,
             m.school_year, m.target_class,
             a.student_name, a.student_class,
             SUM(a.score) AS total_score,
             SUM(qs.points) AS max_score,
             COUNT(a.id)::int AS answers_count,
             MAX(a.submitted_at) AS submitted_at
      FROM quiz_answers a
      JOIN sessions s ON s.code = a.session_code
      JOIN assignment_bank m ON m.session_code = s.code
      JOIN quiz_question_snapshots qs ON qs.session_code = s.code
      WHERE LOWER(a.student_name) = $1 ${extra}
        AND a.submitted_at IS NOT NULL
      GROUP BY s.name, s.code, s.created_at, m.school_year, m.target_class,
               a.student_name, a.student_class
      ORDER BY s.created_at DESC
    `, params);
    return r.rows;
  },

  async getQuizStatsDetailed(sessionCode) {
    const questions = await this.getQuizQuestions(sessionCode);
    const rows = await query(`
      SELECT a.question_id,
             COUNT(a.id)::int       AS answer_count,
             ROUND(AVG(a.score), 2) AS avg_score,
             ROUND(AVG(a.run_count), 1) AS avg_runs,
             MIN(a.score)           AS min_score,
             MAX(a.score)           AS max_score
      FROM quiz_answers a
      WHERE a.session_code = $1 AND a.submitted_at IS NOT NULL
      GROUP BY a.question_id
    `, [sessionCode]);

    const byQ = {};
    for (const r of rows.rows) byQ[r.question_id] = r;

    return questions.map(q => ({
      ...q,
      stats: byQ[q.id] || { answer_count: 0, avg_score: null, avg_runs: 0 },
    }));
  },

  async getAvailableYears() {
    const r = await query(
      `SELECT DISTINCT school_year FROM assignment_bank WHERE school_year != '' ORDER BY school_year DESC`
    );
    return r.rows.map(r => r.school_year);
  },

  // ── Audit log (Sprint 20a) ───────────────────────────────────────────────────

  async auditLog(actor, action, target, detail = {}, ip = '', schoolId = null) {
    await query(
      `INSERT INTO audit_log (id, actor, action, target, detail_json, ip, school_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [crypto.randomUUID(), String(actor||'').slice(0,64), action,
       String(target||'').slice(0,128), JSON.stringify(detail),
       String(ip||'').slice(0,64), schoolId || null, Date.now()]
    ).catch(() => {}); // nooit falen
  },

  async getAuditLog({ limit = 50, actor = null, action = null, actieveSchoolId = null } = {}) {
    let where = [];
    const params = [];
    if (actor)  { params.push(actor);  where.push(`actor = $${params.length}`); }
    if (action) { params.push(action); where.push(`action = $${params.length}`); }
    // Sprint 48c2b: gescoped op de actieve school (NULL-regels blijven zichtbaar).
    params.push(actieveSchoolId);
    where.push(`(school_id IS NULL OR $${params.length}::text IS NULL OR school_id = $${params.length})`);
    params.push(limit);
    const r = await query(
      `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return r.rows;
  },

  // ── Stresstest historiek (Sprint 21) ─────────────────────────────────────────

  async saveStressResult(result) {
    await query(
      `INSERT INTO stress_results
         (id, test_type, ran_at, duration_sec, params_json,
          runs_total, runs_ok, runs_failed, avg_run_ms, max_run_ms,
          ram_web_mb, ram_runner_mb, cpu_runner_pct, pg_queries, pg_avg_ms,
          pg_pool_used, stress_pct, stress_label, log_filename)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [crypto.randomUUID(), result.testType, result.ranAt || Date.now(),
       result.durationSec || 0, JSON.stringify(result.params || {}),
       result.runsTotal || 0, result.runsOk || 0, result.runsFailed || 0,
       result.avgRunMs || null, result.maxRunMs || null,
       result.ramWebMb || null, result.ramRunnerMb || null, result.cpuRunnerPct || null,
       result.pgQueries || null, result.pgAvgMs || null, result.pgPoolUsed || null,
       result.stressPct || 0, result.stressLabel || 'OK', result.logFilename || null]
    );
  },

  async getStressResults(limit = 10) {
    const r = await query(
      `SELECT * FROM stress_results ORDER BY ran_at DESC LIMIT $1`, [limit]
    );
    return r.rows;
  },

  // ── Quiz Monitoring (Sprint 16f) ──────────────────────────────────────────────

  async getQuizStats() {
    const r = await query(`
      SELECT
        COUNT(DISTINCT a.session_code)::int                       AS active_sessions,
        COUNT(*)::int                                             AS total_answers,
        COUNT(CASE WHEN a.submitted_at IS NOT NULL THEN 1 END)::int AS submitted_answers,
        ROUND(AVG(a.run_count), 1)                                AS avg_runs
      FROM quiz_answers a
      JOIN assignment_bank m ON m.session_code = a.session_code
    `);
    return r.rows[0] || {};
  },

  // Utility
  async close() { await pool.end(); },

  // Health check
  async ping() {
    const r = await query(`SELECT 1 AS ok`);
    return r.rows[0]?.ok === 1;
  },
};
