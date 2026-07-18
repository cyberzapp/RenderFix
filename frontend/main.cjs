const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let pythonProcess;

function startPythonBackend() {
  // Use the local virtual environment Python
  const venvPath = path.join(__dirname, '..', 'backend', '.venv', 'Scripts', 'python.exe');
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
      // In Windows, we might need to kill the process tree.
      spawn("taskkill", ["/pid", pythonProcess.pid, '/f', '/t']);
    } catch (e) {
      pythonProcess.kill();
    }
  }
});
