
(() => {
  'use strict';

  const CONFIG_KEY = 'registoTrabalho.googleSync.v1';
  const DATA_KEY = 'registoTrabalho.v1';
  const CLIENT_ID = '946972289048-jetqcrnhl8uvpis9gqu4mp251nod5qc4.apps.googleusercontent.com';
  const API_KEY = 'AIzaSyD_VEzrc9XpSb7VDa7pKR1f-1jQSAXcpCE';
  const PROJECT_NUMBER = '946972289048';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';

  let accessToken = null;
  let tokenExpiresAt = 0;
  let tokenClient = null;
  let syncing = false;
  let timer = null;

  const config = loadConfig();

  function loadConfig() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveConfig() {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  function status(message) {
    const el = document.getElementById('googleSyncStatus');
    if (el) el.textContent = message;
  }

  function buttonState(disabled) {
    const btn = document.getElementById('googleSyncButton');
    if (btn) btn.disabled = disabled;
  }

  function addPanel() {
    const view = document.getElementById('view-relatorios');
    if (!view || document.getElementById('googleSyncPanel')) return;

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.id = 'googleSyncPanel';
    panel.innerHTML = `
      <h3>Sincronização Google Sheets</h3>
      <p class="hint">
        Envia os registos deste telemóvel para uma folha Google.
        Os registos continuam guardados localmente.
      </p>
      <p id="googleSyncFile" class="hint"></p>
      <p id="googleSyncStatus" class="hint">Ainda não ligado ao Google Sheets.</p>
      <button type="button" class="primary" id="googleSyncButton">
        Ligar / sincronizar
      </button>
      <p class="hint">
        A folha «Registos» é gerida pela aplicação. Em cada sincronização,
        o seu conteúdo é substituído pelos registos existentes neste telemóvel.
        As outras separadores da folha não são usados pela aplicação.
      </p>
    `;

    view.appendChild(panel);
    document.getElementById('googleSyncButton').addEventListener('click', connectAndSync);
    updatePanel();
  }

  function updatePanel() {
    const file = document.getElementById('googleSyncFile');
    if (file) {
      file.textContent = config.spreadsheetId
        ? 'Folha selecionada: ' + (config.spreadsheetName || 'Google Sheets')
        : 'Ainda não selecionaste uma folha Google.';
    }

    if (config.spreadsheetId) {
      status('Folha ligada. Carrega no botão para autorizar e sincronizar.');
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(s => s.src === src);
      if (existing) {
        if (existing.dataset.loaded === 'yes') return resolve();
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        script.dataset.loaded = 'yes';
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function loadGoogleLibraries() {
    await loadScript('https://accounts.google.com/gsi/client');
    await loadScript('https://apis.google.com/js/api.js');

    await new Promise((resolve, reject) => {
      if (window.gapi?.load) {
        window.gapi.load('picker', { callback: resolve });
      } else {
        reject(new Error('Não foi possível carregar o Google Picker.'));
      }
    });

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: () => {}
    });
  }

  function requestToken() {
    return new Promise((resolve, reject) => {
      if (!tokenClient) {
        reject(new Error('A ligação ao Google ainda não está pronta.'));
        return;
      }

      tokenClient.callback = response => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }

        accessToken = response.access_token;
        tokenExpiresAt = Date.now() + (Number(response.expires_in || 3600) * 1000);
        resolve(accessToken);
      };

      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  function openPicker() {
    return new Promise((resolve, reject) => {
      if (!window.google?.picker) {
        reject(new Error('O seletor de folhas Google não está disponível.'));
        return;
      }

      const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
        .setIncludeFolders(false)
        .setSelectFolderEnabled(false);

      const picker = new google.picker.PickerBuilder()
        .setAppId(PROJECT_NUMBER)
        .setDeveloperKey(API_KEY)
        .setOAuthToken(accessToken)
        .addView(view)
        .setTitle('Escolhe a folha de cálculo')
        .setCallback(data => {
          if (data.action === google.picker.Action.PICKED && data.docs?.length) {
            resolve(data.docs[0]);
          } else if (data.action === google.picker.Action.CANCEL) {
            resolve(null);
          }
        })
        .build();

      picker.setVisible(true);
    });
  }

  async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error('Erro Google (' + response.status + '): ' + detail);
    }

    if (response.status === 204) return {};
    return response.json();
  }

  
  async function ensureRegistosTab(spreadsheetId) {
    if (!spreadsheetId) {
      throw new Error('Ainda não selecionaste uma folha Google.');
    }
  }


  function getRows() {
    let db;
    try {
      db = JSON.parse(localStorage.getItem(DATA_KEY)) || {};
    } catch {
      db = {};
    }

    const entries = Array.isArray(db.entries) ? db.entries : [];

    const rows = [[
      'ID do registo',
      'Data',
      'Obra / local',
      'Entrada',
      'Saída',
      'Pausa (min)',
      'Total de horas',
      'Colegas',
      'Observações'
    ]];

    entries
      .slice()
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
      .forEach(e => {
        let start = 0;
        let end = 0;

        if (e.start) {
          const p = e.start.split(':').map(Number);
          start = p[0] * 60 + p[1];
        }
        if (e.end) {
          const p = e.end.split(':').map(Number);
          end = p[0] * 60 + p[1];
        }

        let minutes = end - start;
        if (minutes < 0) minutes += 1440;
        minutes = Math.max(0, minutes - (Number(e.breakMins) || 0));

        const hours = Math.floor(minutes / 60) + 'h' +
          String(minutes % 60).padStart(2, '0');

        rows.push([
          e.id || '',
          e.date || '',
          e.site || '',
          e.start || '',
          e.end || '',
          Number(e.breakMins) || 0,
          hours,
          Array.isArray(e.people) ? e.people.join(', ') : '',
          e.notes || ''
        ]);
      });

    return rows;
  }

  async function writeSheet() {
    const id = config.spreadsheetId;
    if (!id) throw new Error('Ainda não selecionaste uma folha Google.');

    await ensureRegistosTab(id);

    const clearUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' +
      encodeURIComponent(id) +
      '/values/' + encodeURIComponent('Registos!A:I') + ':clear';

    await apiRequest(clearUrl, {
      method: 'POST',
      body: JSON.stringify({})
    });

    const rows = getRows();
    const range = 'Registos!A1:I' + rows.length;
    const updateUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' +
      encodeURIComponent(id) +
      '/values/' + encodeURIComponent(range) +
      '?valueInputOption=RAW';

    await apiRequest(updateUrl, {
      method: 'PUT',
      body: JSON.stringify({
        majorDimension: 'ROWS',
        values: rows
      })
    });

    return rows.length - 1;
  }

  async function connectAndSync() {
    if (syncing) return;

    syncing = true;
    buttonState(true);
    status('A preparar ligação ao Google…');

    try {
      await loadGoogleLibraries();
      await requestToken();

      if (!config.spreadsheetId) {
        status('Escolhe a folha Google onde queres guardar os registos.');
        const doc = await openPicker();

        if (!doc) {
          status('Seleção cancelada. Não foi feita nenhuma alteração.');
          return;
        }

        config.spreadsheetId = doc.id;
        config.spreadsheetName = doc.name || 'Google Sheets';
        saveConfig();
        updatePanel();
      }

      status('A sincronizar os registos…');
      const count = await writeSheet();
      status('Sincronização concluída. ' + count + ' registos enviados.');
    } catch (error) {
      console.error(error);
      status('Não foi possível sincronizar: ' + error.message);
    } finally {
      syncing = false;
      buttonState(false);
    }
  }

  function scheduleSync() {
    if (!config.spreadsheetId) return;

    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!navigator.onLine) {
        status('Sem internet. Os registos continuam guardados no telemóvel.');
        return;
      }

      if (!accessToken || Date.now() >= tokenExpiresAt - 60000) {
        status('Registo guardado no telemóvel. Carrega em «Ligar / sincronizar» para atualizar a folha.');
        return;
      }

      if (syncing) return;

      syncing = true;
      try {
        status('A atualizar a folha Google…');
        const count = await writeSheet();
        status('Sincronização concluída. ' + count + ' registos enviados.');
      } catch (error) {
        console.error(error);
        status('Registo guardado localmente. Sincronização pendente: ' + error.message);
      } finally {
        syncing = false;
      }
    }, 1200);
  }

  // Deteta as gravações feitas pela aplicação sem alterar os seus dados locais.
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    originalSetItem.call(this, key, value);
    if (key === DATA_KEY) scheduleSync();
  };

  window.addEventListener('online', () => {
    if (config.spreadsheetId) {
      status('Internet disponível. Carrega em «Ligar / sincronizar» para confirmar a atualização.');
    }
  });

  window.addEventListener('offline', () => {
    if (config.spreadsheetId) {
      status('Sem internet. Os registos continuam guardados no telemóvel.');
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addPanel);
  } else {
    addPanel();
  }
})();
