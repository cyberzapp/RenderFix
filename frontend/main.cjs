const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let pythonProcess;
let isQuitting = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) createWindow();
    else if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
}

function getBackendDirectory() {
  const candidates = [process.env.RENDERFIX_BACKEND_DIR];

  if (app.isPackaged) {
    const backendPathFile = path.join(process.resourcesPath, 'backend-path.txt');
    if (fs.existsSync(backendPathFile)) {
      candidates.push(fs.readFileSync(backendPathFile, 'utf8').trim());
    }
  } else {
    candidates.push(path.resolve(__dirname, '..', 'backend'));
  }

  return candidates.find((candidate) => candidate && fs.existsSync(path.join(candidate, 'server.py')));
}

function startPythonBackend() {
  const isWindows = process.platform === 'win32';
  const backendDirectory = getBackendDirectory();
  if (!backendDirectory) {
    throw new Error('RenderFix could not find its backend folder. Keep the project folder in its original location.');
  }

  const venvPath = isWindows
    ? path.join(backendDirectory, '.venv', 'Scripts', 'python.exe')
    : path.join(backendDirectory, '.venv', 'bin', 'python');
  const systemPython = isWindows ? 'python' : 'python3';
  
  const pythonExecutable = fs.existsSync(venvPath) ? venvPath : systemPython;
  const serverScript = path.join(backendDirectory, 'server.py');

  console.log('Starting Python backend using:', pythonExecutable);
  
  pythonProcess = spawn(pythonExecutable, [serverScript], {
    cwd: backendDirectory,
    env: { ...process.env, RENDERFIX_BACKEND_DIR: backendDirectory },
  });

  pythonProcess.stdout.on('data', (data) => {
    console.log(`Backend: ${data}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`Backend log: ${data}`);
  });

  pythonProcess.on('error', (error) => {
    dialog.showErrorBox('RenderFix could not start', `The Python backend failed to launch.\n\n${error.message}`);
    app.quit();
  });

  pythonProcess.on('exit', (code) => {
    if (!isQuitting && code !== 0) {
      dialog.showErrorBox('RenderFix backend stopped', `The Python backend exited with code ${code}. Check that the project folder and backend environment are still available.`);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'FrameX',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
  }

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', () => {
  if (!hasSingleInstanceLock) return;
  try {
    startPythonBackend();
    setTimeout(createWindow, 2500);
  } catch (error) {
    dialog.showErrorBox('RenderFix could not start', error.message);
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('window-all-closed', function () {
  if (pythonProcess) {
    pythonProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  isQuitting = true;
  // Kill the python backend when the app closes
  if (pythonProcess) {
    console.log('Killing Python backend...');
    try {
      if (process.platform === 'win32') {
        // In Windows, we kill the process tree to ensure it stops.
        spawn("taskkill", ["/pid", pythonProcess.pid, '/f', '/t']);
      } else {
        // On Mac/Linux, a standard kill signal works perfectly.
        pythonProcess.kill('SIGTERM');
      }
    } catch (e) {
      pythonProcess.kill();
    }
  }
});
