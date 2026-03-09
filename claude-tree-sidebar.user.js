// ==UserScript==
// @name         Claude Tree Sidebar v6.4 (Smart AI Summary)
// @namespace    http://tampermonkey.net/
// @version      6.4
// @description  Tree sidebar + Smart AI Summary (Groq/OpenRouter free API) + Sessions + Auto-save
// @author       chokopockos
// @match        https://arena.ai/*
// @match        https://lmarena.ai/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// @homepageURL  https://github.com/chokopockos/arena-sidebar
// @updateURL    https://raw.githubusercontent.com/chokopockos/arena-sidebar/main/claude-tree-sidebar.user.js
// @downloadURL  https://raw.githubusercontent.com/chokopockos/arena-sidebar/main/claude-tree-sidebar.user.js
// @supportURL   https://github.com/chokopockos/arena-sidebar/issues
// @icon         https://arena.ai/favicon.ico
// ==/UserScript==

(function () {
  "use strict";

  const CFG = {
    sidebarWidth: 340,
    updateInterval: 2500,
    charWarnOrange: 15000,
    charWarnRed: 16000,
    maxPreview: 70,
    hotkey: "KeyB",
    minSidebarWidth: 240,
    maxSidebarWidth: 600,
    sessionStoragePrefix: "ct_session_",
    sessionListKey: "ct_sessions_list",
    autosaveDebounce: 3000,
    aiConfigKey: "ct_ai_config",
  };

  const h = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const cut = (s, n) => { s = String(s ?? "").trim().replace(/\s+/g, " "); return s.length > n ? s.slice(0, n) + "…" : s; };
  const copyTxt = (t) => navigator.clipboard.writeText(t).catch(() => { const a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select(); document.execCommand("copy"); document.body.removeChild(a); });
  const flashEl = (el) => {
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const prev = el.style.cssText;
    el.style.outline = "2px solid #007acc";
    el.style.outlineOffset = "3px";
    el.style.transition = "outline-color .3s";
    setTimeout(() => { el.style.outlineColor = "transparent"; setTimeout(() => (el.style.cssText = prev), 400); }, 1800);
  };

  function getChatKey() { const m = location.pathname.match(/\/c\/([^\/]+)/); return m ? `ct_open_${m[1]}` : "ct_open_global"; }
  function loadOpenSet() { try { const r = localStorage.getItem(getChatKey()); const a = r ? JSON.parse(r) : []; return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); } }
  function saveOpenSet(s) { try { localStorage.setItem(getChatKey(), JSON.stringify([...s])); } catch {} }
  function loadSidebarW() { try { return parseInt(localStorage.getItem("ct_sidebar_w")) || CFG.sidebarWidth; } catch { return CFG.sidebarWidth; } }
  function saveSidebarW(w) { try { localStorage.setItem("ct_sidebar_w", String(w)); } catch {} }

  /* ═══════════════════════════════════════════
     SESSION MANAGER
     ═══════════════════════════════════════════ */
  class SessionManager {
    constructor() { this.listKey = CFG.sessionListKey; this.prefix = CFG.sessionStoragePrefix; }
    _genId() { return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }
    listSessions() { try { const r = localStorage.getItem(this.listKey); return r ? JSON.parse(r) : []; } catch { return []; } }
    _saveList(list) { try { localStorage.setItem(this.listKey, JSON.stringify(list)); } catch {} }

    saveSession(messages, name = '') {
      const id = this._genId(); const now = new Date();
      const session = {
        id, name: name || `Чат ${now.toLocaleDateString('ru-RU')} ${now.toLocaleTimeString('ru-RU').slice(0, 5)}`,
        created: now.toISOString(), updated: now.toISOString(), url: location.href,
        messageCount: messages.length,
        totalChars: messages.reduce((s, m) => s + (m.text || '').length, 0),
        summary: '',
        messages: messages.map(m => ({
          id: m.id, role: m.role, model: m.model || '', title: m.title || '', text: m.text || '',
          kids: (m.kids || []).map(k => ({ type: k.type, icon: k.icon, label: k.label, full: k.full, lang: k.lang || '' })),
        })),
      };
      try { localStorage.setItem(this.prefix + id, JSON.stringify(session)); }
      catch { this._cleanOldest(3); try { localStorage.setItem(this.prefix + id, JSON.stringify(session)); } catch { return null; } }
      const list = this.listSessions();
      list.push({ id, name: session.name, created: session.created, messageCount: session.messageCount, totalChars: session.totalChars, hasSummary: false });
      this._saveList(list); return id;
    }

    loadSession(id) { try { const r = localStorage.getItem(this.prefix + id); return r ? JSON.parse(r) : null; } catch { return null; } }

    saveSummary(id, summary) {
      const s = this.loadSession(id); if (!s) return;
      s.summary = summary; s.updated = new Date().toISOString();
      try { localStorage.setItem(this.prefix + id, JSON.stringify(s)); } catch {}
      const list = this.listSessions(); const item = list.find(x => x.id === id);
      if (item) { item.hasSummary = true; this._saveList(list); }
    }

    deleteSession(id) {
      try { localStorage.removeItem(this.prefix + id); } catch {}
      this._saveList(this.listSessions().filter(s => s.id !== id));
    }

    exportSession(id) {
      const s = this.loadSession(id); if (!s) return;
      const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `chat_${s.name.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')}.json`;
      a.click(); URL.revokeObjectURL(url);
    }

    exportSessionMarkdown(id) {
      const s = this.loadSession(id); if (!s) return;
      let md = `# ${s.name}\n\n> ${new Date(s.created).toLocaleString('ru-RU')} | ${s.messageCount} сообщ.\n\n`;
      if (s.summary) md += `## Summary\n\n${s.summary}\n\n---\n\n`;
      md += `## Диалог\n\n`;
      s.messages.forEach(m => {
        md += `### ${m.role === 'user' ? '👤' : '🤖'}${m.model ? ` (${m.model})` : ''} #${m.id}\n\n${m.text}\n\n---\n\n`;
      });
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `chat_${s.name.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')}.md`;
      a.click(); URL.revokeObjectURL(url);
    }

    importSession(jsonStr) {
      try {
        const s = JSON.parse(jsonStr); if (!s.messages) throw 0;
        const newId = this._genId(); s.id = newId;
        s.name = (s.name || 'Imported') + ' (imp)';
        localStorage.setItem(this.prefix + newId, JSON.stringify(s));
        const list = this.listSessions();
        list.push({ id: newId, name: s.name, created: s.created, messageCount: s.messages.length, totalChars: s.totalChars || 0, hasSummary: !!s.summary });
        this._saveList(list); return newId;
      } catch { return null; }
    }

    _cleanOldest(count) {
      const list = this.listSessions().sort((a, b) => new Date(a.created) - new Date(b.created));
      for (let i = 0; i < Math.min(count, list.length); i++) { try { localStorage.removeItem(this.prefix + list[i].id); } catch {} }
      this._saveList(list.slice(count));
    }

    getStorageStats() {
      let ts = 0, sc = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(this.prefix)) { ts += (localStorage.getItem(k) || '').length * 2; sc++; }
      }
      return { sessions: sc, sizeKB: Math.round(ts / 1024) };
    }
  }

  /* ═══════════════════════════════════════════
     AI PROVIDERS
     ═══════════════════════════════════════════ */
  const AI_PROVIDERS = {
    groq: {
      name: 'Groq (бесплатно)',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      models: [
        { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B (быстрая)' },
        { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (умная)' },
        { id: 'gemma2-9b-it', name: 'Gemma 2 9B' },
        { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
      ],
      defaultModel: 'llama-3.1-8b-instant',
      keyUrl: 'https://console.groq.com/keys',
      keyHint: 'Бесплатно. console.groq.com → API Keys → Create',
    },
    openrouter: {
      name: 'OpenRouter',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      models: [
        { id: 'meta-llama/llama-3.1-8b-instruct:free', name: 'Llama 3.1 8B (free)' },
        { id: 'google/gemma-2-9b-it:free', name: 'Gemma 2 9B (free)' },
        { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B (free)' },
      ],
      defaultModel: 'meta-llama/llama-3.1-8b-instruct:free',
      keyUrl: 'https://openrouter.ai/keys',
      keyHint: 'Есть бесплатные модели. openrouter.ai → Keys',
    },
    together: {
      name: 'Together AI',
      url: 'https://api.together.xyz/v1/chat/completions',
      models: [
        { id: 'meta-llama/Llama-3.2-3B-Instruct-Turbo', name: 'Llama 3.2 3B (быстрая)' },
        { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', name: 'Llama 3.1 8B' },
      ],
      defaultModel: 'meta-llama/Llama-3.2-3B-Instruct-Turbo',
      keyUrl: 'https://api.together.xyz/settings/api-keys',
      keyHint: '$5 бесплатных при регистрации',
    },
    custom: {
      name: 'Свой API (OpenAI-совместимый)',
      url: '',
      models: [{ id: 'custom', name: 'Custom Model' }],
      defaultModel: 'custom',
      keyUrl: '',
      keyHint: 'LM Studio, Ollama, любой OpenAI-compatible API',
    }
  };

  /* ═══════════════════════════════════════════
     AI SUMMARY ENGINE
     ═══════════════════════════════════════════ */
  class AISummaryEngine {
    constructor() { this.config = this._loadConfig(); }

    _loadConfig() {
      try { const r = localStorage.getItem(CFG.aiConfigKey); if (r) return JSON.parse(r); }
      catch {} return { provider: 'groq', apiKey: '', model: '', customUrl: '' };
    }

    _saveConfig(config) {
      this.config = config;
      try { localStorage.setItem(CFG.aiConfigKey, JSON.stringify(config)); } catch {}
    }

    getConfig() { return { ...this.config }; }

    setConfig(provider, apiKey, model, customUrl) {
      this._saveConfig({ provider, apiKey, model: model || '', customUrl: customUrl || '' });
    }

    isConfigured() { return !!this.config.apiKey && !!this.config.provider; }

    getProviderInfo() { return AI_PROVIDERS[this.config.provider] || AI_PROVIDERS.groq; }
    getModel() { const p = this.getProviderInfo(); return this.config.model || p.defaultModel; }
    getApiUrl() {
      if (this.config.provider === 'custom' && this.config.customUrl) return this.config.customUrl;
      return this.getProviderInfo().url;
    }

    preparePrompt(messages) {
      const maxPerMsg = Math.min(800, Math.floor(6000 / Math.max(messages.length, 1)));
      let text = '';
      messages.forEach((m, i) => {
        const role = m.role === 'user' ? 'USER' : 'ASSISTANT';
        let content = (m.text || '').slice(0, maxPerMsg);
        if ((m.text || '').length > maxPerMsg) content += '...';
        text += `[${role} #${i + 1}]: ${content}\n\n`;
      });
      return text;
    }

    async generateSummary(messages) {
      if (!this.isConfigured()) throw new Error('API не настроен. Введи ключ в настройках.');

      const chatText = this.preparePrompt(messages);
      const url = this.getApiUrl();

      const systemPrompt = `You are a helpful assistant. Create a structured summary of the following chat conversation.

IMPORTANT RULES:
- Respond ONLY in Russian language
- Use markdown formatting
- Be concise but comprehensive

Structure your response EXACTLY like this:

## 🎯 Главная тема
(1-2 предложения о чём весь разговор)

## 📋 Ключевые вопросы пользователя
(пронумерованный список основных вопросов/запросов)

## ✅ Что было решено
(bullet-points с решениями и ответами)

## 💻 Технические детали
(если есть код, технологии, инструменты — перечислить)

## ❓ Открытые вопросы
(что осталось нерешённым, если есть)

## 📌 Итог
(2-3 предложения — краткий вывод всего разговора)`;

      const body = {
        model: this.getModel(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Вот разговор для суммаризации:\n\n${chatText}` }
        ],
        temperature: 0.3,
        max_tokens: 1500,
      };

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      };
      if (this.config.provider === 'openrouter') {
        headers['HTTP-Referer'] = location.origin;
        headers['X-Title'] = 'Chat Tree Sidebar';
      }

      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        let errMsg = `API ошибка ${response.status}`;
        try { const ej = JSON.parse(errText); errMsg = ej.error?.message || ej.message || errMsg; } catch {}
        if (response.status === 401) errMsg = 'Неверный API ключ';
        if (response.status === 429) errMsg = 'Лимит запросов, подожди';
        throw new Error(errMsg);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Пустой ответ от API');
      return content;
    }
  }

  /* ═══════════════════════════════════════════
     LOCAL SUMMARY GENERATOR
     ═══════════════════════════════════════════ */
  class SummaryGenerator {
    generateLocalSummary(messages) {
      if (!messages.length) return 'Пустой чат.';
      const uM = messages.filter(m => m.role === 'user'), aM = messages.filter(m => m.role === 'assistant');
      let s = `📊 Статистика чата\n`;
      s += `• Всего сообщений: ${messages.length}\n• От пользователя: ${uM.length}\n• От ассистента: ${aM.length}\n`;
      const tc = messages.reduce((a, m) => a + (m.text || '').length, 0);
      const tl = messages.reduce((a, m) => a + (m.text || '').split('\n').filter(l => l.trim()).length, 0);
      s += `• Символов: ${tc.toLocaleString('ru-RU')}\n• Строк: ${tl.toLocaleString('ru-RU')}\n`;
      const models = [...new Set(aM.map(m => m.model).filter(Boolean))];
      if (models.length) s += `• Модели: ${models.join(', ')}\n`;

      s += `\n📝 Темы:\n`;
      const hd = new Set();
      aM.forEach(m => { (m.kids || []).forEach(k => { if (['h1', 'h2', 'h3'].includes(k.type)) hd.add(k.full || k.label); }); });
      if (hd.size) [...hd].slice(0, 15).forEach(x => { s += `  • ${x}\n`; });
      else s += `  (заголовков не найдено)\n`;

      s += `\n🗣 Запросы пользователя:\n`;
      uM.forEach((m, i) => { s += `  ${i + 1}. ${cut(m.text || m.title || '', 120)}\n`; });

      const cb = [];
      aM.forEach(m => { (m.kids || []).forEach(k => { if (k.type === 'code') cb.push(k.lang || 'unknown'); }); });
      if (cb.length) {
        s += `\n💻 Код (${cb.length}):\n`;
        const lc = {}; cb.forEach(l => { lc[l] = (lc[l] || 0) + 1; });
        Object.entries(lc).forEach(([l, c]) => { s += `  • ${l}: ${c}\n`; });
      }

      s += `\n⏱ Хронология:\n`;
      messages.forEach((m, i) => { s += `  ${m.role === 'user' ? '👤' : '🤖'} #${i + 1}: ${cut(m.title || m.text || '', 60)}\n`; });
      return s;
    }

    generateCompactSummary(messages) {
      if (!messages.length) return '';
      const uM = messages.filter(m => m.role === 'user'), aM = messages.filter(m => m.role === 'assistant');
      let c = `[CONTEXT FROM PREVIOUS CHAT]\nMessages: ${messages.length} (${uM.length} user, ${aM.length} assistant)\n`;
      const models = [...new Set(aM.map(m => m.model).filter(Boolean))];
      if (models.length) c += `Models: ${models.join(', ')}\n`;
      c += `\nUser asked about:\n`;
      uM.forEach((m, i) => { c += `${i + 1}. ${cut(m.text || '', 150)}\n`; });
      const hd = [];
      aM.forEach(m => { (m.kids || []).forEach(k => { if (['h1', 'h2', 'h3'].includes(k.type)) hd.push(k.full || k.label); }); });
      if (hd.length) { c += `\nKey topics:\n`; [...new Set(hd)].slice(0, 10).forEach(x => { c += `- ${x}\n`; }); }
      c += `[END CONTEXT]\n`;
      return c;
    }
  }

  /* ═══════════════════════════════════════════
     CSS
     ═══════════════════════════════════════════ */
  function injectCSS() {
    let el = document.getElementById("ct-styles"); if (el) el.remove();
    const css = document.createElement("style"); css.id = "ct-styles";
    css.textContent = `
#ct-toggle-btn{position:fixed!important;top:50%!important;right:0!important;transform:translateY(-50%)!important;z-index:2147483647!important;width:22px!important;height:56px!important;background:#1e1e1e!important;border:1px solid #555!important;border-right:none!important;border-radius:6px 0 0 6px!important;color:#ddd!important;cursor:pointer!important;display:flex!important;align-items:center!important;justify-content:center!important;font:12px monospace!important;box-shadow:-2px 0 8px rgba(0,0,0,.5)!important;transition:right .25s ease,width .15s!important;}
#ct-toggle-btn:hover{width:28px!important;background:#2d2d2d!important;}
#ct-toggle-btn.ct-shifted{right:var(--ct-w)!important;}
#ct-sidebar-panel{position:fixed!important;top:0!important;right:0!important;width:var(--ct-w)!important;height:100vh!important;background:#1e1e1e!important;border-left:1px solid #444!important;z-index:2147483646!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;font-family:Consolas,Monaco,'Courier New',monospace!important;font-size:12px!important;color:#ccc!important;transform:translateX(100%)!important;transition:transform .25s ease!important;box-shadow:-4px 0 20px rgba(0,0,0,.6)!important;}
#ct-sidebar-panel.ct-visible{transform:translateX(0)!important;}
#ct-resize-handle{position:absolute!important;left:-3px!important;top:0!important;width:6px!important;height:100%!important;cursor:col-resize!important;z-index:10!important;background:transparent!important;}
#ct-resize-handle:hover,#ct-resize-handle.active{background:rgba(0,122,204,.4)!important;}
.ct-hdr{padding:8px 10px!important;background:#252526!important;border-bottom:1px solid #333!important;display:flex!important;align-items:center!important;justify-content:space-between!important;flex-shrink:0!important;}
.ct-hdr-title{font-size:11px!important;letter-spacing:1px!important;text-transform:uppercase!important;color:#888!important;font-weight:600!important;}
.ct-hdr-actions{display:flex!important;gap:4px!important;}
.ct-hdr-btn{background:none!important;border:1px solid #444!important;color:#aaa!important;cursor:pointer!important;border-radius:4px!important;padding:2px 7px!important;font:11px inherit!important;}
.ct-hdr-btn:hover{background:#333!important;color:#fff!important;}
.ct-search-bar{padding:5px 10px!important;background:#252526!important;border-bottom:1px solid #333!important;flex-shrink:0!important;display:flex!important;gap:6px!important;align-items:center!important;}
#ct-search{flex:1!important;background:#1a1a1a!important;border:1px solid #444!important;border-radius:4px!important;padding:4px 8px!important;color:#ddd!important;font:11px inherit!important;outline:none!important;}
#ct-search:focus{border-color:#007acc!important;}#ct-search::placeholder{color:#555!important;}
.ct-search-count{color:#666!important;font-size:10px!important;white-space:nowrap!important;}
.ct-counter{display:flex!important;align-items:center!important;gap:8px!important;flex-wrap:wrap!important;padding:5px 10px!important;background:#252526!important;border-bottom:1px solid #333!important;flex-shrink:0!important;font-size:11px!important;color:#888!important;}
.ct-dot{width:10px!important;height:10px!important;border-radius:50%!important;background:#4ec9b0!important;}
.ct-dot.orange{background:#ffaa00!important;box-shadow:0 0 6px #ffaa0088!important;}
.ct-dot.red{background:#f44747!important;box-shadow:0 0 8px #f4474788!important;animation:ct-blink 1s infinite!important;}
@keyframes ct-blink{0%,100%{opacity:1}50%{opacity:.4}}
.ct-count-val{color:#ddd!important;font-weight:600!important;}.ct-stat-sep{color:#333!important;}
.ct-autosave-indicator{font-size:9px!important;color:#4ec9b0!important;opacity:0!important;transition:opacity .3s!important;}
.ct-autosave-indicator.show{opacity:1!important;}
.ct-tabs{display:flex!important;background:#252526!important;border-bottom:1px solid #333!important;flex-shrink:0!important;}
.ct-tab{flex:1!important;padding:5px 6px!important;text-align:center!important;font-size:11px!important;color:#777!important;cursor:pointer!important;border:none!important;border-bottom:2px solid transparent!important;background:none!important;font-family:inherit!important;}
.ct-tab:hover{color:#bbb!important;background:#2a2a2a!important;}.ct-tab.on{color:#fff!important;border-bottom-color:#007acc!important;}
.ct-scroll{flex:1!important;overflow:auto!important;padding:8px 8px 12px 8px!important;}
.ct-scroll::-webkit-scrollbar{width:5px;}.ct-scroll::-webkit-scrollbar-thumb{background:#444;border-radius:3px;}
.ct-footer{padding:4px 10px!important;background:#252526!important;border-top:1px solid #333!important;display:flex!important;justify-content:space-between!important;align-items:center!important;flex-shrink:0!important;}
.ct-footer-btn{background:none!important;border:none!important;color:#666!important;cursor:pointer!important;font:11px inherit!important;padding:2px 8px!important;border-radius:3px!important;}
.ct-footer-btn:hover{color:#ddd!important;background:#333!important;}
.ct-footer-hint{color:#444!important;font-size:10px!important;}
.ct-node{display:flex!important;flex-direction:column!important;margin:6px 0!important;}.ct-user{align-items:flex-end!important;}.ct-asst{align-items:flex-start!important;}
.ct-node-hdr{display:flex!important;align-items:center!important;gap:6px!important;cursor:pointer!important;padding:5px 8px!important;border-radius:10px!important;max-width:95%!important;width:fit-content!important;border:1px solid #333!important;background:#202020!important;transition:background .12s!important;}
.ct-node-hdr:hover{background:#2a2d2e!important;}.ct-asst .ct-node-hdr{background:#1f1f12!important;border-color:#353525!important;}.ct-user .ct-node-hdr{background:#142231!important;border-color:#24405a!important;}
.ct-chevron{width:14px!important;color:#888!important;font-size:10px!important;display:inline-block!important;transition:transform .15s!important;}.ct-chevron.open{transform:rotate(90deg)!important;}
.ct-icon{width:16px!important;text-align:center!important;}.ct-label{color:#ddd!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;max-width:220px!important;}.ct-num{color:#666!important;font-size:10px!important;margin-left:4px!important;}
.ct-copy-msg{margin-left:auto!important;opacity:0!important;transition:opacity .15s!important;background:none!important;border:none!important;color:#666!important;cursor:pointer!important;font-size:11px!important;padding:1px 4px!important;border-radius:3px!important;}.ct-node-hdr:hover .ct-copy-msg{opacity:1!important;}.ct-copy-msg:hover{color:#fff!important;background:#333!important;}
.ct-user .ct-label{color:#9cdcfe!important;}.ct-asst .ct-label{color:#dcdcaa!important;}.ct-user .ct-icon{color:#569cd6!important;}.ct-asst .ct-icon{color:#dcdcaa!important;}
.ct-kids{display:none!important;margin-top:4px!important;width:fit-content!important;max-width:95%!important;}.ct-kids.open{display:flex!important;flex-direction:column!important;}
.ct-asst .ct-kids{padding-left:16px!important;align-items:flex-start!important;}.ct-user .ct-kids{padding-right:16px!important;align-items:flex-end!important;}
.ct-kid{display:flex!important;align-items:center!important;gap:6px!important;padding:3px 6px!important;border-radius:8px!important;cursor:pointer!important;transition:background .12s!important;width:fit-content!important;max-width:100%!important;}.ct-kid:hover{background:#2a2d2e!important;}
.ct-user .ct-kid{flex-direction:row-reverse!important;}.ct-kid-icon{width:18px!important;font-size:10px!important;text-align:center!important;color:#888!important;flex-shrink:0!important;}
.ct-kid-lbl{flex:1!important;min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:11px!important;color:#aaa!important;}
.ct-t-h1 .ct-kid-lbl{color:#4fc1ff!important;font-weight:600!important;}.ct-t-h2 .ct-kid-lbl{color:#9cdcfe!important;font-weight:500!important;}.ct-t-h3 .ct-kid-lbl{color:#b5cea8!important;}
.ct-t-code .ct-kid-icon{color:#dcdcaa!important;}.ct-t-code .ct-kid-lbl{color:#ce9178!important;}.ct-t-quote .ct-kid-icon{color:#6a9955!important;}.ct-t-quote .ct-kid-lbl{color:#6a9955!important;font-style:italic!important;}
.ct-acts{display:flex!important;gap:2px!important;opacity:0!important;transition:opacity .12s!important;flex-shrink:0!important;}.ct-kid:hover .ct-acts{opacity:1!important;}
.ct-abtn{width:20px!important;height:20px!important;display:flex!important;align-items:center!important;justify-content:center!important;border:none!important;background:none!important;color:#777!important;cursor:pointer!important;border-radius:3px!important;font-size:10px!important;}.ct-abtn:hover{background:#333!important;color:#fff!important;}.ct-abtn.ok{color:#4ec9b0!important;}
.ct-hl{background:#614d00!important;color:#fff!important;border-radius:2px!important;padding:0 1px!important;}.ct-hidden{display:none!important;}
.ct-line{display:flex!important;align-items:flex-start!important;gap:6px!important;padding:2px 6px!important;border-radius:6px!important;cursor:pointer!important;}.ct-line:hover{background:#2a2d2e!important;}
.ct-line-n{width:28px!important;text-align:right!important;color:#666!important;font-size:10px!important;flex-shrink:0!important;}.ct-line-r{font-size:9px!important;padding:1px 4px!important;border-radius:3px!important;flex-shrink:0!important;}.ct-line-r.u{background:#264f78!important;color:#9cdcfe!important;}.ct-line-r.a{background:#4d3d00!important;color:#dcdcaa!important;}.ct-line-t{flex:1!important;color:#aaa!important;word-break:break-word!important;}
.ct-empty{padding:20px!important;text-align:center!important;color:#555!important;font-size:12px!important;}.ct-empty-icon{font-size:28px!important;margin-bottom:8px!important;}
.ct-model{font-size:9px!important;color:#555!important;padding:1px 4px!important;background:#2a2a2a!important;border-radius:3px!important;margin-left:4px!important;max-width:100px!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;}
.ct-lang{font-size:9px!important;color:#888!important;background:#1a1a1a!important;padding:0 3px!important;border-radius:2px!important;margin-left:2px!important;}
.ct-summary-actions{display:flex!important;gap:6px!important;flex-wrap:wrap!important;margin:8px 0!important;}
.ct-summary-btn{background:#2a2a2a!important;border:1px solid #444!important;color:#aaa!important;cursor:pointer!important;border-radius:6px!important;padding:6px 12px!important;font:11px inherit!important;transition:all .15s!important;}
.ct-summary-btn:hover{background:#333!important;color:#fff!important;border-color:#007acc!important;}
.ct-summary-btn.primary{background:#264f78!important;color:#9cdcfe!important;border-color:#264f78!important;}.ct-summary-btn.primary:hover{background:#2d6a9f!important;}
.ct-summary-btn.ai{background:#1a2a1a!important;color:#4ec9b0!important;border-color:#2a4a2a!important;}.ct-summary-btn.ai:hover{background:#2a3a2a!important;border-color:#4ec9b0!important;}
.ct-summary-btn:disabled{opacity:.4!important;cursor:not-allowed!important;}
.ct-field-label{color:#888!important;font-size:10px!important;text-transform:uppercase!important;letter-spacing:1px!important;padding:8px 4px 4px 4px!important;display:block!important;}
.ct-field-area{width:100%!important;min-height:180px!important;background:#111!important;border:1px solid #333!important;border-radius:6px!important;padding:10px!important;color:#ccc!important;font:11px/1.5 inherit!important;resize:vertical!important;outline:none!important;box-sizing:border-box!important;}
.ct-field-area:focus{border-color:#007acc!important;}.ct-field-area.tall{min-height:250px!important;}
.ct-ai-config{padding:10px!important;margin:6px 0!important;background:#1a1a2a!important;border:1px solid #2a2a4a!important;border-radius:8px!important;}
.ct-ai-config label{display:block!important;color:#888!important;font-size:10px!important;margin:6px 0 3px 0!important;text-transform:uppercase!important;letter-spacing:.5px!important;}
.ct-ai-config select,.ct-ai-config input[type="password"],.ct-ai-config input[type="text"]{width:100%!important;background:#111!important;border:1px solid #444!important;border-radius:4px!important;padding:5px 8px!important;color:#ccc!important;font:11px inherit!important;outline:none!important;box-sizing:border-box!important;}
.ct-ai-config select:focus,.ct-ai-config input:focus{border-color:#007acc!important;}
.ct-ai-config .ct-key-hint{color:#555!important;font-size:9px!important;margin-top:2px!important;}
.ct-ai-config .ct-key-hint a{color:#569cd6!important;text-decoration:none!important;}
.ct-ai-config .ct-key-hint a:hover{text-decoration:underline!important;}
.ct-ai-status-line{display:flex!important;align-items:center!important;gap:6px!important;font-size:10px!important;}
.ct-ai-status-dot{width:8px!important;height:8px!important;border-radius:50%!important;flex-shrink:0!important;}
.ct-ai-status-dot.ok{background:#4ec9b0!important;}.ct-ai-status-dot.no{background:#f44747!important;}
.ct-session-item{padding:8px 10px!important;margin:4px 0!important;background:#202020!important;border:1px solid #333!important;border-radius:8px!important;cursor:pointer!important;transition:background .12s!important;}
.ct-session-item:hover{background:#2a2d2e!important;border-color:#444!important;}.ct-session-item.autosave{border-left:3px solid #4ec9b066!important;}
.ct-session-name{color:#ddd!important;font-weight:500!important;margin-bottom:3px!important;}.ct-session-meta{color:#666!important;font-size:10px!important;display:flex!important;gap:8px!important;flex-wrap:wrap!important;}
.ct-session-actions{display:flex!important;gap:4px!important;margin-top:6px!important;}
.ct-session-abtn{background:none!important;border:1px solid #333!important;color:#888!important;cursor:pointer!important;border-radius:4px!important;padding:2px 8px!important;font:10px inherit!important;}.ct-session-abtn:hover{background:#333!important;color:#fff!important;}
.ct-session-badge{display:inline-block!important;padding:1px 5px!important;border-radius:3px!important;font-size:9px!important;margin-left:4px!important;}
.ct-session-badge.has-summary{background:#1a3a1a!important;color:#4ec9b0!important;}.ct-session-badge.auto{background:#1a2a3a!important;color:#569cd6!important;}
.ct-toast{position:fixed!important;bottom:20px!important;right:20px!important;background:#333!important;color:#fff!important;padding:10px 16px!important;border-radius:8px!important;font:12px inherit!important;z-index:2147483647!important;box-shadow:0 4px 16px rgba(0,0,0,.5)!important;opacity:0!important;transform:translateY(10px)!important;transition:all .3s ease!important;pointer-events:none!important;}
.ct-toast.show{opacity:1!important;transform:translateY(0)!important;}.ct-toast.success{border-left:3px solid #4ec9b0!important;}.ct-toast.error{border-left:3px solid #f44747!important;}.ct-toast.info{border-left:3px solid #007acc!important;}
.ct-overlay{position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;background:rgba(0,0,0,.6)!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;}
.ct-modal{background:#1e1e1e!important;border:1px solid #444!important;border-radius:12px!important;padding:20px!important;min-width:360px!important;max-width:500px!important;box-shadow:0 8px 32px rgba(0,0,0,.8)!important;}
.ct-modal-title{color:#ddd!important;font-size:14px!important;font-weight:600!important;margin-bottom:12px!important;}
.ct-modal-body textarea{width:100%!important;min-height:150px!important;background:#111!important;border:1px solid #444!important;border-radius:6px!important;padding:10px!important;color:#ccc!important;font:12px inherit!important;outline:none!important;resize:vertical!important;margin-bottom:12px!important;}
.ct-modal-actions{display:flex!important;gap:8px!important;justify-content:flex-end!important;}
    `;
    document.head.appendChild(css);
  }

  /* ═══════════════════════════════════════════
     ПАРСИНГ
     ═══════════════════════════════════════════ */
  function isInsideOurUI(el) { return !!el.closest("#ct-sidebar-panel, #ct-toggle-btn"); }
  function isComposerBlock(el) {
    if (el.querySelector("textarea")) return true;
    if (el.querySelector("form") && el.querySelector("button[type='submit']")) return true;
    if (el.querySelector("[contenteditable='true']")) return true;
    return false;
  }

  function findMessageRoots() {
    return Array.from(document.querySelectorAll(".mx-auto.max-w-\\[800px\\]")).filter(el => {
      if (!el.isConnected || isInsideOurUI(el) || isComposerBlock(el)) return false;
      const prose = el.querySelector(".prose");
      if (!prose) return false;
      const t = (prose.textContent || "").trim();
      if (!t || t.includes("Inputs are processed by third-party AI")) return false;
      if (el.parentElement?.closest(".mx-auto.max-w-\\[800px\\]")) return false;
      return true;
    });
  }

  function detectRole(root) {
    if (root.classList.contains("justify-end")) return "user";
    if (root.querySelector(":scope > .self-end, :scope > div > .self-end")) return "user";
    return "assistant";
  }

  function extractModel(root) {
    const t = root.querySelector(".truncate");
    if (t) { const v = (t.textContent || "").trim(); if (v.startsWith("claude") || v.startsWith("gpt") || v.includes("model")) return v; }
    return "";
  }

  function extractCodeLang(preEl) {
    const ls = preEl.querySelector("[data-code-block] .border-b span.text-text-secondary");
    if (ls) return (ls.textContent || "").trim();
    const hdr = preEl.querySelector("[data-code-block] .border-b");
    if (hdr) { for (const sp of hdr.querySelectorAll("span")) { const t = (sp.textContent || "").trim(); if (t && t.length < 30 && !t.includes("Copy")) return t; } }
    return "";
  }

  function parseMessages() {
    return findMessageRoots().map((root, idx) => {
      const role = detectRole(root), model = role === "assistant" ? extractModel(root) : "";
      const pr = root.querySelector(".prose"), ft = pr ? (pr.textContent || "").trim() : "";
      const msg = { id: idx + 1, role, model, el: root, title: "", kids: [], text: ft };
      if (!pr) return msg;

      pr.querySelectorAll(":scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > p,:scope > pre,:scope > ul,:scope > ol,:scope > blockquote,:scope > hr")
        .forEach(item => {
          const tag = item.tagName.toLowerCase(), txt = (item.textContent || "").trim();
          if (!txt && tag !== "hr") return;
          let type = "p", icon = "¶", full = txt;
          switch (tag) {
            case "h1": type = "h1"; icon = "H1"; break;
            case "h2": type = "h2"; icon = "H2"; break;
            case "h3": case "h4": type = "h3"; icon = "H3"; break;
            case "pre":
              type = "code";
              { const lang = extractCodeLang(item); icon = lang ? `{ ${lang} }` : "{ }"; const ce = item.querySelector("code"); full = ce ? ce.textContent : txt; }
              break;
            case "ul": case "ol":
              item.querySelectorAll(":scope > li").forEach(li => {
                const lt = (li.textContent || "").trim();
                if (lt) msg.kids.push({ type: "li", icon: tag === "ol" ? "#" : "•", label: cut(lt, CFG.maxPreview), full: lt, el: li });
              });
              return;
            case "blockquote": type = "quote"; icon = "❝"; break;
            case "hr": type = "hr"; icon = "—"; full = "───"; break;
          }
          if (!msg.title && ["h1", "h2", "h3"].includes(type)) msg.title = txt;
          msg.kids.push({ type, icon, label: cut(type === "hr" ? "──────" : txt, CFG.maxPreview), full, el: item, lang: type === "code" ? extractCodeLang(item) : "" });
        });

      if (!msg.title) {
        const f = ft.split("\n").find(l => l.trim()) || "";
        msg.title = cut(f || `#${msg.id}`, 60);
      }
      return msg;
    });
  }

  /* ═══════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════ */
  function hlText(t, q) {
    if (!q) return h(t);
    return h(t).replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), '<span class="ct-hl">$1</span>');
  }

  function renderTree(msgs, openSet, q) {
    if (!msgs.length) return `<div class="ct-empty"><div class="ct-empty-icon">🌲</div>Нет сообщений</div>`;
    const ql = (q || "").trim().toLowerCase(); let out = "", shown = 0;
    msgs.forEach(m => {
      if (ql && !m.text.toLowerCase().includes(ql)) return; shown++;
      const cls = m.role === "user" ? "ct-user" : "ct-asst", ico = m.role === "user" ? "👤" : "🤖";
      const hk = m.kids.length > 0, op = openSet.has(String(m.id)) || !!ql;
      out += `<div class="ct-node ${cls}" data-i="${m.id}"><div class="ct-node-hdr" data-i="${m.id}">`;
      out += `<span class="ct-chevron ${op ? "open" : ""}">${hk ? "▸" : ""}</span><span class="ct-icon">${ico}</span>`;
      out += `<span class="ct-label">${hlText(m.title, ql)}</span><span class="ct-num">#${m.id}</span>`;
      if (m.model) out += `<span class="ct-model">${h(m.model)}</span>`;
      out += `<button class="ct-copy-msg" data-i="${m.id}">📋</button></div>`;
      if (hk) {
        out += `<div class="ct-kids ${op ? "open" : ""}">`;
        m.kids.forEach((k, ki) => {
          const hd = ql && !k.full.toLowerCase().includes(ql) ? "ct-hidden" : "";
          out += `<div class="ct-kid ct-t-${k.type} ${hd}" data-mi="${m.id}" data-ki="${ki}">`;
          out += `<span class="ct-kid-icon">${h(k.icon)}</span><span class="ct-kid-lbl">${hlText(k.label, ql)}</span>`;
          if (k.lang) out += `<span class="ct-lang">${h(k.lang)}</span>`;
          out += `<div class="ct-acts"><button class="ct-abtn ct-copy">📋</button><button class="ct-abtn ct-goto">🎯</button></div></div>`;
        });
        out += `</div>`;
      }
      out += `</div>`;
    });
    if (!shown && ql) return `<div class="ct-empty"><div class="ct-empty-icon">🔍</div>Не найдено</div>`;
    return out;
  }

  function renderLines(msgs, q) {
    if (!msgs.length) return `<div class="ct-empty"><div class="ct-empty-icon">📝</div>Нет строк</div>`;
    const ql = (q || "").trim().toLowerCase(); let out = "", n = 0, shown = 0;
    msgs.forEach(m => {
      (m.text || "").split("\n").filter(l => l.trim()).forEach((ln, i) => {
        n++; if (ql && !ln.toLowerCase().includes(ql)) return; shown++;
        const rc = m.role === "user" ? "u" : "a", rl = m.role === "user" ? "U" : "A";
        out += `<div class="ct-line" data-mi="${m.id}"><span class="ct-line-n">${n}</span>`;
        out += i === 0 ? `<span class="ct-line-r ${rc}">${rl}</span>` : `<span class="ct-line-r" style="visibility:hidden">${rl}</span>`;
        out += `<span class="ct-line-t">${hlText(cut(ln.trim(), 120), ql)}</span></div>`;
      });
    });
    if (!shown && ql) return `<div class="ct-empty"><div class="ct-empty-icon">🔍</div>Не найдено</div>`;
    return out;
  }

  function renderSummaryTab(summaryText, compactText, aiEngine) {
    const cfg = aiEngine.getConfig();
    const prov = aiEngine.getProviderInfo();
    const isReady = aiEngine.isConfigured();
    let o = '';

    o += `<div class="ct-ai-config" id="ct-ai-cfg">`;
    o += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">`;
    o += `<span style="color:#4ec9b0;font-size:11px;font-weight:600">🧠 AI Настройки</span>`;
    o += `<div class="ct-ai-status-line"><div class="ct-ai-status-dot ${isReady ? 'ok' : 'no'}"></div>`;
    o += `<span style="color:${isReady ? '#4ec9b0' : '#666'}">${isReady ? 'Готов' : 'Нужен ключ'}</span></div></div>`;

    o += `<label>Провайдер:</label><select id="ct-ai-provider">`;
    Object.entries(AI_PROVIDERS).forEach(([key, p]) => {
      o += `<option value="${key}" ${cfg.provider === key ? 'selected' : ''}>${p.name}</option>`;
    });
    o += `</select>`;

    o += `<label>Модель:</label><select id="ct-ai-model">`;
    prov.models.forEach(m => {
      o += `<option value="${m.id}" ${(cfg.model || prov.defaultModel) === m.id ? 'selected' : ''}>${m.name}</option>`;
    });
    o += `</select>`;

    o += `<label>API ключ:</label>`;
    o += `<input type="password" id="ct-ai-key" value="${h(cfg.apiKey)}" placeholder="Вставь API ключ..."/>`;
    if (prov.keyUrl) {
      o += `<div class="ct-key-hint">💡 ${prov.keyHint} → <a href="${prov.keyUrl}" target="_blank">Получить ключ</a></div>`;
    }

    if (cfg.provider === 'custom') {
      o += `<label>API URL:</label>`;
      o += `<input type="text" id="ct-ai-custom-url" value="${h(cfg.customUrl || '')}" placeholder="http://localhost:1234/v1/chat/completions"/>`;
    }

    o += `<div class="ct-summary-actions" style="margin-top:8px!important">`;
    o += `<button class="ct-summary-btn primary" id="ct-ai-save-cfg" style="padding:4px 12px!important;font-size:10px!important">💾 Сохранить</button></div>`;
    o += `</div>`;

    o += `<div class="ct-summary-actions">`;
    o += `<button class="ct-summary-btn primary" id="ct-gen-summary">📋 Локальный</button>`;
    o += `<button class="ct-summary-btn ai" id="ct-gen-ai-summary" ${!isReady ? 'disabled' : ''}>🧠 AI Summary</button>`;
    o += `<button class="ct-summary-btn" id="ct-gen-compact">📦 Контекст</button>`;
    o += `</div>`;

    o += `<label class="ct-field-label">📋 Summary:</label>`;
    o += `<div class="ct-summary-actions" style="margin:0 0 4px 0!important">`;
    o += `<button class="ct-summary-btn" id="ct-copy-summary" style="padding:3px 8px!important;font-size:10px!important">📋 Копировать</button>`;
    o += `<button class="ct-summary-btn" id="ct-clear-summary" style="padding:3px 8px!important;font-size:10px!important;color:#f44747!important">✕</button></div>`;
    o += `<textarea class="ct-field-area tall" id="ct-summary-area" placeholder="Нажми «📋 Локальный» или «🧠 AI Summary»">${h(summaryText)}</textarea>`;

    o += `<label class="ct-field-label" style="margin-top:12px!important">📎 Контекст:</label>`;
    o += `<div class="ct-summary-actions" style="margin:0 0 4px 0!important">`;
    o += `<button class="ct-summary-btn" id="ct-copy-compact" style="padding:3px 8px!important;font-size:10px!important">📋 Копировать</button>`;
    o += `<button class="ct-summary-btn" id="ct-clear-compact" style="padding:3px 8px!important;font-size:10px!important;color:#f44747!important">✕</button></div>`;
    o += `<textarea class="ct-field-area" id="ct-compact-area" placeholder="Компактный контекст для нового чата">${h(compactText)}</textarea>`;
    return o;
  }

  function renderSessionsTab(sm) {
    const ss = sm.listSessions(), st = sm.getStorageStats();
    let o = `<div class="ct-summary-actions"><button class="ct-summary-btn primary" id="ct-save-session">💾 Сохранить</button><button class="ct-summary-btn" id="ct-import-session">📥 Импорт</button></div>`;
    o += `<div style="padding:6px 8px;color:#666;font-size:10px;border-bottom:1px solid #333;margin-bottom:8px">💾 ${st.sessions} сессий | ${st.sizeKB} KB</div>`;
    if (!ss.length) return o + `<div class="ct-empty"><div class="ct-empty-icon">📂</div>Нет сессий</div>`;

    ss.sort((a, b) => new Date(b.created) - new Date(a.created)).forEach(s => {
      const d = new Date(s.created).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
      const isA = s.name.startsWith('🔄');
      o += `<div class="ct-session-item${isA ? ' autosave' : ''}"><div class="ct-session-name">${h(s.name)}`;
      if (s.hasSummary) o += `<span class="ct-session-badge has-summary">📋</span>`;
      if (isA) o += `<span class="ct-session-badge auto">авто</span>`;
      o += `</div><div class="ct-session-meta"><span>📅 ${d}</span><span>💬 ${s.messageCount}</span><span>📝 ${(s.totalChars || 0).toLocaleString('ru-RU')}</span></div>`;
      o += `<div class="ct-session-actions">`;
      o += `<button class="ct-session-abtn" data-action="view" data-sid="${h(s.id)}">👁</button>`;
      o += `<button class="ct-session-abtn" data-action="summary" data-sid="${h(s.id)}">📋</button>`;
      o += `<button class="ct-session-abtn" data-action="context" data-sid="${h(s.id)}">📎</button>`;
      o += `<button class="ct-session-abtn" data-action="export-json" data-sid="${h(s.id)}">📤J</button>`;
      o += `<button class="ct-session-abtn" data-action="export-md" data-sid="${h(s.id)}">📤M</button>`;
      o += `<button class="ct-session-abtn" data-action="delete" data-sid="${h(s.id)}" style="color:#f44747">🗑</button>`;
      o += `</div></div>`;
    });
    return o;
  }

  function renderSessionView(s) {
    let o = `<div class="ct-summary-actions"><button class="ct-summary-btn" id="ct-back-sessions">← Назад</button><button class="ct-summary-btn" id="ct-copy-session-text">📋 Всё</button></div>`;
    o += `<div style="padding:8px;border-bottom:1px solid #333;margin-bottom:8px"><div style="color:#ddd;font-weight:600">${h(s.name)}</div>`;
    o += `<div style="color:#666;font-size:10px;margin-top:4px">${new Date(s.created).toLocaleString('ru-RU')} | ${s.messageCount} сообщ.</div></div>`;
    if (s.summary) o += `<label class="ct-field-label">Summary:</label><textarea class="ct-field-area" readonly style="min-height:120px!important">${h(s.summary)}</textarea>`;
    o += `<label class="ct-field-label">Сообщения:</label>`;
    (s.messages || []).forEach(m => {
      const bg = m.role === 'user' ? '#142231' : '#1f1f12', bc = m.role === 'user' ? '#24405a' : '#353525';
      o += `<div style="margin:6px 0;padding:8px 10px;background:${bg};border:1px solid ${bc};border-radius:8px">`;
      o += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span>${m.role === 'user' ? '👤' : '🤖'}</span>`;
      o += `<span style="color:#ddd;font-weight:500">${h(m.title || '#' + m.id)}</span>`;
      if (m.model) o += `<span class="ct-model">${h(m.model)}</span>`;
      o += `</div><div style="color:#999;font-size:11px;white-space:pre-wrap;max-height:200px;overflow:auto">${h(cut(m.text || '', 500))}</div></div>`;
    });
    return o;
  }

  function showToast(msg, type = 'info', dur = 2500) {
    let t = document.getElementById('ct-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ct-toast'; t.className = 'ct-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = `ct-toast ${type}`;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('show'), dur);
  }

  function showModal(title, body, onOk) {
    const ov = document.createElement('div'); ov.className = 'ct-overlay';
    ov.innerHTML = `<div class="ct-modal"><div class="ct-modal-title">${title}</div><div class="ct-modal-body">${body}</div><div class="ct-modal-actions"><button class="ct-summary-btn" id="ct-modal-cancel">Отмена</button><button class="ct-summary-btn primary" id="ct-modal-confirm">OK</button></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('#ct-modal-cancel').addEventListener('click', () => ov.remove());
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    ov.querySelector('#ct-modal-confirm').addEventListener('click', () => { if (onOk) onOk(ov); ov.remove(); });
  }

  /* ═══════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════ */
  function init() {
    if (document.getElementById("ct-toggle-btn")) return;

    const sessionMgr = new SessionManager();
    const summaryGen = new SummaryGenerator();
    const aiEngine = new AISummaryEngine();

    let sidebarW = loadSidebarW();
    document.documentElement.style.setProperty("--ct-w", sidebarW + "px");
    injectCSS();

    const btn = document.createElement("div");
    btn.id = "ct-toggle-btn"; btn.textContent = "◀"; btn.title = "Tree Sidebar (Ctrl+B)";
    document.body.appendChild(btn);

    const panel = document.createElement("div");
    panel.id = "ct-sidebar-panel";
    panel.innerHTML = `
      <div id="ct-resize-handle"></div>
      <div class="ct-hdr">
        <span class="ct-hdr-title">🌲 Explorer</span>
        <div class="ct-hdr-actions">
          <button class="ct-hdr-btn" id="ct-btn-collapse">⊟</button>
          <button class="ct-hdr-btn" id="ct-btn-expand">⊞</button>
          <button class="ct-hdr-btn" id="ct-btn-refresh">⟳</button>
        </div>
      </div>
      <div class="ct-search-bar">
        <input id="ct-search" placeholder="Поиск…" autocomplete="off"/>
        <span class="ct-search-count" id="ct-search-count"></span>
      </div>
      <div class="ct-counter">
        <div class="ct-dot" id="ct-dot"></div>
        <span>Симв: <span class="ct-count-val" id="ct-chars">0</span></span>
        <span class="ct-stat-sep">│</span>
        <span>Строк: <span class="ct-count-val" id="ct-lines">0</span></span>
        <span class="ct-stat-sep">│</span>
        <span>Сообщ: <span class="ct-count-val" id="ct-msg-count">0</span></span>
        <span class="ct-stat-sep">│</span>
        <span>👤<span class="ct-count-val" id="ct-user-count">0</span> 🤖<span class="ct-count-val" id="ct-asst-count">0</span></span>
        <span class="ct-autosave-indicator" id="ct-autosave-ind">💾</span>
      </div>
      <div class="ct-tabs">
        <button class="ct-tab on" data-t="tree">🌲 Дерево</button>
        <button class="ct-tab" data-t="lines">📝 Строки</button>
        <button class="ct-tab" data-t="summary">📋 Summary</button>
        <button class="ct-tab" data-t="sessions">💾 Сессии</button>
      </div>
      <div class="ct-scroll" id="ct-scroll"></div>
      <div class="ct-footer">
        <button class="ct-footer-btn" id="ct-go-top">⬆ Наверх</button>
        <span class="ct-footer-hint">Ctrl+B</span>
        <button class="ct-footer-btn" id="ct-go-bottom">⬇ Вниз</button>
      </div>
    `;
    document.body.appendChild(panel);

    let isOpen = false, tab = "tree", data = [], query = "";
    let openSet = loadOpenSet(), viewingSession = null;
    let savedSummaryText = '', savedCompactText = '';
    let prevMsgCount = 0, prevLastMsgText = '', autosaveId = null, autosaveTimer = null, lastAutosaveHash = '';

    const scroll = panel.querySelector("#ct-scroll");
    const searchInput = panel.querySelector("#ct-search");

    // ── Autosave ──
    function getAutosaveKey() { return 'autosave_' + location.pathname.replace(/[^a-z0-9]/gi, '_'); }
    function computeHash(d) { const l = d[d.length - 1]; return `${d.length}:${(l?.text || '').length}:${l?.role || ''}`; }

    function doAutosave() {
      if (data.length < 2) return;
      const hash = computeHash(data);
      if (hash === lastAutosaveHash) return;
      lastAutosaveHash = hash;

      const key = getAutosaveKey();
      if (!autosaveId) {
        const e = sessionMgr.listSessions().find(s => s.id === key);
        if (e) autosaveId = key;
      }

      const now = new Date();
      const name = `🔄 Авто · ${now.toLocaleTimeString('ru-RU').slice(0, 5)} · ${data.length} сообщ.`;
      const msgs = data.map(m => ({
        id: m.id, role: m.role, model: m.model || '', title: m.title || '', text: m.text || '',
        kids: (m.kids || []).map(k => ({ type: k.type, icon: k.icon, label: k.label, full: k.full, lang: k.lang || '' })),
      }));

      if (autosaveId && sessionMgr.loadSession(autosaveId)) {
        const e = sessionMgr.loadSession(autosaveId);
        e.name = name; e.updated = now.toISOString(); e.messageCount = data.length;
        e.totalChars = data.reduce((s, m) => s + (m.text || '').length, 0); e.messages = msgs;
        try {
          localStorage.setItem(CFG.sessionStoragePrefix + autosaveId, JSON.stringify(e));
          const list = sessionMgr.listSessions();
          const item = list.find(s => s.id === autosaveId);
          if (item) { item.name = name; item.messageCount = e.messageCount; item.totalChars = e.totalChars; localStorage.setItem(CFG.sessionListKey, JSON.stringify(list)); }
        } catch {}
      } else {
        autosaveId = key;
        const session = {
          id: key, name, created: now.toISOString(), updated: now.toISOString(), url: location.href,
          messageCount: data.length, totalChars: data.reduce((s, m) => s + (m.text || '').length, 0),
          summary: '', messages: msgs,
        };
        try {
          localStorage.setItem(CFG.sessionStoragePrefix + key, JSON.stringify(session));
          const list = sessionMgr.listSessions();
          const idx = list.findIndex(s => s.id === key);
          const meta = { id: key, name, created: session.created, messageCount: session.messageCount, totalChars: session.totalChars, hasSummary: false };
          if (idx >= 0) list[idx] = meta; else list.push(meta);
          localStorage.setItem(CFG.sessionListKey, JSON.stringify(list));
        } catch {}
      }

      const ind = panel.querySelector('#ct-autosave-ind');
      if (ind) { ind.textContent = `💾 ${now.toLocaleTimeString('ru-RU').slice(0, 5)}`; ind.classList.add('show'); setTimeout(() => ind.classList.remove('show'), 3000); }
    }

    function checkForNewMessages() {
      const nc = data.length, lt = data[data.length - 1]?.text || '';
      if ((nc !== prevMsgCount || (nc > 0 && lt !== prevLastMsgText)) && nc >= 2) {
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(doAutosave, CFG.autosaveDebounce);
      }
      prevMsgCount = nc; prevLastMsgText = lt;
    }

    // ── Summary fields persistence ──
    function saveSummaryFields() {
      const sa = scroll.querySelector('#ct-summary-area'), ca = scroll.querySelector('#ct-compact-area');
      if (sa) savedSummaryText = sa.value;
      if (ca) savedCompactText = ca.value;
    }

    // ── Render ──
    function render() {
      if (tab === 'summary') saveSummaryFields();

      if (tab === 'tree') scroll.innerHTML = renderTree(data, openSet, query);
      else if (tab === 'lines') scroll.innerHTML = renderLines(data, query);
      else if (tab === 'summary') { scroll.innerHTML = renderSummaryTab(savedSummaryText, savedCompactText, aiEngine); bindSummaryEvents(); }
      else if (tab === 'sessions') {
        if (viewingSession) { scroll.innerHTML = renderSessionView(viewingSession); bindSessionViewEvents(); }
        else { scroll.innerHTML = renderSessionsTab(sessionMgr); bindSessionsEvents(); }
      }

      const sc = panel.querySelector("#ct-search-count");
      if (sc) {
        if (query && (tab === 'tree' || tab === 'lines')) {
          const q = query.toLowerCase(); let c = 0;
          data.forEach(m => { if (m.text.toLowerCase().includes(q)) c++; });
          sc.textContent = `${c}/${data.length}`;
        } else sc.textContent = "";
      }
    }

    // ── Summary events ──
    function bindSummaryEvents() {
      const sArea = scroll.querySelector('#ct-summary-area'), cArea = scroll.querySelector('#ct-compact-area');

      // Save AI config
      scroll.querySelector('#ct-ai-save-cfg')?.addEventListener('click', () => {
        const provider = scroll.querySelector('#ct-ai-provider')?.value || 'groq';
        const key = scroll.querySelector('#ct-ai-key')?.value || '';
        const model = scroll.querySelector('#ct-ai-model')?.value || '';
        const customUrl = scroll.querySelector('#ct-ai-custom-url')?.value || '';
        aiEngine.setConfig(provider, key, model, customUrl);
        showToast('💾 Настройки сохранены!', 'success');
        render();
      });

      // Provider change → update models
      scroll.querySelector('#ct-ai-provider')?.addEventListener('change', (e) => {
        const prov = AI_PROVIDERS[e.target.value];
        const modelSelect = scroll.querySelector('#ct-ai-model');
        if (modelSelect && prov) {
          modelSelect.innerHTML = '';
          prov.models.forEach(m => { const opt = document.createElement('option'); opt.value = m.id; opt.textContent = m.name; modelSelect.appendChild(opt); });
        }
        const hint = scroll.querySelector('.ct-key-hint');
        if (hint && prov) { hint.innerHTML = `💡 ${prov.keyHint}${prov.keyUrl ? ` → <a href="${prov.keyUrl}" target="_blank">Получить ключ</a>` : ''}`; }
      });

      // Local summary
      scroll.querySelector('#ct-gen-summary')?.addEventListener('click', () => {
        if (!data.length) { showToast('Нет сообщений', 'error'); return; }
        const t = summaryGen.generateLocalSummary(data);
        savedSummaryText = t; if (sArea) sArea.value = t;
        showToast('📋 Готово!', 'success');
      });

      // AI Summary
      scroll.querySelector('#ct-gen-ai-summary')?.addEventListener('click', async () => {
        if (!data.length) { showToast('Нет сообщений', 'error'); return; }
        if (!aiEngine.isConfigured()) { showToast('⚙️ Сначала настрой API ключ', 'error'); return; }

        const aiBtn = scroll.querySelector('#ct-gen-ai-summary');
        if (aiBtn) { aiBtn.disabled = true; aiBtn.textContent = '🧠 Генерация...'; }

        try {
          const aiSummary = await aiEngine.generateSummary(data);
          let combined = `🧠 AI SUMMARY\n${'═'.repeat(40)}\n\n${aiSummary}\n\n${'─'.repeat(40)}\n\n`;
          combined += summaryGen.generateLocalSummary(data);
          savedSummaryText = combined;
          if (sArea) sArea.value = combined;
          showToast('🧠 AI Summary готов!', 'success');
        } catch (e) {
          showToast(`❌ ${e.message}`, 'error', 4000);
        }
        if (aiBtn) { aiBtn.disabled = false; aiBtn.textContent = '🧠 AI Summary'; }
      });

      // Compact
      scroll.querySelector('#ct-gen-compact')?.addEventListener('click', () => {
        if (!data.length) { showToast('Нет', 'error'); return; }
        const t = summaryGen.generateCompactSummary(data);
        savedCompactText = t; if (cArea) cArea.value = t;
        showToast('📦 Готово!', 'success');
      });

      // Copy/Clear
      scroll.querySelector('#ct-copy-summary')?.addEventListener('click', () => {
        const t = sArea?.value || savedSummaryText;
        if (t) { copyTxt(t); showToast('📋 Скопировано!', 'success'); } else showToast('Пусто', 'error');
      });
      scroll.querySelector('#ct-copy-compact')?.addEventListener('click', () => {
        const t = cArea?.value || savedCompactText;
        if (t) { copyTxt(t); showToast('📎 Скопировано!', 'success'); } else showToast('Пусто', 'error');
      });
      scroll.querySelector('#ct-clear-summary')?.addEventListener('click', () => { savedSummaryText = ''; if (sArea) sArea.value = ''; });
      scroll.querySelector('#ct-clear-compact')?.addEventListener('click', () => { savedCompactText = ''; if (cArea) cArea.value = ''; });
    }

    // ── Sessions events ──
    function bindSessionsEvents() {
      scroll.querySelector('#ct-save-session')?.addEventListener('click', () => {
        if (!data.length) { showToast('Нет сообщений', 'error'); return; }
        const name = prompt('Название:', `Чат ${new Date().toLocaleDateString('ru-RU')}`);
        if (name === null) return;
        const id = sessionMgr.saveSession(data, name);
        if (id) {
          sessionMgr.saveSummary(id, summaryGen.generateLocalSummary(data));
          showToast(`💾 ${name}`, 'success'); render();
        } else showToast('Ошибка', 'error');
      });

      scroll.querySelector('#ct-import-session')?.addEventListener('click', () => {
        showModal('📥 Импорт', '<textarea id="ct-import-json" placeholder="JSON..."></textarea>', ov => {
          const j = ov.querySelector('#ct-import-json').value;
          if (!j.trim()) return;
          if (sessionMgr.importSession(j)) { showToast('✅ Импортировано!', 'success'); render(); }
          else showToast('❌ Ошибка', 'error');
        });
      });

      scroll.querySelectorAll('.ct-session-abtn').forEach(b => {
        b.addEventListener('click', e => {
          e.stopPropagation();
          const action = b.dataset.action, sid = b.dataset.sid;
          if (action === 'view') { const s = sessionMgr.loadSession(sid); if (s) { viewingSession = s; render(); } }
          else if (action === 'summary') {
            const s = sessionMgr.loadSession(sid);
            if (s?.summary) { copyTxt(s.summary); showToast('📋 Скопировано!', 'success'); }
            else if (s) { const sm = summaryGen.generateLocalSummary(s.messages); sessionMgr.saveSummary(sid, sm); copyTxt(sm); showToast('📋 Создан!', 'success'); render(); }
          }
          else if (action === 'context') { const s = sessionMgr.loadSession(sid); if (s) { copyTxt(summaryGen.generateCompactSummary(s.messages)); showToast('📎 Скопировано!', 'success'); } }
          else if (action === 'export-json') { sessionMgr.exportSession(sid); showToast('📤', 'success'); }
          else if (action === 'export-md') { sessionMgr.exportSessionMarkdown(sid); showToast('📤', 'success'); }
          else if (action === 'delete') {
            if (confirm('Удалить эту сессию?')) {
              sessionMgr.deleteSession(sid);
              if (autosaveId === sid) { autosaveId = null; lastAutosaveHash = ''; }
              showToast('🗑 Удалено', 'info'); render();
            }
          }
        });
      });
    }

    function bindSessionViewEvents() {
      scroll.querySelector('#ct-back-sessions')?.addEventListener('click', () => { viewingSession = null; render(); });
      scroll.querySelector('#ct-copy-session-text')?.addEventListener('click', () => {
        if (!viewingSession) return;
        let t = '';
        (viewingSession.messages || []).forEach(m => {
          t += `=== ${m.role === 'user' ? 'User' : 'Assistant'} #${m.id} ===\n${m.text}\n\n`;
        });
        copyTxt(t); showToast('📋 Скопировано!', 'success');
      });
    }

    // ── Counters ──
    function updateCounters() {
      let c = 0, l = 0, u = 0, a = 0;
      for (const m of data) {
        c += (m.text || "").length;
        l += (m.text || "").split("\n").filter(x => x.trim()).length;
        if (m.role === "user") u++; else a++;
      }
      panel.querySelector("#ct-chars").textContent = c.toLocaleString("ru-RU");
      panel.querySelector("#ct-lines").textContent = l.toLocaleString("ru-RU");
      panel.querySelector("#ct-msg-count").textContent = data.length;
      panel.querySelector("#ct-user-count").textContent = u;
      panel.querySelector("#ct-asst-count").textContent = a;
      const dot = panel.querySelector("#ct-dot");
      dot.className = "ct-dot";
      if (c >= CFG.charWarnRed) dot.classList.add("red");
      else if (c >= CFG.charWarnOrange) dot.classList.add("orange");
    }

    function refresh() { data = parseMessages(); updateCounters(); checkForNewMessages(); render(); }

    function togglePanel(f) {
      isOpen = f !== undefined ? f : !isOpen;
      panel.classList.toggle("ct-visible", isOpen);
      btn.classList.toggle("ct-shifted", isOpen);
      btn.textContent = isOpen ? "▶" : "◀";
      if (isOpen) refresh();
    }

    // ── Event listeners ──
    btn.addEventListener("click", () => togglePanel());
    document.addEventListener("keydown", e => {
      if (e.code === CFG.hotkey && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); togglePanel(); }
    });

    panel.querySelectorAll(".ct-tab").forEach(t => {
      t.addEventListener("click", () => {
        if (tab === 'summary') saveSummaryFields();
        panel.querySelectorAll(".ct-tab").forEach(x => x.classList.remove("on"));
        t.classList.add("on"); tab = t.dataset.t; viewingSession = null; render();
      });
    });

    let sT = null;
    searchInput.addEventListener("input", () => { clearTimeout(sT); sT = setTimeout(() => { query = searchInput.value; render(); }, 200); });
    searchInput.addEventListener("keydown", e => { if (e.key === "Escape") { searchInput.value = ""; query = ""; render(); } });

    panel.querySelector("#ct-btn-collapse").addEventListener("click", () => { openSet.clear(); saveOpenSet(openSet); render(); });
    panel.querySelector("#ct-btn-expand").addEventListener("click", () => { data.forEach(m => { if (m.kids.length) openSet.add(String(m.id)); }); saveOpenSet(openSet); render(); });
    panel.querySelector("#ct-btn-refresh").addEventListener("click", refresh);
    panel.querySelector("#ct-go-top").addEventListener("click", () => { if (data.length) flashEl(data[0].el); });
    panel.querySelector("#ct-go-bottom").addEventListener("click", () => { if (data.length) flashEl(data[data.length - 1].el); });

    // ── Resize ──
    const rh = panel.querySelector("#ct-resize-handle"); let resizing = false;
    rh.addEventListener("mousedown", e => {
      e.preventDefault(); resizing = true; rh.classList.add("active");
      const onM = ev => { if (!resizing) return; let w = window.innerWidth - ev.clientX; w = Math.max(CFG.minSidebarWidth, Math.min(CFG.maxSidebarWidth, w)); sidebarW = w; document.documentElement.style.setProperty("--ct-w", w + "px"); };
      const onU = () => { resizing = false; rh.classList.remove("active"); saveSidebarW(sidebarW); document.removeEventListener("mousemove", onM); document.removeEventListener("mouseup", onU); };
      document.addEventListener("mousemove", onM); document.addEventListener("mouseup", onU);
    });

    // ── Tree/Lines click delegation ──
    scroll.addEventListener("click", e => {
      if (tab === 'summary' || tab === 'sessions') return;

      const cm = e.target.closest(".ct-copy-msg");
      if (cm) {
        e.stopPropagation();
        const mi = parseInt(cm.dataset.i, 10) - 1;
        if (data[mi]?.text) { copyTxt(data[mi].text); cm.textContent = "✓"; setTimeout(() => cm.textContent = "📋", 1200); }
        return;
      }

      const hdr = e.target.closest(".ct-node-hdr");
      if (hdr) {
        const id = String(hdr.dataset.i), node = hdr.closest(".ct-node");
        const kids = node.querySelector(".ct-kids"), chev = node.querySelector(".ct-chevron");
        if (kids) {
          const w = !kids.classList.contains("open");
          kids.classList.toggle("open", w); chev.classList.toggle("open", w);
          if (w) openSet.add(id); else openSet.delete(id);
          saveOpenSet(openSet);
        }
        const mi = parseInt(id, 10) - 1; if (data[mi]) flashEl(data[mi].el);
        return;
      }

      const cp = e.target.closest(".ct-copy");
      if (cp) {
        e.stopPropagation();
        const kid = cp.closest(".ct-kid"), mi = parseInt(kid.dataset.mi, 10) - 1, ki = parseInt(kid.dataset.ki, 10);
        if (data[mi]?.kids[ki]?.full) {
          copyTxt(data[mi].kids[ki].full); cp.textContent = "✓"; cp.classList.add("ok");
          setTimeout(() => { cp.textContent = "📋"; cp.classList.remove("ok"); }, 1200);
        }
        return;
      }

      const go = e.target.closest(".ct-goto");
      if (go) {
        e.stopPropagation();
        const kid = go.closest(".ct-kid"), mi = parseInt(kid.dataset.mi, 10) - 1, ki = parseInt(kid.dataset.ki, 10);
        if (data[mi]?.kids[ki]?.el) flashEl(data[mi].kids[ki].el);
        return;
      }

      const kr = e.target.closest(".ct-kid");
      if (kr) {
        const mi = parseInt(kr.dataset.mi, 10) - 1, ki = parseInt(kr.dataset.ki, 10);
        if (data[mi]?.kids[ki]?.el) flashEl(data[mi].kids[ki].el);
        return;
      }

      const ln = e.target.closest(".ct-line");
      if (ln) { const mi = parseInt(ln.dataset.mi, 10) - 1; if (data[mi]) flashEl(data[mi].el); }
    });

    // ── Main loop ──
    setInterval(() => {
      data = parseMessages();
      checkForNewMessages();
      if (isOpen) { updateCounters(); if (tab !== 'summary') render(); }
    }, CFG.updateInterval);

    setTimeout(refresh, 1200);
    console.log("[Claude Tree Sidebar v6.4] by chokopockos — Smart AI Summary");
  }

  function boot() {
    init();
    new MutationObserver(() => {}).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "complete" || document.readyState === "interactive") setTimeout(boot, 800);
  else document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 800));
})();
