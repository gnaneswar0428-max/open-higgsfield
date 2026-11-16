// OpenHiggsfield desktop shell: starts the bundled Next.js standalone server
// on a local port and shows it in a window.
const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const HOST = "127.0.0.1";
// Fixed port: browser storage (gallery history) is scoped to the origin, so a
// port that changed every launch would make history look empty.
const PREFERRED_PORT = 47821;

const SETTINGS_TEMPLATE = `# OpenHiggsfield settings. Edit, save, then restart the app.
# Generation API origin (server only)
HF_API_BASE_URL=
# Vercel Blob read-write token, needed for uploading reference images/videos
OPEN_HIGGSFIELD_READ_WRITE_TOKEN=
`;

let server = null;
let mainWindow = null;

function settingsPath() {
  return path.join(app.getPath("userData"), ".env");
}

function readSettings() {
  const file = settingsPath();
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, SETTINGS_TEMPLATE);
  }
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith("#")) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    if (value) env[match[1]] = value;
  }
  return env;
}

function serverDir() {
  return app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "server");
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, HOST);
  });
}

async function pickPort() {
  for (let port = PREFERRED_PORT; port < PREFERRED_PORT + 20; port++) {
    if (await portIsFree(port)) return port;
  }
  throw new Error("No free local port found");
}

function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (!server || server.exitCode !== null) return reject(new Error("The local server stopped while starting."));
        if (Date.now() - started > timeoutMs) return reject(new Error("The local server did not start in time."));
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function startServer() {
  const dir = serverDir();
  const entry = path.join(dir, "server.js");
  if (!fs.existsSync(entry)) {
    throw new Error(`Bundled server not found at ${entry}. Run "npm run prepare-server" in desktop/.`);
  }
  const port = await pickPort();
  server = spawn(process.execPath, [entry], {
    cwd: dir,
    env: {
      ...process.env,
      ...readSettings(),
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(port),
      HOSTNAME: HOST,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = fs.createWriteStream(path.join(app.getPath("userData"), "server.log"), { flags: "w" });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  const url = `http://${HOST}:${port}`;
  await waitForServer(url);
  return url;
}

function stopServer() {
  if (server && server.exitCode === null) server.kill();
  server = null;
}

function buildMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Edit Settings (.env)…",
          click: () => {
            readSettings();
            shell.openPath(settingsPath());
          },
        },
        {
          label: "Restart App",
          click: () => {
            app.relaunch();
            app.quit();
          },
        },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#000000",
    title: "OpenHiggsfield",
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());

  const appUrl = await startServer();
  const appOrigin = new URL(appUrl).origin;

  // Links to anything other than the local studio open in the default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin !== appOrigin) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== appOrigin) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(appUrl);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    buildMenu();
    try {
      await createWindow();
    } catch (error) {
      dialog.showErrorBox(
        "OpenHiggsfield could not start",
        `${error.message}\n\nDetails are in ${path.join(app.getPath("userData"), "server.log")}`,
      );
      app.quit();
    }
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", stopServer);
  app.on("will-quit", stopServer);
}
