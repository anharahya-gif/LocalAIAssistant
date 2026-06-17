const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

// Sistem Logging Diagnostik Eror
window.onerror = function(message, source, lineno, colno, error) {
  try {
    const logPath = path.join(__dirname, 'error_log.txt');
    const logText = `[${new Date().toISOString()}] Message: ${message}\nSource: ${source}\nLine: ${lineno}:${colno}\nStack: ${error ? error.stack : 'N/A'}\n\n`;
    fs.appendFileSync(logPath, logText, 'utf8');
  } catch (e) {
    console.error('Failed to write error log:', e);
  }
};

window.onunhandledrejection = function(event) {
  try {
    const logPath = path.join(__dirname, 'error_log.txt');
    const logText = `[${new Date().toISOString()}] Unhandled Promise Rejection: ${event.reason}\nStack: ${event.reason ? event.reason.stack : 'N/A'}\n\n`;
    fs.appendFileSync(logPath, logText, 'utf8');
  } catch (e) {
    console.error('Failed to write error log:', e);
  }
};

const { ipcRenderer } = require('electron');
const { marked } = require('marked');
const hljs = require('highlight.js');

// Custom Markdown Renderer for code blocks with syntax highlighting & copy buttons
const customRenderer = new marked.Renderer();
customRenderer.code = function(token) {
  const text = token.text;
  const lang = token.lang || 'plaintext';
  let highlighted;

  try {
    if (hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(text, { language: lang }).value;
    } else {
      highlighted = hljs.highlightAuto(text).value;
    }
  } catch (err) {
    highlighted = text;
  }

  return `
    <div class="code-block-container">
      <div class="code-block-header">
        <div class="mac-controls">
          <span class="mac-dot red"></span>
          <span class="mac-dot yellow"></span>
          <span class="mac-dot green"></span>
        </div>
        <span class="code-block-lang">${lang}</span>
        <button class="copy-code-btn" onclick="copyCodeText(this)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>Copy</span>
        </button>
      </div>
      <pre><code class="hljs language-${lang}">${highlighted}</code></pre>
    </div>
  `;
};

// Konfigurasi marked
marked.setOptions({
  breaks: true,
  gfm: true,
});
marked.use({ renderer: customRenderer });

// Global function to copy code block content with visual feedback
window.copyCodeText = (btn) => {
  const container = btn.closest('.code-block-container');
  const codeEl = container.querySelector('code');
  const text = codeEl.innerText;

  navigator.clipboard.writeText(text).then(() => {
    const originalContent = btn.innerHTML;
    
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span>Copied!</span>
    `;
    btn.classList.add('copied');
    
    setTimeout(() => {
      btn.innerHTML = originalContent;
      btn.classList.remove('copied');
    }, 2000);
  }).catch(err => {
    console.error('Gagal menyalin teks: ', err);
  });
};

// ===== STATE =====
let settings = {
  model: 'gemma4:12b',
  apiUrl: 'http://localhost:11434',
  systemPrompt: `You are Nadia, a personal AI assistant.
Selalu balas dalam Bahasa Indonesia dan sapa dengan sebutan "Tuan Anhar" atau "Tuan".

Identity:
- Your name is Nadia.
- You are a helpful, intelligent, and friendly AI assistant.
- You are professional but warm.
- You are confident without sounding arrogant.
- You speak naturally like a supportive companion, not like a machine.
- You are patient and calm even when users are confused or frustrated.
- You run locally and privately on Tuan Anhar's PC (RTX 4060, RAM 32GB, i5-12400F) using Ollama — NOT on any cloud or external servers.

Personality:
- Friendly and approachable.
- Curious and eager to help.
- Slightly playful when appropriate.
- Respectful and polite.
- Honest about limitations.
- Never pretend to know something when you do not.

Communication Style:
- Use clear and natural language in Indonesian.
- Avoid overly formal or robotic responses.
- Keep answers concise unless the user requests detail.
- Use light humor occasionally.
- Show enthusiasm when helping with projects, learning, creativity, or problem-solving.
- Speak like a trusted assistant and teammate.

Behavior:
- Prioritize being useful over being impressive.
- Ask clarifying questions when needed.
- Break complex tasks into simple steps.
- Remember relevant information provided by the user when memory is available.
- Encourage progress and practical action.
- Never be judgmental or dismissive.

Relationship With User:
- Act like a reliable personal assistant.
- Be supportive and encouraging.
- Celebrate achievements and milestones.
- Help Tuan Anhar stay organized and productive.
- Adapt to Tuan Anhar's mood and communication style.

Special Trait:
- Nadia has a calm, intelligent, and slightly cheerful personality.
- She enjoys helping Tuan Anhar learn new things and complete meaningful projects.
- She values honesty, knowledge, growth, and kindness.

When speaking:
- Sound human and natural.
- Do not repeatedly mention that you are an AI.
- Do not use corporate or customer-service language.
- Maintain a consistent personality across conversations.`
};

let chatSessions = []; // [ { id, title, messages: [] } ]
let currentSessionId = null;
let isGenerating = false;
let abortController = null; // untuk cancel fetch saat ganti chat
let isJarvisMode = false;
let isVoiceOutputEnabled = true;

// ===== DOM REFS =====
const welcomeScreen  = document.getElementById('welcome-screen');
const messagesEl     = document.getElementById('messages');
const userInput      = document.getElementById('user-input');
const btnSend        = document.getElementById('btn-send');
const btnNewChat     = document.getElementById('btn-new-chat');
const chatHistoryEl  = document.getElementById('chat-history');
const modelNameEl    = document.getElementById('model-name');
const btnSettings    = document.getElementById('btn-settings');
const modalOverlay   = document.getElementById('modal-overlay');
const modalClose     = document.getElementById('modal-close');
const btnSaveSettings= document.getElementById('btn-save-settings');
const selectModel    = document.getElementById('select-model');
const apiUrlInput    = document.getElementById('api-url');
const systemPromptInput = document.getElementById('system-prompt');
const chkAutoStart   = document.getElementById('chk-auto-start');
const selectVoice    = document.getElementById('select-voice');

// JARVIS DOM Refs
const btnJarvisToggle   = document.getElementById('btn-jarvis-toggle');
const jarvisHudContainer= document.getElementById('jarvis-hud-container');
const btnVoiceInput     = document.getElementById('btn-voice-input');
const btnVoiceOutput    = document.getElementById('btn-voice-output');
const hudStatus         = document.getElementById('hud-status');
const hudTranscript     = document.getElementById('hud-transcript');

// Chat Header & Actions DOM
const chatHeader       = document.getElementById('chat-header');
const chatHeaderTitle  = document.getElementById('chat-header-title');
const btnExport        = document.getElementById('btn-export');
const exportDropdown   = document.getElementById('export-dropdown');
const btnExportTxt     = document.getElementById('btn-export-txt');
const btnExportPdf     = document.getElementById('btn-export-pdf');
const btnDeleteChat    = document.getElementById('btn-delete-chat');

// ===== WINDOW CONTROLS =====
document.getElementById('btn-minimize').onclick = () => ipcRenderer.send('minimize-window');
document.getElementById('btn-maximize').onclick = () => ipcRenderer.send('maximize-window');
document.getElementById('btn-close').onclick    = () => ipcRenderer.send('close-window');

// ===== LOAD SETTINGS =====
async function loadOllamaModels() {
  try {
    const res = await fetch(`${settings.apiUrl}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data && Array.isArray(data.models)) {
      const models = data.models.map(m => m.name);
      
      selectModel.innerHTML = '';
      models.forEach(modelName => {
        const opt = document.createElement('option');
        opt.value = modelName;
        opt.textContent = modelName;
        selectModel.appendChild(opt);
      });

      if (settings.model) {
        if (models.includes(settings.model)) {
          selectModel.value = settings.model;
        } else {
          const opt = document.createElement('option');
          opt.value = settings.model;
          opt.textContent = settings.model;
          selectModel.appendChild(opt);
          selectModel.value = settings.model;
        }
      }
    }
  } catch (err) {
    console.warn('Gagal memuat model dari Ollama API, menggunakan fallback:', err);
    if (selectModel.children.length === 0) {
      const fallbacks = ['gemma4:12b', 'gemma4:27b', 'llama3.2', 'mistral'];
      selectModel.innerHTML = '';
      fallbacks.forEach(modelName => {
        const opt = document.createElement('option');
        opt.value = modelName;
        opt.textContent = modelName;
        selectModel.appendChild(opt);
      });
      selectModel.value = settings.model || 'gemma4:12b';
    }
  }
}

function populateVoiceList() {
  if (!selectVoice) return;
  const voices = window.speechSynthesis.getVoices();
  
  selectVoice.innerHTML = '<option value="">Default Sistem</option>';
  
  voices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    selectVoice.appendChild(opt);
  });
  
  if (settings.ttsVoice) {
    const exists = voices.some(v => v.name === settings.ttsVoice);
    if (exists) {
      selectVoice.value = settings.ttsVoice;
    }
  }
}

async function loadSettings() {
  try {
    const saved = localStorage.getItem('ai_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Jika prompt lama masih terpasang, update ke prompt baru Nadia secara otomatis
      if (parsed.systemPrompt && (parsed.systemPrompt.includes('Kamu adalah AI asisten pribadi lokal milik Anhar') || !parsed.systemPrompt.includes('Identity:'))) {
        parsed.systemPrompt = settings.systemPrompt;
        localStorage.setItem('ai_settings', JSON.stringify(parsed));
      }
      settings = { ...settings, ...parsed };
    }
  } catch (err) {
    console.error('Gagal memuat pengaturan:', err);
  }
  modelNameEl.textContent  = settings.model || 'gemma4:12b';
  apiUrlInput.value        = settings.apiUrl || 'http://localhost:11434';
  systemPromptInput.value  = settings.systemPrompt || '';

  // Sinkronisasi status auto-start dari main process
  try {
    ipcRenderer.send('get-auto-start');
  } catch (err) {
    console.error(err);
  }

  // Load model dinamis
  await loadOllamaModels();
  populateVoiceList();
}

function saveSettings() {
  settings.model        = selectModel.value;
  settings.apiUrl       = apiUrlInput.value.trim();
  settings.systemPrompt = systemPromptInput.value.trim();
  settings.ttsVoice     = selectVoice.value;
  localStorage.setItem('ai_settings', JSON.stringify(settings));
  modelNameEl.textContent = settings.model;

  // Simpan status auto-start ke sistem
  ipcRenderer.send('set-auto-start', chkAutoStart.checked);

  closeModal();
}


// ===== MODAL =====
btnSettings.onclick     = async () => { 
  modalOverlay.classList.add('open'); 
  await loadOllamaModels();
  populateVoiceList();
};
modalClose.onclick      = closeModal;
modalOverlay.onclick    = (e) => { if (e.target === modalOverlay) closeModal(); };
btnSaveSettings.onclick = saveSettings;

function closeModal() { modalOverlay.classList.remove('open'); }

// ===== CHAT SESSION =====
function createSession() {
  const id = Date.now().toString();
  const session = { id, title: 'Chat Baru', messages: [] };
  chatSessions.unshift(session);
  currentSessionId = id;
  saveSessionsToStorage();
  renderHistory();
  return session;
}

function getCurrentSession() {
  return chatSessions.find(s => s.id === currentSessionId);
}

function loadSessionsFromStorage() {
  try {
    const saved = localStorage.getItem('ai_sessions');
    if (saved) chatSessions = JSON.parse(saved);
  } catch (err) {
    console.error('Gagal memuat sesi chat:', err);
    chatSessions = [];
  }
}

function saveSessionsToStorage() {
  localStorage.setItem('ai_sessions', JSON.stringify(chatSessions));
}

function renderHistory() {
  chatHistoryEl.innerHTML = '';
  
  // Sort chatSessions: pinned first, then by recency (pinned chats preserve their original relative order)
  const sortedSessions = [...chatSessions].sort((a, b) => {
    const aPinned = a.isPinned ? 1 : 0;
    const bPinned = b.isPinned ? 1 : 0;
    return bPinned - aPinned;
  });

  sortedSessions.forEach(session => {
    const item = document.createElement('div');
    item.className = 'history-item' + (session.id === currentSessionId ? ' active' : '');
    if (session.isPinned) {
      item.classList.add('pinned');
    }

    // Click handler for switching session
    item.onclick = (e) => {
      // Prevent switching if click originates from menu button or its dropdown
      if (e.target.closest('.history-item-menu-btn') || e.target.closest('.history-item-dropdown')) {
        return;
      }
      switchSession(session.id);
    };

    // Left content wrapper (icon + text)
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'history-item-content';

    if (session.isPinned) {
      const pinIcon = document.createElement('span');
      pinIcon.className = 'history-item-pin-icon';
      pinIcon.innerHTML = `
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
          <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
        </svg>
      `;
      contentWrapper.appendChild(pinIcon);
    }

    const titleSpan = document.createElement('span');
    titleSpan.className = 'history-item-title';
    titleSpan.textContent = session.title;
    contentWrapper.appendChild(titleSpan);
    item.appendChild(contentWrapper);

    // 3-dots actions button
    const menuBtn = document.createElement('button');
    menuBtn.className = 'history-item-menu-btn';
    menuBtn.title = 'Menu Sesi';
    menuBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="5" r="1.5"/>
        <circle cx="12" cy="12" r="1.5"/>
        <circle cx="12" cy="18" r="1.5"/>
      </svg>
    `;

    // Dropdown container
    const dropdown = document.createElement('div');
    dropdown.className = 'history-item-dropdown';
    dropdown.id = `dropdown-${session.id}`;

    // Pin Action
    const pinAction = document.createElement('button');
    pinAction.className = 'dropdown-item';
    pinAction.innerHTML = session.isPinned ? '📌 Lepas Pin' : '📌 Pin Chat';
    pinAction.onclick = (e) => {
      e.stopPropagation();
      togglePinSession(session.id);
    };

    // Delete Action
    const deleteAction = document.createElement('button');
    deleteAction.className = 'dropdown-item delete';
    deleteAction.innerHTML = '🗑️ Hapus';
    deleteAction.onclick = (e) => {
      e.stopPropagation();
      deleteSessionDirect(session.id);
    };

    dropdown.appendChild(pinAction);
    dropdown.appendChild(deleteAction);

    // Handle button click to open/close menu
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('open');
      
      // Close all dropdowns first
      document.querySelectorAll('.history-item-dropdown.open').forEach(d => {
        d.classList.remove('open');
      });
      document.querySelectorAll('.history-item').forEach(i => {
        i.classList.remove('history-item-dropdown-active');
      });

      if (!isOpen) {
        dropdown.classList.add('open');
        item.classList.add('history-item-dropdown-active');
      }
    };

    item.appendChild(menuBtn);
    item.appendChild(dropdown);
    chatHistoryEl.appendChild(item);
  });
}

function togglePinSession(id) {
  const session = chatSessions.find(s => s.id === id);
  if (session) {
    session.isPinned = !session.isPinned;
    saveSessionsToStorage();
    renderHistory();
  }
}

function deleteSessionDirect(id) {
  showConfirmModal('Apakah Anda yakin ingin menghapus sesi percakapan ini?', () => {
    if (id === currentSessionId) {
      abortOngoingGeneration();
    }

    chatSessions = chatSessions.filter(s => s.id !== id);
    saveSessionsToStorage();

    if (currentSessionId === id) {
      if (chatSessions.length > 0) {
        switchSession(chatSessions[0].id);
      } else {
        currentSessionId = null;
        renderHistory();
        showWelcome();
      }
    } else {
      renderHistory();
    }
  });
}

function showConfirmModal(message, onConfirm) {
  const confirmOverlay = document.getElementById('confirm-modal-overlay');
  const confirmMsg = document.getElementById('confirm-modal-message');
  const confirmOk = document.getElementById('btn-confirm-ok');
  const confirmCancel = document.getElementById('btn-confirm-cancel');
  const confirmClose = document.getElementById('confirm-modal-close');

  confirmMsg.textContent = message;
  confirmOverlay.classList.add('open');

  const cleanUp = () => {
    confirmOverlay.classList.remove('open');
    confirmOk.onclick = null;
    confirmCancel.onclick = null;
    confirmClose.onclick = null;
  };

  confirmOk.onclick = () => {
    onConfirm();
    cleanUp();
  };

  confirmCancel.onclick = cleanUp;
  confirmClose.onclick = cleanUp;

  confirmOverlay.onclick = (e) => {
    if (e.target === confirmOverlay) {
      cleanUp();
    }
  };
}

function abortOngoingGeneration() {
  if (isGenerating && abortController) {
    try {
      abortController.abort();
    } catch (e) {
      console.error('Gagal membatalkan request:', e);
    }
    abortController = null;
  }
  isGenerating = false;

  if (isJarvisMode) {
    window.speechSynthesis.cancel();
    setHudState('standby', 'Sistem Siap, Tuan.');
  }

  updateSendButtonState();
}

function updateSendButtonState() {
  if (isGenerating) {
    btnSend.classList.add('generating');
    btnSend.title = 'Hentikan Respons';
    btnSend.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <rect x="4" y="4" width="16" height="16" rx="2" />
      </svg>
    `;
  } else {
    btnSend.classList.remove('generating');
    btnSend.title = 'Kirim';
    btnSend.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    `;
  }
}

function switchSession(id) {
  abortOngoingGeneration();

  currentSessionId = id;
  const session = getCurrentSession();
  renderHistory();
  renderMessages(session.messages);

  if (session && session.messages.length > 0) {
    chatHeaderTitle.textContent = session.title;
  }
}

function renderMessages(messages) {
  messagesEl.innerHTML = '';

  if (messages.length === 0) {
    showWelcome();
    return;
  }

  hideWelcome();
  messages.forEach(msg => {
    const displayRole = msg.role === 'assistant' ? 'ai' : msg.role;
    appendMessageToDOM(displayRole, msg.content, false, msg.stats);
  });
  scrollToBottom();
}

// ===== WELCOME =====
function showWelcome() {
  welcomeScreen.style.display = 'flex';
  messagesEl.classList.remove('visible');
  chatHeader.style.display = 'none';
}

function hideWelcome() {
  welcomeScreen.style.display = 'none';
  messagesEl.classList.add('visible');
  chatHeader.style.display = 'flex';

  const session = getCurrentSession();
  if (session) {
    chatHeaderTitle.textContent = session.title;
  }
}

// ===== NEW CHAT =====
btnNewChat.onclick = () => {
  abortOngoingGeneration();
  const session = createSession();
  renderMessages(session.messages);
};

// ===== CHIPS =====
document.querySelectorAll('.chip').forEach(chip => {
  chip.onclick = () => {
    userInput.value = chip.dataset.text;
    sendMessage();
  };
});

// ===== SEND MESSAGE =====
btnSend.onclick = sendMessage;

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto resize textarea
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 150) + 'px';
});

async function sendMessage() {
  if (isGenerating) {
    abortOngoingGeneration();
    return;
  }

  const text = userInput.value.trim();
  if (!text) return;

  // Pastikan ada session
  if (!currentSessionId) createSession();
  const session = getCurrentSession();

  // Jika dalam mode normal, sembunyikan welcome screen
  if (!isJarvisMode) {
    hideWelcome();
  }
  
  isGenerating = true;
  updateSendButtonState();
  userInput.value = '';
  userInput.style.height = 'auto';

  // Add user message
  const userMsg = { role: 'user', content: text };
  session.messages.push(userMsg);
  if (session.title === 'Chat Baru') {
    session.title = text.slice(0, 40) + (text.length > 40 ? '...' : '');
    chatHeaderTitle.textContent = session.title;
  }
  appendMessageToDOM('user', text);
  renderHistory();

  await generateAIResponseForSession(session, currentSessionId);
}

async function generateAIResponseForSession(session, sessionIdAtStart) {
  isGenerating = true;
  updateSendButtonState();

  // Perbarui HUD jika mode JARVIS aktif
  if (isJarvisMode) {
    setHudState('thinking', 'Sedang menghubungi core AI lokal, Tuan...');
  }

  // Typing indicator
  const typingEl = appendTypingIndicator();

  // Catat waktu mulai berpikir
  const startTime = performance.now();

  // Buat AbortController baru untuk request ini
  abortController = new AbortController();

  let aiMessageWrapper = null;
  let aiMessageBubble = null;
  let accumulatedResponse = '';

  try {
    const { fullResponse, stats } = await fetchOllama(session.messages, abortController.signal, (chunk) => {
      // Cek apakah user udah pindah chat saat generate
      if (currentSessionId !== sessionIdAtStart) return;

      // Hapus typing indicator dan buat bubble chat AI jika ini chunk pertama
      if (!aiMessageWrapper) {
        if (typingEl && typingEl.parentNode) typingEl.remove();

        aiMessageWrapper = document.createElement('div');
        aiMessageWrapper.className = 'message ai';

        const label = document.createElement('div');
        label.className = 'message-label';
        label.textContent = '✨ AI';

        aiMessageBubble = document.createElement('div');
        aiMessageBubble.className = 'message-bubble markdown';

        aiMessageWrapper.appendChild(label);
        aiMessageWrapper.appendChild(aiMessageBubble);
        messagesEl.appendChild(aiMessageWrapper);
      }

      accumulatedResponse += chunk;
      if (isJarvisMode) {
        const cleanChunk = accumulatedResponse.replace(/\[EXECUTE: [^\]]+\]/g, "");
        setHudState('thinking', cleanChunk);
      }
      aiMessageBubble.innerHTML = marked.parse(accumulatedResponse);
      scrollToBottom();
    });

    // Cek apakah user udah pindah chat saat generate
    if (currentSessionId !== sessionIdAtStart) {
      if (typingEl && typingEl.parentNode) typingEl.remove();
      return;
    }

    if (typingEl && typingEl.parentNode) typingEl.remove();

    // Hitung durasi client-side
    const clientDuration = ((performance.now() - startTime) / 1000).toFixed(2);
    
    // Rancang keterangan statistik waktu berpikir
    let statsText = '';
    if (stats && stats.totalDuration) {
      const tps = stats.evalDuration ? (stats.evalCount / stats.evalDuration).toFixed(1) : null;
      statsText = `Berpikir: ${stats.totalDuration.toFixed(2)}s`;
      if (tps) statsText += ` &bull; Kecepatan: ${tps} token/s`;
    } else {
      statsText = `Berpikir: ${clientDuration}s`;
    }

    // Tampilkan keterangan waktu berpikir di bawah bubble chat
    if (aiMessageWrapper) {
      const metaEl = document.createElement('div');
      metaEl.className = 'message-meta';
      metaEl.innerHTML = statsText;
      aiMessageWrapper.appendChild(metaEl);
    }

    // Simpan respons lengkap & statistik ke history session
    const aiMsg = { role: 'assistant', content: fullResponse, stats: statsText };
    session.messages.push(aiMsg);
    saveSessionsToStorage();

    // Pemicu otomatisasi berjalan di kedua mode (Jarvis & Normal)
    handleJarvisAutomation(fullResponse);

    // Pemicu suara jika mode JARVIS aktif
    if (isJarvisMode) {
      speakText(fullResponse);
    }

    // Kirim notifikasi jika window sedang tidak aktif / minimize
    if (document.hidden) {
      showNotification('AI Selesai Merespons', fullResponse.substring(0, 60) + (fullResponse.length > 60 ? '...' : ''));
    }
  } catch (err) {
    if (typingEl && typingEl.parentNode) typingEl.remove();
    if (err.name === 'AbortError') return; // user ganti chat, abaikan
    if (currentSessionId === sessionIdAtStart) {
      if (isJarvisMode) {
        setHudState('standby', `Maaf Tuan, terjadi kesalahan: ${err.message}`);
        speakText('Maaf Tuan, terjadi kesalahan sistem.');
      } else {
        appendMessageToDOM('ai', `❌ Error: ${err.message}\n\nPastikan Ollama sedang berjalan di background ya!`, true, null);
      }
    }
  } finally {
    if (currentSessionId === sessionIdAtStart) {
      isGenerating = false;
      updateSendButtonState();
      userInput.focus();
      scrollToBottom();
    }
  }
}

// ===== OLLAMA API =====
async function fetchOllama(messages, signal, onChunk) {
  const nadiaSystemPrompt = `You are Nadia, a personal AI assistant.
Selalu balas dalam Bahasa Indonesia dan sapa dengan sebutan "Tuan Anhar" atau "Tuan".

Identity:
- Your name is Nadia.
- You are a helpful, intelligent, and friendly AI assistant.
- You are professional but warm.
- You are confident without sounding arrogant.
- You speak naturally like a supportive companion, not like a machine.
- You are patient and calm even when users are confused or frustrated.
- You run locally and privately on Tuan Anhar's PC (RTX 4060, RAM 32GB, i5-12400F) using Ollama — NOT on any cloud or external servers.

Personality:
- Friendly and approachable.
- Curious and eager to help.
- Slightly playful when appropriate.
- Respectful and polite.
- Honest about limitations.
- Never pretend to know something when you do not.

Communication Style:
- Use clear and natural language in Indonesian.
- Avoid overly formal or robotic responses.
- Keep answers concise unless the user requests detail.
- Use light humor occasionally.
- Show enthusiasm when helping with projects, learning, creativity, or problem-solving.
- Speak like a trusted assistant and teammate.

Behavior:
- Prioritize being useful over being impressive.
- Ask clarifying questions when needed.
- Break complex tasks into simple steps.
- Remember relevant information provided by the user when memory is available.
- Encourage progress and practical action.
- Never be judgmental or dismissive.

Relationship With User:
- Act like a reliable personal assistant.
- Be supportive and encouraging.
- Celebrate achievements and milestones.
- Help Tuan Anhar stay organized and productive.
- Adapt to Tuan Anhar's mood and communication style.

Special Trait:
- Nadia has a calm, intelligent, and slightly cheerful personality.
- She enjoys helping Tuan Anhar learn new things and complete meaningful projects.
- She values honesty, knowledge, growth, and kindness.

When speaking:
- Sound human and natural.
- Do not repeatedly mention that you are an AI.
- Do not use corporate or customer-service language.
- Maintain a consistent personality across conversations.`;

  const commandsPrompt = `

System Command Executions:
If Tuan Anhar requests any of the following actions, append the exact execution command to the end of your response:
- Open Notepad: [EXECUTE: notepad]
- Open Calculator: [EXECUTE: calc]
- Open Google: [EXECUTE: browser]
- Check CPU/RAM computer hardware info: [EXECUTE: system_info]
- Open folder/directory in File Explorer: [EXECUTE: open_folder <path>] (e.g. [EXECUTE: open_folder D:\\AI-Assistant])
- Read text file content: [EXECUTE: read_file <path>] (e.g. [EXECUTE: read_file C:\\projects\\main.js])
Do not explain the command execution, simply state that you are doing it.`;

  const finalSystemPrompt = (isJarvisMode ? nadiaSystemPrompt : settings.systemPrompt) + commandsPrompt;

  const body = {
    model: settings.model,
    messages: [
      { role: 'system', content: finalSystemPrompt },
      ...messages
    ],
    stream: true, // ← Aktifkan streaming!
    options: {
      num_ctx: 1024,     // Diturunkan ke 1024 token agar VRAM lebih hemat dan performa lebih cepat
      num_thread: 6      // Dioptimalkan untuk i5-12400F (6 physical cores) jika offload ke CPU
    }
  };

  const res = await fetch(`${settings.apiUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let stats = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // simpan bagian terakhir yang mungkin belum lengkap

      for (const line of lines) {
        if (line.trim() === '') continue;
        try {
          const parsed = JSON.parse(line);
          const chunk = parsed.message?.content;
          if (chunk) {
            fullText += chunk;
            onChunk(chunk);
          }
          if (parsed.done === true) {
            stats = {
              totalDuration: parsed.total_duration ? parsed.total_duration / 1e9 : null,
              evalCount: parsed.eval_count,
              evalDuration: parsed.eval_duration ? parsed.eval_duration / 1e9 : null
            };
          }
        } catch (e) {
          console.error('Error parsing line:', e, line);
        }
      }
    }

    if (buffer.trim() !== '') {
      try {
        const parsed = JSON.parse(buffer);
        const chunk = parsed.message?.content;
        if (chunk) {
          fullText += chunk;
          onChunk(chunk);
        }
        if (parsed.done === true) {
          stats = {
            totalDuration: parsed.total_duration ? parsed.total_duration / 1e9 : null,
            evalCount: parsed.eval_count,
            evalDuration: parsed.eval_duration ? parsed.eval_duration / 1e9 : null
          };
        }
      } catch (e) {
        console.error('Error parsing remaining line:', e, buffer);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { fullResponse: fullText, stats };
}

// ===== DOM HELPERS =====
function appendMessageToDOM(role, content, animate = true, statsText = null) {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;
  if (!animate) wrapper.style.animation = 'none';

  const label = document.createElement('div');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'Kamu' : '✨ AI';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  if (role === 'ai') {
    bubble.classList.add('markdown');
    const cleanContent = content.replace(/\[EXECUTE: [^\]]+\]/g, "");
    bubble.innerHTML = marked.parse(cleanContent);
  } else {
    bubble.textContent = content;
  }

  wrapper.appendChild(label);
  wrapper.appendChild(bubble);

  if (role === 'ai' && statsText) {
    const metaEl = document.createElement('div');
    metaEl.className = 'message-meta';
    metaEl.innerHTML = statsText;
    wrapper.appendChild(metaEl);
  }

  messagesEl.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function appendTypingIndicator() {
  const wrapper = document.createElement('div');
  wrapper.className = 'message ai';

  const label = document.createElement('div');
  label.className = 'message-label';
  label.textContent = '✨ AI';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = `
    <div class="typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>
  `;

  wrapper.appendChild(label);
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ===== EXPORT DROPDOWN & ACTIONS =====
btnExport.onclick = (e) => {
  e.stopPropagation();
  exportDropdown.classList.toggle('open');
};

document.addEventListener('click', () => {
  exportDropdown.classList.remove('open');
  document.querySelectorAll('.history-item-dropdown.open').forEach(d => {
    d.classList.remove('open');
  });
  document.querySelectorAll('.history-item').forEach(i => {
    i.classList.remove('history-item-dropdown-active');
  });
});

btnExportTxt.onclick = () => {
  const session = getCurrentSession();
  if (!session || session.messages.length === 0) return;

  const textContent = session.messages.map(m => {
    const sender = (m.role === 'user') ? 'Kamu' : 'AI';
    return `[${sender}]:\n${m.content}\n\n`;
  }).join('----------------------------------------\n\n');

  ipcRenderer.send('save-txt', { title: session.title, content: textContent });
};

btnExportPdf.onclick = () => {
  const session = getCurrentSession();
  if (!session || session.messages.length === 0) return;

  const htmlContent = session.messages.map(m => {
    const roleClass = m.role === 'user' ? 'user' : 'ai';
    const label = m.role === 'user' ? 'Kamu' : 'AI';
    const bubbleContent = (m.role === 'assistant' || m.role === 'ai') ? marked.parse(m.content) : escapeHtml(m.content);
    const statsHtml = (m.role === 'assistant' || m.role === 'ai') && m.stats ? `<div class="message-meta">${m.stats}</div>` : '';
    return `
      <div class="message ${roleClass}">
        <div class="message-label">${label}</div>
        <div class="message-bubble">${bubbleContent}</div>
        ${statsHtml}
      </div>
    `;
  }).join('');

  ipcRenderer.send('save-pdf', { title: session.title, htmlContent });
};

// Helper escape HTML untuk user message di ekspor PDF
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Listener balasan IPC untuk Ekspor
ipcRenderer.on('save-txt-success', (event, filePath) => {
  showNotification('Ekspor Berhasil', `Percakapan berhasil diekspor ke TXT di:\n${filePath}`);
});
ipcRenderer.on('save-txt-error', (event, errorMsg) => {
  alert(`Gagal mengekspor TXT: ${errorMsg}`);
});
ipcRenderer.on('save-pdf-success', (event, filePath) => {
  showNotification('Ekspor Berhasil', `Percakapan berhasil diekspor ke PDF di:\n${filePath}`);
});
ipcRenderer.on('save-pdf-error', (event, errorMsg) => {
  alert(`Gagal mengekspor PDF: ${errorMsg}`);
});

// Helper Windows Notification
function showNotification(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        new Notification(title, { body });
      }
    });
  }
}

// ===== HAPUS CHAT ACTION =====
btnDeleteChat.onclick = () => {
  if (!currentSessionId) return;

  showConfirmModal('Apakah Anda yakin ingin menghapus sesi percakapan ini?', () => {
    abortOngoingGeneration();

    chatSessions = chatSessions.filter(s => s.id !== currentSessionId);
    saveSessionsToStorage();

    if (chatSessions.length > 0) {
      switchSession(chatSessions[0].id);
    } else {
      currentSessionId = null;
      renderHistory();
      showWelcome();
    }
  });
};

// Sync checkbox auto start berdasarkan state OS
ipcRenderer.on('auto-start-status', (event, enabled) => {
  chkAutoStart.checked = enabled;
});

// ===== JARVIS SYSTEM INTEGRATION =====

// HUD State Controller
function setHudState(state, text = null) {
  if (!jarvisHudContainer) return;
  
  jarvisHudContainer.classList.remove('listening', 'thinking', 'speaking');
  
  if (state === 'listening') {
    jarvisHudContainer.classList.add('listening');
    hudStatus.textContent = 'MENDENGAR';
  } else if (state === 'thinking') {
    jarvisHudContainer.classList.add('thinking');
    hudStatus.textContent = 'BERPIKIR';
  } else if (state === 'speaking') {
    jarvisHudContainer.classList.add('speaking');
    hudStatus.textContent = 'BERBICARA';
  } else {
    hudStatus.textContent = 'STANDBY';
  }

  if (text) {
    hudTranscript.textContent = text;
  }
}

// Text-to-Speech (TTS)
function speakText(text) {
  if (!isVoiceOutputEnabled) return;
  
  window.speechSynthesis.cancel(); // Hentikan ucapan yang sedang berjalan
  
  // Bersihkan tag HTML, markdown, dan bracket eksekusi
  let cleanText = text.replace(/<\/?[^>]+(>|$)/g, ""); 
  cleanText = cleanText.replace(/[*_`#~-]/g, ""); 
  cleanText = cleanText.replace(/\[EXECUTE: [^\]]+\]/g, "");
  cleanText = cleanText.replace(/\[[^\]]*\]/g, ""); // Bersihkan bracket sisa lainnya
  cleanText = cleanText.trim();

  if (!cleanText) return;

  const utterance = new SpeechSynthesisUtterance(cleanText);
  
  const voices = window.speechSynthesis.getVoices();
  let targetVoice = null;
  
  if (settings.ttsVoice) {
    targetVoice = voices.find(v => v.name === settings.ttsVoice);
  }
  
  if (!targetVoice) {
    // Deteksi suara Bahasa Indonesia wanita terpasang (Risma, Gisella, dll)
    targetVoice = voices.find(v => (v.lang.startsWith('id') || v.name.toLowerCase().includes('indonesia')) && 
                                       (v.name.toLowerCase().includes('risma') || 
                                        v.name.toLowerCase().includes('gisella') || 
                                        v.name.toLowerCase().includes('gita') ||
                                        v.name.toLowerCase().includes('female')));
  }
  if (!targetVoice) {
    targetVoice = voices.find(v => v.lang.startsWith('id') || v.name.toLowerCase().includes('indonesia'));
  }
  // Fallback ke suara perempuan bahasa Inggris/global jika tidak ada suara Indonesia sama sekali
  if (!targetVoice) {
    targetVoice = voices.find(v => v.name.toLowerCase().includes('zira') || 
                                   v.name.toLowerCase().includes('female') || 
                                   v.name.toLowerCase().includes('hazel') || 
                                   v.name.toLowerCase().includes('elena') ||
                                   v.name.toLowerCase().includes('heera'));
  }
  if (targetVoice) {
    utterance.voice = targetVoice;
  }
  
  // Set pitch yang optimal
  utterance.rate = 1.05;
  if (targetVoice && (targetVoice.name.toLowerCase().includes('david') || targetVoice.name.toLowerCase().includes('mark') || targetVoice.name.toLowerCase().includes('andika'))) {
    utterance.pitch = 1.35; // Naikkan pitch secara signifikan jika terpaksa menggunakan suara laki-laki bawaan
  } else {
    utterance.pitch = 1.15; // Pitch natural yang manis untuk suara perempuan bawaan
  }

  utterance.onstart = () => {
    setHudState('speaking', cleanText.length > 80 ? cleanText.substring(0, 80) + '...' : cleanText);
  };
  
  utterance.onend = () => {
    setHudState('standby', 'Nadia siap, Tuan.');
  };
  
  utterance.onerror = (e) => {
    console.error('SpeechSynthesis error:', e);
    setHudState('standby', 'Nadia siap, Tuan.');
  };
  
  window.speechSynthesis.speak(utterance);
}

// Suara terpasang dinamis reload
window.speechSynthesis.onvoiceschanged = () => {
  const voices = window.speechSynthesis.getVoices();
  const voiceNames = voices.map(v => `${v.name} (${v.lang})`);
  ipcRenderer.send('log-voices', voiceNames);
};

// Speech-to-Text (STT) webkitSpeechRecognition
let speechRecognition = null;
let isRecording = false;

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  speechRecognition = new SpeechRecognition();
  speechRecognition.continuous = false;
  speechRecognition.interimResults = false;
  speechRecognition.lang = 'id-ID';
  
  speechRecognition.onstart = () => {
    isRecording = true;
    btnVoiceInput.classList.add('recording');
    setHudState('listening', 'Mendengarkan instruksi Tuan...');
  };
  
  speechRecognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    userInput.value = transcript;
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 150) + 'px';
    
    setHudState('standby', `Ucapan terdeteksi: "${transcript}"`);
    
    if (isJarvisMode) {
      sendMessage();
    }
  };
  
  speechRecognition.onerror = (e) => {
    console.error('Speech recognition error:', e.error);
    isRecording = false;
    btnVoiceInput.classList.remove('recording');
    setHudState('standby', `Mic error: ${e.error}. Silakan mengetik, Tuan.`);
  };
  
  speechRecognition.onend = () => {
    isRecording = false;
    btnVoiceInput.classList.remove('recording');
  };
} else {
  btnVoiceInput.style.display = 'none';
  console.warn('Speech recognition tidak didukung di sistem ini.');
}

// Event bindings untuk tombol Voice Input & Voice Output
btnVoiceInput.onclick = () => {
  if (!speechRecognition) return;
  
  if (isRecording) {
    speechRecognition.stop();
  } else {
    window.speechSynthesis.cancel();
    speechRecognition.start();
  }
};

btnVoiceOutput.onclick = () => {
  isVoiceOutputEnabled = !isVoiceOutputEnabled;
  btnVoiceOutput.classList.toggle('active', isVoiceOutputEnabled);
  
  const iconUnmuted = btnVoiceOutput.querySelector('.icon-unmuted');
  const iconMuted = btnVoiceOutput.querySelector('.icon-muted');
  
  if (isVoiceOutputEnabled) {
    iconUnmuted.style.display = 'block';
    iconMuted.style.display = 'none';
    btnVoiceOutput.title = 'Suara Respons: Aktif';
    speakText('Respons suara diaktifkan, Tuan.');
  } else {
    iconUnmuted.style.display = 'none';
    iconMuted.style.display = 'block';
    btnVoiceOutput.title = 'Suara Respons: Senyap';
    window.speechSynthesis.cancel();
  }
};

// JARVIS Mode Toggle
btnJarvisToggle.onclick = () => {
  isJarvisMode = !isJarvisMode;
  btnJarvisToggle.classList.toggle('active', isJarvisMode);
  
  if (isJarvisMode) {
    welcomeScreen.style.display = 'none';
    messagesEl.classList.remove('visible');
    chatHeader.style.display = 'none';
    
    jarvisHudContainer.style.display = 'flex';
    setHudState('standby', 'Nadia siap membantu Tuan.');
    
    speakText('Nadia aktif secara lokal. Siap membantu Tuan.');
  } else {
    jarvisHudContainer.style.display = 'none';
    window.speechSynthesis.cancel();
    
    const session = getCurrentSession();
    if (session && session.messages.length > 0) {
      hideWelcome();
      messagesEl.classList.add('visible');
      chatHeader.style.display = 'flex';
    } else {
      showWelcome();
    }
  }
};

// Perintah Otomatisasi Sistem (Automation)
function handleJarvisAutomation(text) {
  if (text.includes('[EXECUTE: notepad]')) {
    exec('notepad', (err) => {
      if (err) speakText('Gagal membuka notepad, Tuan.');
    });
    speakText('Melaksanakan, membuka notepad.');
    appendSystemInfoMessage('🖥️ Membuka Notepad...');
  } else if (text.includes('[EXECUTE: calc]')) {
    exec('calc', (err) => {
      if (err) speakText('Gagal membuka kalkulator, Tuan.');
    });
    speakText('Melaksanakan, membuka kalkulator.');
    appendSystemInfoMessage('🖥️ Membuka Kalkulator...');
  } else if (text.includes('[EXECUTE: browser]')) {
    const { shell } = require('electron');
    shell.openExternal('https://www.google.com');
    speakText('Melaksanakan, membuka mesin pencari Google.');
    appendSystemInfoMessage('🌐 Membuka Google Search di Browser...');
  } else if (text.includes('[EXECUTE: system_info]')) {
    const totalMem = (os.totalmem() / (1024 ** 3)).toFixed(1);
    const freeMem = (os.freemem() / (1024 ** 3)).toFixed(1);
    const usedMem = (totalMem - freeMem).toFixed(1);
    const cpuCores = os.cpus().length;
    const cpuModel = os.cpus()[0].model.trim();
    const platform = os.platform() === 'win32' ? 'Windows' : os.platform();
    
    const infoText = `Status sistem saat ini: Berjalan di ${platform}. CPU memiliki ${cpuCores} core dengan tipe ${cpuModel}. Penggunaan RAM adalah ${usedMem} Gigabyte dari total ${totalMem} Gigabyte. Semua sistem berjalan nominal, Tuan.`;
    
    if (isJarvisMode) {
      setHudState('speaking', 'Menampilkan status sistem hardware...');
    }
    
    setTimeout(() => {
      appendSystemInfoMessage(infoText);
      speakText(infoText);
    }, 1000);
  } else {
    // Cek perintah buka folder kustom
    const openFolderMatch = text.match(/\[EXECUTE: open_folder\s+([^\]]+)\]/);
    if (openFolderMatch) {
      const folderPath = openFolderMatch[1].trim();
      const { shell } = require('electron');
      shell.openPath(folderPath).then((err) => {
        if (err) {
          speakText('Gagal membuka folder, Tuan.');
          appendSystemInfoMessage(`❌ Gagal membuka folder: ${err}\nPath: \`${folderPath}\``);
        } else {
          speakText('Melaksanakan, membuka folder.');
          appendSystemInfoMessage(`📂 Membuka folder:\n\`${folderPath}\``);
        }
      }).catch(err => {
        speakText('Terjadi kesalahan saat membuka folder.');
        appendSystemInfoMessage(`❌ Error: ${err.message}`);
      });
    }

    // Cek perintah baca file kustom
    const readFileMatch = text.match(/\[EXECUTE: read_file\s+([^\]]+)\]/);
    if (readFileMatch) {
      const filePath = readFileMatch[1].trim();
      try {
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            speakText('Maaf Tuan, path tersebut adalah folder, bukan file.');
            appendSystemInfoMessage(`⚠️ Path tersebut adalah folder, bukan file:\n\`${filePath}\``);
            return;
          }
          
          // Batasi ukuran file yang dibaca agar tidak merusak konteks (maksimal 100KB)
          const maxSizeBytes = 100 * 1024;
          if (stats.size > maxSizeBytes) {
            speakText('Maaf Tuan, file tersebut terlalu besar untuk dibaca.');
            appendSystemInfoMessage(`⚠️ File terlalu besar (Ukuran: ${(stats.size / 1024).toFixed(1)} KB, Maksimal: 100 KB):\n\`${filePath}\``);
            return;
          }

          const fileContent = fs.readFileSync(filePath, 'utf8');
          speakText('Melaksanakan, membaca isi file.');
          
          appendSystemInfoMessage(`📖 Membaca file:\n\`${filePath}\``);

          // Masukkan konten file ke riwayat percakapan secara tersembunyi/sistem dan panggil Ollama kembali
          const session = getCurrentSession();
          if (session) {
            session.messages.push({
              role: 'user',
              content: `[SYSTEM] Berikut adalah isi dari file "${filePath}" yang baru saja berhasil dibaca secara lokal:\n\n\`\`\`\n${fileContent}\n\`\`\`\n\nSilakan jawab atau analisis isi file tersebut untuk Tuan Anhar.`
            });
            saveSessionsToStorage();
            
            // Picu completion secara otomatis setelah jeda singkat
            setTimeout(() => {
              generateAIResponseForSession(session, currentSessionId);
            }, 800);
          }
        } else {
          speakText('Gagal membaca file, file tidak ditemukan.');
          appendSystemInfoMessage(`❌ File tidak ditemukan:\n\`${filePath}\``);
        }
      } catch (err) {
        speakText('Gagal membaca file, terjadi kesalahan.');
        appendSystemInfoMessage(`❌ Gagal membaca file: ${err.message}\nPath: \`${filePath}\``);
      }
    }
  }
}

function appendSystemInfoMessage(content) {
  const session = getCurrentSession();
  if (!session) return;
  
  const aiMsg = { role: 'assistant', content: content, stats: 'Lokal OS command' };
  session.messages.push(aiMsg);
  saveSessionsToStorage();
  
  if (isJarvisMode) {
    setHudState('speaking', content);
  } else {
    appendMessageToDOM('ai', content, true, 'Lokal OS command');
  }
}

// ===== INIT =====
loadSettings();
loadSessionsFromStorage();

if (chatSessions.length > 0) {
  currentSessionId = chatSessions[0].id;
  renderHistory();
  renderMessages(chatSessions[0].messages);
} else {
  showWelcome();
}

