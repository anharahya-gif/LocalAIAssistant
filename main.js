const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#05070a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Window controls
ipcMain.on('minimize-window', () => mainWindow.minimize());
ipcMain.on('maximize-window', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('close-window', () => mainWindow.close());

// ===== FITUR LAINNYA (IPC) =====

// Ekspor Chat ke TXT
ipcMain.on('save-txt', async (event, { title, content }) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Ekspor Chat ke TXT',
    defaultPath: path.join(app.getPath('documents'), `${title.replace(/[^a-zA-Z0-9\s]/g, '').trim().substring(0, 30)}.txt`),
    filters: [{ name: 'Text Files', extensions: ['txt'] }]
  });
  if (filePath) {
    try {
      fs.writeFileSync(filePath, content, 'utf8');
      event.reply('save-txt-success', filePath);
    } catch (err) {
      console.error(err);
      event.reply('save-txt-error', err.message);
    }
  }
});

// Ekspor Chat ke PDF
ipcMain.on('save-pdf', async (event, { title, htmlContent }) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Ekspor Chat ke PDF',
    defaultPath: path.join(app.getPath('documents'), `${title.replace(/[^a-zA-Z0-9\s]/g, '').trim().substring(0, 30)}.pdf`),
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  if (!filePath) return;

  // Buat window offscreen tersembunyi untuk merender PDF
  let printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const fullHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
        body {
          font-family: 'Inter', system-ui, sans-serif;
          background-color: #ffffff;
          color: #111827;
          padding: 40px;
          font-size: 14px;
          line-height: 1.6;
        }
        .header {
          border-bottom: 2px solid #e5e7eb;
          padding-bottom: 15px;
          margin-bottom: 25px;
        }
        .header h1 {
          font-size: 22px;
          font-weight: 700;
          color: #2563eb;
          margin: 0 0 5px 0;
        }
        .header p {
          font-size: 12px;
          color: #6b7280;
          margin: 0;
        }
        .message {
          margin-bottom: 24px;
          page-break-inside: avoid;
        }
        .message-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 6px;
        }
        .message.user .message-label {
          color: #2563eb;
        }
        .message.ai .message-label {
          color: #38bdf8;
        }
        .message-bubble {
          background: #f3f4f6;
          border-radius: 8px;
          padding: 12px 16px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .message.user .message-bubble {
          background: #f0f7ff;
          border: 1px solid #bfdbfe;
        }
        .message.ai .message-bubble {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
        }
        /* Markdown styles in PDF */
        h1, h2, h3 { margin-top: 16px; margin-bottom: 8px; font-weight: 700; }
        h1 { font-size: 18px; color: #2563eb; }
        h2 { font-size: 16px; color: #3b82f6; }
        h3 { font-size: 14px; color: #38bdf8; }
        pre {
          background: #1f2937;
          color: #f9fafb;
          padding: 12px;
          border-radius: 6px;
          overflow-x: auto;
          margin: 10px 0;
        }
        code {
          font-family: monospace;
          background: #f3f4f6;
          padding: 2px 4px;
          border-radius: 4px;
          color: #db2777;
          font-size: 13px;
        }
        pre code {
          background: none;
          padding: 0;
          color: #f3f4f6;
        }
        blockquote {
          border-left: 3px solid #3b82f6;
          padding: 4px 12px;
          margin: 8px 0;
          color: #4b5563;
          background: #f0f7ff;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 10px 0;
        }
        th, td {
          padding: 8px 12px;
          border: 1px solid #e5e7eb;
        }
        th {
          background: #f3f4f6;
          font-weight: 600;
        }
        .message-meta {
          font-size: 11px;
          color: #6b7280;
          margin-top: 4px;
          padding-left: 4px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Riwayat Percakapan AI Assistant</h1>
        <p>Judul: ${title} &bull; Tanggal Ekspor: ${new Date().toLocaleString('id-ID')}</p>
      </div>
      <div class="chat-container">
        ${htmlContent}
      </div>
    </body>
    </html>
  `;

  printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fullHtml)}`);

  printWindow.webContents.on('did-finish-load', async () => {
    try {
      const pdfData = await printWindow.webContents.printToPDF({
        margins: { top: 36, bottom: 36, left: 36, right: 36 },
        pageSize: 'A4',
        printBackground: true
      });
      fs.writeFileSync(filePath, pdfData);
      event.reply('save-pdf-success', filePath);
    } catch (err) {
      console.error(err);
      event.reply('save-pdf-error', err.message);
    } finally {
      printWindow.destroy();
    }
  });
});

// Pengaturan Auto-Start
ipcMain.on('set-auto-start', (event, enabled) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: app.getPath('exe')
    });
    event.reply('auto-start-status', enabled);
  } catch (err) {
    console.error(err);
  }
});

ipcMain.on('get-auto-start', (event) => {
  try {
    const loginSettings = app.getLoginItemSettings();
    event.reply('auto-start-status', loginSettings.openAtLogin);
  } catch (err) {
    console.error(err);
    event.reply('auto-start-status', false);
  }
});

ipcMain.on('log-voices', (event, voiceNames) => {
  console.log('=== SUARA TTS YANG TERSEDIA DI SISTEM ===');
  voiceNames.forEach((name, i) => {
    console.log(`${i}: ${name}`);
  });
  console.log('=========================================');
});

