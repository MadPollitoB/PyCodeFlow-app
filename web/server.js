const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const RUNNER_URL = process.env.RUNNER_URL || "http://runner:5000";
const BASIC_AUTH_ENABLED = String(process.env.POC_BASIC_AUTH_ENABLED || "true").toLowerCase() !== "false";
const BASIC_AUTH_USER = process.env.POC_BASIC_USER || "";
const BASIC_AUTH_PASS = process.env.POC_BASIC_PASS || "";
const BASIC_AUTH_REALM = process.env.POC_BASIC_AUTH_REALM || "PyCodeFlow POC";

const VERSION = {
  year: process.env.APP_VERSION_YEAR || "2026",
  major: process.env.APP_VERSION_MAJOR || "0",
  minor: process.env.APP_VERSION_MINOR || "0",
  build: process.env.APP_VERSION_BUILD || "0"
};
const APP_VERSION = `${VERSION.year}.${VERSION.major}.${VERSION.minor}.${VERSION.build}`;


function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a), "utf8");
  const bBuf = Buffer.from(String(b), "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function parseBasicAuthHeader(headerValue) {
  if (!headerValue || !headerValue.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(headerValue.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) return null;
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
}

function credentialsAreValid(authHeader) {
  if (!BASIC_AUTH_ENABLED) return true;
  const creds = parseBasicAuthHeader(authHeader);
  if (!creds) return false;
  return safeEqual(creds.username, BASIC_AUTH_USER) && safeEqual(creds.password, BASIC_AUTH_PASS);
}

function requireBasicAuth(req, res, next) {
  if (!BASIC_AUTH_ENABLED) return next();
  if (credentialsAreValid(req.headers.authorization)) return next();
  res.setHeader("WWW-Authenticate", `Basic realm="${BASIC_AUTH_REALM}", charset="UTF-8"`);
  return res.status(401).send("Authenticatie vereist.");
}

if (BASIC_AUTH_ENABLED && (!BASIC_AUTH_USER || !BASIC_AUTH_PASS || BASIC_AUTH_USER === "CHANGE_ME" || BASIC_AUTH_PASS === "CHANGE_ME")) {
  console.error("POC Basic Auth is actief, maar POC_BASIC_USER/POC_BASIC_PASS zijn niet correct ingesteld in .env.");
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);


function parseCookieHeader(headerValue) {
  const out = {};
  if (!headerValue) return out;
  for (const part of headerValue.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function teacherCookieValue() {
  return crypto.createHmac('sha256', BASIC_AUTH_PASS || 'fallback_teacher_cookie_secret')
    .update(`${BASIC_AUTH_USER}|${BASIC_AUTH_REALM}`)
    .digest('hex');
}

function hasValidTeacherCookie(cookieHeader) {
  if (!BASIC_AUTH_ENABLED) return true;
  const cookies = parseCookieHeader(cookieHeader);
  return safeEqual(cookies.teacher_auth || '', teacherCookieValue());
}

function setTeacherCookie(res) {
  if (!BASIC_AUTH_ENABLED) return;
  res.setHeader('Set-Cookie', `teacher_auth=${encodeURIComponent(teacherCookieValue())}; Path=/; HttpOnly; SameSite=Lax`);
}

function requireTeacherAuth(req, res, next) {
  if (!BASIC_AUTH_ENABLED) return next();
  if (hasValidTeacherCookie(req.headers.cookie)) return next();
  if (credentialsAreValid(req.headers.authorization)) {
    setTeacherCookie(res);
    return next();
  }
  res.setHeader('WWW-Authenticate', `Basic realm="${BASIC_AUTH_REALM}", charset="UTF-8"`);
  return res.status(401).send('Authenticatie vereist.');
}

function socketIsTeacherAuthorized(socket) {
  if (!BASIC_AUTH_ENABLED) return true;
  return hasValidTeacherCookie(socket.request.headers.cookie || '');
}

app.use(express.json());

app.get('/teacher-sessions.html', requireTeacherAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher-sessions.html'));
});
app.get('/teacher-app.html', requireTeacherAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher-app.html'));
});
app.get('/teacher-start.html', requireTeacherAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher-start.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/landing.html', (req, res) => {
  res.redirect('/index.html');
});

app.get('/api/version', (req, res) => {
  res.json({
    version: APP_VERSION,
    ...VERSION
  });
});


app.use(express.static(path.join(__dirname, "public")));
app.use("/monaco", express.static(path.join(__dirname, "node_modules", "monaco-editor")));


const sessions = new Map();
const socketToUser = new Map();
const activeRuns = new Map(); // runId -> routing info


function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (sessions.has(code));
  return code;
}

function sessionSummary(session) {
  const students = Object.values(session.students).filter(s => !s.removed);
  return {
    code: session.code,
    name: session.name,
    mode: session.mode,
    studentCount: students.length,
    createdAt: session.createdAt,
    status: session.deleted ? "verwijderd" : session.blocked ? "geblokkeerd" : session.closed ? "gesloten" : "actief",
    editorAssist: session.editorAssist !== false,
    announcement: session.announcement || ""
  };
}

app.get("/api/sessions", requireTeacherAuth, (req, res) => {
  const list = [...sessions.values()].filter(s => !s.deleted && !s.closed).map(sessionSummary)
    .sort((a,b) => b.createdAt - a.createdAt);
  res.json(list);
});

app.post("/api/sessions/:code/block-toggle", requireTeacherAuth, (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const session = sessions.get(code);
  if (!session || session.deleted || session.closed) return res.status(404).json({ error: "not_found" });
  session.blocked = !session.blocked;
  if (session.blocked) {
    for (const student of getActiveStudents(session)) {
      if (student.socketId) io.to(student.socketId).emit("force_landing");
      student.socketId = null;
    }
    session.statusText = "Sessie geblokkeerd";
    session.statusType = "warning";
  } else {
    session.statusText = "Sessie opnieuw gestart";
    session.statusType = "success";
  }
  emitTeacherSession(session);
  res.json(sessionSummary(session));
});

app.delete("/api/sessions/:code", requireTeacherAuth, (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const session = sessions.get(code);
  if (!session) return res.status(404).json({ error: "not_found" });
  for (const student of getActiveStudents(session)) {
    if (student.socketId) io.to(student.socketId).emit("force_landing");
  }
  if (session.teacherSocketId) io.to(session.teacherSocketId).emit("teacher_go_sessions");
  sessions.delete(code);
  res.json({ ok: true });
});

function getActiveStudents(session) {
  return Object.values(session.students).filter(s => !s.removed);
}

function emitTeacherSession(session) {
  if (!session.teacherSocketId) return;
  io.to(session.teacherSocketId).emit("teacher_session_data", buildTeacherData(session));
}


function findReusableStudent(session, name, resumeId = null) {
  if (resumeId && session.students[resumeId] && !session.students[resumeId].removed) {
    return session.students[resumeId];
  }

  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return null;

  // Hergebruik bij voorkeur een offline leerling met exact dezelfde naam
  for (const student of Object.values(session.students)) {
    if (student.removed) continue;
    if ((student.name || '').trim().toLowerCase() !== normalized) continue;
    if (!student.socketId) return student;
  }

  return null;
}


function buildTeacherData(session) {
  const classMode = session.mode === "class" && (session.classWorkspaceMode || "shared") === "shared";
  const students = getActiveStudents(session).map(s => ({
    id: s.id,
    name: s.name,
    canRun: s.classCanRun !== false,
    canEdit: s.classCanEdit !== false,
    online: Boolean(s.socketId)
  }));
  let view = {
    mode: session.mode,
    title: session.name,
    code: "",
    codeRevision: 0,
    codeSourceSocketId: null,
    output: "",
    selectedStudentId: session.selectedStudentId || null,
    selectedStudentName: null,
    readOnly: session.mode === "exam"
  };
  if (session.mode === "class") {
    view.code = session.sharedCode;
    view.codeRevision = session.sharedCodeRevision || 0;
    view.codeSourceSocketId = session.sharedCodeSourceSocketId || null;
    view.output = session.sharedOutput;
    view.readOnly = false;
  } else if (session.selectedStudentId && session.students[session.selectedStudentId] && !session.students[session.selectedStudentId].removed) {
    const s = session.students[session.selectedStudentId];
    view.code = s.code;
    view.codeRevision = s.codeRevision || 0;
    view.codeSourceSocketId = s.codeSourceSocketId || null;
    view.output = s.output;
    view.selectedStudentName = s.name;
    view.readOnly = true;
  }
  return {
    session: { ...sessionSummary(session), classWorkspaceMode: session.classWorkspaceMode || "shared" },
    students,
    view,
    announcement: session.announcement || "",
    statusText: session.statusText || "Sessie actief",
    statusType: session.statusType || "info",
    allRunEnabled: getActiveStudents(session).length > 0 && getActiveStudents(session).every(s => s.classCanRun !== false),
    allCodeEnabled: getActiveStudents(session).length > 0 && getActiveStudents(session).every(s => s.classCanEdit !== false)
  };
}

function setStatus(session, text, type="info") {
  session.statusText = text;
  session.statusType = type;
  emitTeacherSession(session);
}


function emitStudentState(session, student) {
  if (!student.socketId) return;
  const activeWorkspace = session.mode === "class" ? (session.classWorkspaceMode || "shared") : "personal";
  const currentCode = session.mode === "class"
    ? (activeWorkspace === "shared" ? session.sharedCode : student.personalCode)
    : student.code;
  const currentOutput = session.mode === "class"
    ? (activeWorkspace === "shared" ? student.output : student.personalOutput)
    : student.output;
  const effectiveCanRun = session.mode === "class"
    ? (activeWorkspace === "shared" ? student.classCanRun !== false : student.personalCanRun !== false)
    : student.personalCanRun !== false;
  const effectiveCanEdit = session.mode === "class"
    ? (activeWorkspace === "shared" ? student.classCanEdit !== false : student.personalCanEdit !== false)
    : student.personalCanEdit !== false;
  io.to(student.socketId).emit("student_state", {
    session: { ...sessionSummary(session), classWorkspaceMode: session.classWorkspaceMode || "shared" },
    student: {
      id: student.id,
      name: student.name,
      canRun: effectiveCanRun,
      canEdit: effectiveCanEdit,
      classCanRun: student.classCanRun !== false,
      classCanEdit: student.classCanEdit !== false,
      personalCanRun: student.personalCanRun !== false,
      personalCanEdit: student.personalCanEdit !== false
    },
    mode: session.mode,
    editorAssist: session.editorAssist !== false,
    announcement: session.announcement || "",
    activeWorkspace,
    sharedCode: session.sharedCode,
    sharedCodeRevision: session.sharedCodeRevision || 0,
    sharedCodeSourceSocketId: session.sharedCodeSourceSocketId || null,
    personalCode: student.personalCode,
    personalCodeRevision: student.personalCodeRevision || 0,
    personalCodeSourceSocketId: student.personalCodeSourceSocketId || null,
    code: currentCode,
    codeRevision: activeWorkspace === "shared" ? (session.sharedCodeRevision || 0) : (student.personalCodeRevision || 0),
    codeSourceSocketId: activeWorkspace === "shared" ? (session.sharedCodeSourceSocketId || null) : (student.personalCodeSourceSocketId || null),
    output: currentOutput
  });
}

function broadcastClassCode(session, exceptSocketId = null) {
  for (const student of getActiveStudents(session)) {
    if (student.socketId && student.socketId !== exceptSocketId) {
      emitStudentState(session, student);
    }
  }
  emitTeacherSession(session);
}

function updateTeacherLiveView(session, studentId) {
  if (session.mode !== "exam") return;
  if (session.selectedStudentId === studentId) emitTeacherSession(session);
}

async function runnerStart(code) {
  const res = await fetch(`${RUNNER_URL}/runs/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });
  if (!res.ok) throw new Error(`Runner start failed: ${res.status}`);
  return await res.json();
}

async function runnerEvents(runId, after) {
  const res = await fetch(`${RUNNER_URL}/runs/${runId}/events?after=${after}`);
  if (!res.ok) throw new Error(`Runner events failed: ${res.status}`);
  return await res.json();
}

async function runnerInput(runId, input) {
  const res = await fetch(`${RUNNER_URL}/runs/${runId}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input })
  });
  if (!res.ok) throw new Error(`Runner input failed: ${res.status}`);
}

function clearRunRef(info) {
  const session = sessions.get(info.sessionCode);
  if (!session) return;
  if (info.audience === "teacher-all" || info.audience === "teacher-preview") {
    if (session.teacherRunId === info.runId) session.teacherRunId = null;
  } else if (info.targetStudentId && session.students[info.targetStudentId]) {
    const s = session.students[info.targetStudentId];
    if (s.runId === info.runId) s.runId = null;
  }
}

async function pollRun(runId) {
  const info = activeRuns.get(runId);
  if (!info) return;
  while (activeRuns.has(runId)) {
    const current = activeRuns.get(runId);
    if (!current) return;
    try {
      const data = await runnerEvents(runId, current.after || 0);
      current.after = data.lastSeq || current.after || 0;

      // ⏳ Run staat nog in de wachtrij — stuur wachtpositie naar de leerling
      if (data.queued) {
        const pos = data.queuePosition;
        const session = sessions.get(current.sessionCode);
        if (session) {
          const msg = pos
            ? `⏳ Wachtrij: positie ${pos} — even geduld...`
            : `⏳ In wachtrij, bijna aan de beurt...`;

          if (current.audience === "teacher-all") {
            setStatus(session, msg, "info");
          } else if (current.audience === "student") {
            const s = session.students[current.targetStudentId];
            if (s && s.socketId) {
              io.to(s.socketId).emit("run_queued", { position: pos, message: msg });
            }
          } else if (current.audience === "teacher-preview" && session.teacherSocketId) {
            setStatus(session, msg, "info");
          }
        }
        // Langzamer pollen zolang we in de wachtrij staan (minder belasting)
        await new Promise(resolve => setTimeout(resolve, 800));
        continue;
      }

      for (const event of data.events || []) {
        forwardRunnerEvent(current, event);
      }
      if (!data.running) {
        activeRuns.delete(runId);
        clearRunRef(current);
        return;
      }
    } catch (err) {
      const session = sessions.get(current.sessionCode);
      if (session) setStatus(session, `Runnerfout: ${err.message}`, "error");
      activeRuns.delete(runId);
      clearRunRef(current);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 180));
  }
}

function forwardRunnerEvent(info, event) {
  const session = sessions.get(info.sessionCode);
  if (!session) return;

  if (info.audience === "teacher-all") {
    if (event.type === "stdout" || event.type === "stderr") {
      session.sharedOutput += event.data;
      io.to(session.code).emit("run_output", { audience: "teacher-all", output: session.sharedOutput });
    } else if (event.type === "input_request") {
      io.to(session.code).emit("input_request", { audience: "teacher-all" });
      setStatus(session, "Wacht op input voor gedeelde run", "warning");
    } else if (event.type === "end") {
      io.to(session.code).emit("run_end", { audience: "teacher-all" });
      setStatus(session, "Leerkracht-run voltooid", "success");
    }
    return;
  }

  if (info.audience === "student") {
    const s = session.students[info.targetStudentId];
    if (!s || s.removed) return;
    if (event.type === "stdout" || event.type === "stderr") {
      if (info.workspace === "personal") {
        s.personalOutput += event.data;
        if (s.socketId) io.to(s.socketId).emit("run_output", { audience: "student", output: s.personalOutput });
      } else {
        s.output += event.data;
        if (s.socketId) io.to(s.socketId).emit("run_output", { audience: "student", output: s.output });
      }
      updateTeacherLiveView(session, s.id);
    } else if (event.type === "input_request") {
      if (s.socketId) io.to(s.socketId).emit("input_request", { audience: "student" });
      if (session.mode === "exam" && session.selectedStudentId === s.id && session.teacherSocketId) {
        io.to(session.teacherSocketId).emit("mirror_input_request", { studentId: s.id });
      }
      setStatus(session, `Wacht op input van ${s.name}`, "warning");
    } else if (event.type === "end") {
      if (s.socketId) io.to(s.socketId).emit("run_end", { audience: "student" });
      updateTeacherLiveView(session, s.id);
      setStatus(session, `${s.name} run voltooid`, "success");
    }
    return;
  }

  if (info.audience === "teacher-preview") {
    if (!session.teacherSocketId) return;
    if (event.type === "stdout" || event.type === "stderr") {
      io.to(session.teacherSocketId).emit("teacher_preview_output", { output: event.data, append: true });
    } else if (event.type === "input_request") {
      io.to(session.teacherSocketId).emit("teacher_preview_input_request", {});
      setStatus(session, "Wacht op input in preview-run", "warning");
    } else if (event.type === "end") {
      io.to(session.teacherSocketId).emit("teacher_preview_end", {});
      setStatus(session, "Preview-run voltooid", "success");
    }
  }
}

async function startPythonRun({ session, code, targetStudentId = null, audience = "student", workspace = null }) {
  const { runId } = await runnerStart(code);
  const info = {
    runId,
    sessionCode: session.code,
    targetStudentId,
    audience,
    workspace,
    after: 0
  };
  activeRuns.set(runId, info);
  pollRun(runId).catch(err => {
    console.error("pollRun error", err);
  });
  return runId;
}

io.on("connection", (socket) => {
  socket.on("teacher_create_session", ({ name, mode, editorAssist }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const code = makeCode();
    const session = {
      code,
      id: crypto.randomUUID(),
      name: name || "Nieuwe sessie",
      mode: mode === "exam" ? "exam" : "class",
      editorAssist: editorAssist !== false,
      createdAt: Date.now(),
      teacherSocketId: socket.id,
      selectedStudentId: null,
      classWorkspaceMode: "shared",
      sharedCode: 'print("Hallo klas")\nnaam = input("Wat is je naam? ")\nprint("Welkom", naam)\n',
      sharedOutput: "",
      announcement: "",
      students: {},
      closed: false,
      blocked: false,
      deleted: false,
      teacherRunId: null,
      statusText: "Sessie aangemaakt",
      statusType: "success"
    };
    sessions.set(code, session);
    socket.join(code);
    socketToUser.set(socket.id, { role: "teacher", code });
    socket.emit("session_created", { code, mode: session.mode });
    emitTeacherSession(session);
  });

  socket.on("teacher_join_session", ({ code }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const session = sessions.get((code || "").toUpperCase());
    if (!session || session.closed || session.deleted) return socket.emit("error_message", "Sessie niet gevonden");
    session.teacherSocketId = socket.id;
    socket.join(session.code);
    socketToUser.set(socket.id, { role: "teacher", code: session.code });
    emitTeacherSession(session);
  });

  socket.on("student_join", ({ name, code, resumeId }) => {
    const session = sessions.get((code || "").toUpperCase());
    if (!session || session.closed || session.deleted || session.blocked) return socket.emit("error_message", "Sessie niet gevonden of niet bereikbaar");

    let student = findReusableStudent(session, name, resumeId);

    if (student) {
      student.name = name || student.name || "Leerling";
      student.socketId = socket.id;
      student.removed = false;
      socket.join(session.code);
      socketToUser.set(socket.id, { role: "student", code: session.code, studentId: student.id });
      emitStudentState(session, student);
      emitTeacherSession(session);
      setStatus(session, `${student.name} is opnieuw verbonden`, "info");
      return;
    }

    const id = crypto.randomUUID();
    student = {
      id, name: name || "Leerling", socketId: socket.id,
      classCanRun: false, classCanEdit: false, personalCanRun: false, personalCanEdit: false, removed: false,
      code: session.mode === "class" ? session.sharedCode : 'print("Hallo")\n',
      personalCode: '',
      personalOutput: "",
      output: "",
      runId: null
    };
    session.students[id] = student;
    socket.join(session.code);
    socketToUser.set(socket.id, { role: "student", code: session.code, studentId: id });
    emitStudentState(session, student);
    emitTeacherSession(session);
    setStatus(session, `${student.name} is gejoined`, "info");
  });

  socket.on("student_reconnect", ({ code, studentId }) => {
    const session = sessions.get((code || "").toUpperCase());
    if (!session || session.closed || session.deleted || session.blocked) return socket.emit("force_landing");
    const s = session.students[studentId];
    if (!s || s.removed) return socket.emit("force_landing");
    s.socketId = socket.id;
    socket.join(session.code);
    socketToUser.set(socket.id, { role: "student", code: session.code, studentId: studentId });
    emitStudentState(session, s);
    emitTeacherSession(session);
  });

  socket.on("student_leave_to_landing", () => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "student") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    const s = session.students[ctx.studentId];
    if (s) s.socketId = null;
    socket.leave(ctx.code);
    socketToUser.delete(socket.id);
    emitTeacherSession(session);
  });

  
socket.on("code_update", ({ codeText, workspace } = {}) => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx) return;
    const session = sessions.get(ctx.code);
    if (!session || session.closed) return;
    if (ctx.role === "teacher") {
      if (session.mode === "class") {
        session.sharedCode = codeText;
        session.sharedCodeRevision = (session.sharedCodeRevision || 0) + 1;
        session.sharedCodeSourceSocketId = socket.id;
        broadcastClassCode(session, null);
      }
    } else {
      const s = session.students[ctx.studentId];
      if (!s || s.removed) return;
      if (session.mode === "class") {
        const targetWorkspace = workspace === "personal" ? "personal" : ((workspace === "shared") ? "shared" : (session.classWorkspaceMode || "shared"));
        if (targetWorkspace === "shared") {
          if (s.classCanEdit === false) return;
          session.sharedCode = codeText;
          session.sharedCodeRevision = (session.sharedCodeRevision || 0) + 1;
          session.sharedCodeSourceSocketId = socket.id;
          broadcastClassCode(session, socket.id);
          emitStudentState(session, s);
        } else {
          if (s.personalCanEdit === false) return;
          s.personalCode = codeText;
          s.personalCodeRevision = (s.personalCodeRevision || 0) + 1;
          s.personalCodeSourceSocketId = socket.id;
          emitStudentState(session, s);
        }
      } else {
        if (s.personalCanEdit === false) return;
        s.code = codeText;
        s.codeRevision = (s.codeRevision || 0) + 1;
        s.codeSourceSocketId = socket.id;
        updateTeacherLiveView(session, s.id);
      }
    }
  });

  socket.on("teacher_send_announcement", ({ text }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    session.announcement = String(text || "").trim();
    if (session.announcement) {
      setStatus(session, "Opdracht naar leerlingen gestuurd", "success");
    } else {
      setStatus(session, "Opdrachtbericht gewist", "info");
    }
    for (const s of getActiveStudents(session)) emitStudentState(session, s);
    emitTeacherSession(session);
  });

  socket.on("teacher_select_student", ({ studentId }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session || session.mode !== "exam") return;
    if (!session.students[studentId] || session.students[studentId].removed) return;
    session.selectedStudentId = studentId;
    setStatus(session, `Live control op ${session.students[studentId].name}`, "info");
  });



  socket.on("teacher_toggle_class_workspace", () => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session || session.mode !== "class") return;
    session.classWorkspaceMode = (session.classWorkspaceMode || "shared") === "shared" ? "personal" : "shared";
    if (session.classWorkspaceMode === "personal") {
      for (const s of getActiveStudents(session)) {
        // Individuele werkfase heeft eigen permissies en mag niet afhangen
        // van de leerkracht-toggle voor de gedeelde klascode.
        s.personalCanRun = true;
        s.personalCanEdit = true;
        if (s.socketId) io.to(s.socketId).emit("force_workspace", { workspace: "personal", panel: "code" });
      }
      setStatus(session, "Individuele werkfase gestart", "warning");
    } else {
      for (const s of getActiveStudents(session)) {
        if (s.socketId) io.to(s.socketId).emit("force_workspace", { workspace: "shared", panel: "code" });
      }
      setStatus(session, "Terug naar klascode", "success");
    }
    for (const s of getActiveStudents(session)) emitStudentState(session, s);
    emitTeacherSession(session);
  });

  socket.on("teacher_toggle_student", ({ studentId, field }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    const s = session.students[studentId];
    if (!s || s.removed) return;
    if (field === "run") {
      const newValue = !(s.classCanRun !== false);
      s.classCanRun = newValue;
    }
    if (field === "code") {
      const newValue = !(s.classCanEdit !== false);
      s.classCanEdit = newValue;
    }
    emitStudentState(session, s);
    setStatus(session, `Permissie aangepast voor ${s.name}`, "info");
  });

  socket.on("teacher_toggle_all", ({ field }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    const students = getActiveStudents(session);
    const allEnabled = field === "run" ? students.every(s => s.classCanRun !== false) : students.every(s => s.classCanEdit !== false);
    const newValue = !allEnabled;
    for (const s of students) {
      if (field === "run") { s.classCanRun = newValue; }
      if (field === "code") { s.classCanEdit = newValue; }
      emitStudentState(session, s);
    }
    setStatus(session, `${field === "run" ? "Run" : "Code"} voor iedereen ${newValue ? "aan" : "uit"}`, "info");
  });

  socket.on("teacher_remove_student", ({ studentId }) => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    const s = session.students[studentId];
    if (!s || s.removed) return;
    s.removed = true;
    if (s.socketId) io.to(s.socketId).emit("force_landing");
    if (session.selectedStudentId === studentId) session.selectedStudentId = null;
    setStatus(session, `${s.name} werd verwijderd`, "warning");
  });

  socket.on("teacher_toggle_session_block", () => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session || session.deleted) return;
    session.blocked = !session.blocked;
    if (session.blocked) {
      for (const s of getActiveStudents(session)) {
        if (s.socketId) io.to(s.socketId).emit("force_landing");
        s.socketId = null;
      }
      setStatus(session, "Sessie geblokkeerd", "warning");
    } else {
      setStatus(session, "Sessie opnieuw gestart", "success");
    }
    emitTeacherSession(session);
  });

  socket.on("teacher_delete_session", () => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    session.deleted = true;
    for (const s of getActiveStudents(session)) {
      if (s.socketId) io.to(s.socketId).emit("force_landing");
    }
    if (session.teacherSocketId) io.to(session.teacherSocketId).emit("teacher_go_sessions");
    sessions.delete(session.code);
  });

  socket.on("teacher_close_session", () => {
    if (!socketIsTeacherAuthorized(socket)) return socket.emit("error_message", "Leerkracht-authenticatie vereist");
    const ctx = socketToUser.get(socket.id);
    if (!ctx || ctx.role !== "teacher") return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    session.closed = true;
    io.to(session.code).emit("force_landing");
    setStatus(session, "Sessie afgesloten", "warning");
  });

  socket.on("run_request", async ({ codeText, workspace } = {}) => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx) return;
    const session = sessions.get(ctx.code);
    if (!session || session.closed) return;

    try {
      if (ctx.role === "teacher") {
        if (session.mode === "class") {
          if ((session.classWorkspaceMode || "shared") !== "shared") return;
          const effectiveCode = typeof codeText === "string" ? codeText : session.sharedCode;
          session.sharedCode = effectiveCode;
          session.sharedOutput = "";
          const runId = await startPythonRun({
            session,
            code: effectiveCode,
            audience: "teacher-all"
          });
          session.teacherRunId = runId;
          io.to(session.code).emit("switch_to_output", { audience: "teacher-all" });
          setStatus(session, "Leerkracht-run gestart voor iedereen", "info");
        } else {
          const sid = session.selectedStudentId;
          if (!sid || !session.students[sid] || session.students[sid].removed) return;
          const s = session.students[sid];
          const effectiveCode = typeof codeText === "string" ? codeText : s.code;
          s.code = effectiveCode;
          const runId = await startPythonRun({
            session,
            code: effectiveCode,
            targetStudentId: sid,
            audience: "teacher-preview"
          });
          session.teacherRunId = runId;
          if (session.teacherSocketId) io.to(session.teacherSocketId).emit("teacher_preview_reset");
          setStatus(session, `Preview-run gestart voor ${s.name}`, "info");
        }
        return;
      }

      const s = session.students[ctx.studentId];
      if (!s || s.removed) return;
      const requestedWorkspace = session.mode === "class"
        ? (workspace === "personal" ? "personal" : (workspace === "shared" ? "shared" : (session.classWorkspaceMode || "shared")))
        : "personal";
      const studentCanRun = session.mode === "class"
        ? (requestedWorkspace === "shared" ? (s.classCanRun !== false) : (s.personalCanRun !== false))
        : (s.personalCanRun !== false);
      if (!studentCanRun) return;

      let effectiveCode = typeof codeText === "string" ? codeText : null;

      if (session.mode === "class") {
        if (requestedWorkspace === "personal") {
          if (effectiveCode !== null) {
            s.personalCode = effectiveCode;
            s.personalCodeRevision = (s.personalCodeRevision || 0) + 1;
            s.personalCodeSourceSocketId = socket.id;
          }
          effectiveCode = effectiveCode ?? s.personalCode;
          s.personalOutput = "";
        } else {
          if (effectiveCode !== null) {
            session.sharedCode = effectiveCode;
            session.sharedCodeRevision = (session.sharedCodeRevision || 0) + 1;
            session.sharedCodeSourceSocketId = socket.id;
          }
          effectiveCode = effectiveCode ?? session.sharedCode;
          s.output = "";
        }
      } else {
        if (effectiveCode !== null) s.code = effectiveCode;
        effectiveCode = effectiveCode ?? s.code;
        s.output = "";
      }

      const runId = await startPythonRun({
        session,
        code: effectiveCode,
        targetStudentId: s.id,
        audience: "student",
        workspace: requestedWorkspace
      });
      s.runId = runId;
      if (s.socketId) io.to(s.socketId).emit("switch_to_output", { audience: "student" });
      if (session.mode === "exam" && session.selectedStudentId === s.id && session.teacherSocketId) {
        io.to(session.teacherSocketId).emit("teacher_preview_reset");
      }
      setStatus(session, `${s.name} startte een run`, "info");
    } catch (err) {
      setStatus(session, `Run kon niet starten: ${err.message}`, "error");
    }
  });

  socket.on("runtime_input", async ({ value }) => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx) return;
    const session = sessions.get(ctx.code);
    if (!session) return;

    try {
      if (ctx.role === "teacher") {
        if (session.teacherRunId) {
          await runnerInput(session.teacherRunId, String(value));
          setStatus(session, "Input ontvangen", "success");
        }
        return;
      }

      const s = session.students[ctx.studentId];
      if (s && s.runId) {
        await runnerInput(s.runId, String(value));
        setStatus(session, `Input ontvangen van ${s.name}`, "success");
      }
    } catch (err) {
      setStatus(session, `Inputfout: ${err.message}`, "error");
    }
  });

  socket.on("disconnect", () => {
    const ctx = socketToUser.get(socket.id);
    if (!ctx) return;
    const session = sessions.get(ctx.code);
    if (!session) return;
    if (ctx.role === "teacher") {
      if (session.teacherSocketId === socket.id) session.teacherSocketId = null;
    } else {
      const s = session.students[ctx.studentId];
      if (s) s.socketId = null;
    }
    socketToUser.delete(socket.id);
    emitTeacherSession(session);
  });
});

server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
