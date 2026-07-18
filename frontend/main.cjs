const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let pythonProcess;

function startPythonBackend() {
  const isWindows = process.platform === 'win32';
  const venvPath = isWindows
    ? path.join(__dirname, '..', 'backend', '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '..', 'backend', '.venv', 'bin', 'python');
  const systemPython = 'python';
  
  const pythonExecutable = fs.existsSync(venvPath) ? venvPath : systemPython;
  const serverScript = path.join(__dirname, '..', 'backend', 'server.py');

  console.log('Starting Python backend using:', pythonExecutable);
  
  pythonProcess = spawn(pythonExecutable, [serverScript], {
    cwd: path.join(__dirname, '..', 'backend')
  });

  pythonProcess.stdout.on('data', (data) => {
    console.log(`Backend: ${data}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`Backend log: ${data}`);
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

  // Load the Vite dev server
  mainWindow.loadURL('http://localhost:5173');

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', () => {
  startPythonBackend();
  // Wait a little bit for the python backend and Vite server to start before showing the window
  setTimeout(createWindow, 2000);
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
