// Application State
let appData = {
    sessions: [],
    config: {
        exclude_paths: [],
        lang: 'zh-CN',
        models: {}
    }
};

// Translations cache
let translations = {};

// Pagination state for session view
let sessionCurrentPage = 1;
const sessionPageSize = 10;

// Single Framework detailed view state
let singleFwState = {
    selectedFw: '',
    startDate: '',
    endDate: '',
    activePreset: 7 // Default to 7 days
};
let frameworkTrendChartInstance = null;

// DOM Elements
const viewTabsNav = document.getElementById('view-tabs-nav');
const tabButtons = document.querySelectorAll('.tab-btn');
const sections = document.querySelectorAll('.dashboard-section');
const configForm = document.getElementById('config-form');
const modelsListContainer = document.getElementById('models-list-container');
const excludePathsInput = document.getElementById('exclude-paths-input');

// Quick stats cards
const cardTotalCost = document.getElementById('card-total-cost').querySelector('.card-value');
const cardTotalTokens = document.getElementById('card-total-tokens').querySelector('.card-value');
const cardTotalSessions = document.getElementById('card-total-sessions').querySelector('.card-value');

// Portal Tooltip Elements
const tooltipEl = document.getElementById('tooltip');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    fetchStats();
});

function setupEventListeners() {
    // Tab switching
    viewTabsNav.addEventListener('click', (e) => {
        const tab = e.target.closest('.tab-btn');
        if (!tab) return;
        
        tabButtons.forEach(btn => btn.classList.remove('active'));
        sections.forEach(sec => sec.classList.remove('active'));
        
        tab.classList.add('active');
        const viewName = tab.getAttribute('data-view');
        document.getElementById(`view-section-${viewName}`).classList.add('active');
    });

    // Config form submit
    configForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const saveBtn = document.getElementById('save-config-btn');
        const originalText = saveBtn.textContent;
        saveBtn.disabled = true;
        saveBtn.textContent = t('saving');

        await saveConfigData();

        saveBtn.textContent = t('saveSuccess');
        setTimeout(() => {
            saveBtn.textContent = originalText;
            saveBtn.disabled = false;
        }, 1500);
    });

    // Language selection change
    document.getElementById('lang-select').addEventListener('change', async () => {
        await saveConfigData();
    });

    // Toggle sidebar click handler
    document.getElementById('toggle-sidebar-btn').addEventListener('click', async () => {
        const sidebar = document.getElementById('config-sidebar');
        const btn = document.getElementById('toggle-sidebar-btn');
        const isCollapsed = sidebar.classList.toggle('collapsed');
        
        // Update tooltip and translation attribute
        btn.setAttribute('data-tooltip', isCollapsed ? t('tooltipExpand') : t('tooltipCollapse'));
        btn.setAttribute('data-i18n-tooltip', isCollapsed ? 'tooltipExpand' : 'tooltipCollapse');
        
        // Immediately show the new tooltip text if currently hovered
        if (tooltipEl.classList.contains('active')) {
            tooltipEl.textContent = isCollapsed ? t('tooltipExpand') : t('tooltipCollapse');
        }
        
        await saveConfigData();
    });

    // Portal Tooltip Event Listeners using event delegation
    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (target) {
            showTooltip(e, target.getAttribute('data-tooltip'));
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (tooltipEl.classList.contains('active')) {
            positionTooltip(e);
        }
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (target) {
            hideTooltip();
        }
    });

    // Preset date buttons click
    const presetBtns = document.querySelectorAll('#single-framework-card .preset-btn');
    presetBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const days = parseInt(e.target.getAttribute('data-days'));
            presetBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            singleFwState.activePreset = days;
            
            const today = new Date();
            const start = new Date();
            start.setDate(today.getDate() - (days - 1));
            
            singleFwState.startDate = formatDateToYYYYMMDD(start);
            singleFwState.endDate = formatDateToYYYYMMDD(today);
            
            document.getElementById('fw-start-date').value = singleFwState.startDate;
            document.getElementById('fw-end-date').value = singleFwState.endDate;
            
            renderSingleFrameworkSection();
        });
    });

    // Custom date picker inputs change
    const startDateInput = document.getElementById('fw-start-date');
    const endDateInput = document.getElementById('fw-end-date');
    
    const handleCustomDateChange = () => {
        const startVal = startDateInput.value;
        const endVal = endDateInput.value;
        
        if (startVal && endVal) {
            singleFwState.startDate = startVal;
            singleFwState.endDate = endVal;
            singleFwState.activePreset = null;
            
            // De-select preset buttons
            presetBtns.forEach(b => b.classList.remove('active'));
            
            renderSingleFrameworkSection();
        }
    };
    
    startDateInput.addEventListener('change', () => {
        const startVal = startDateInput.value;
        if (startVal) {
            endDateInput.min = startVal;
            if (endDateInput.value && endDateInput.value < startVal) {
                endDateInput.value = startVal;
            }
        }
        handleCustomDateChange();
    });
    
    endDateInput.addEventListener('change', () => {
        const endVal = endDateInput.value;
        if (endVal) {
            startDateInput.max = endVal;
            if (startDateInput.value && startDateInput.value > endVal) {
                startDateInput.value = endVal;
            }
        }
        handleCustomDateChange();
    });

    // Framework tab switching click using delegation
    document.getElementById('fw-tabs-container').addEventListener('click', (e) => {
        const tab = e.target.closest('.fw-tab-btn');
        if (!tab) return;
        
        const fw = tab.getAttribute('data-fw');
        singleFwState.selectedFw = fw;
        
        const tabBtns = document.querySelectorAll('#fw-tabs-container .fw-tab-btn');
        tabBtns.forEach(btn => btn.classList.remove('active'));
        tab.classList.add('active');
        
        renderSingleFrameworkSection();
    });
}

// Save all configurations (prices, multiplier, excludes, lang)
async function saveConfigData() {
    const models = {};

    // Find all model pricing cards and gather values
    const cards = modelsListContainer.querySelectorAll('.model-pricing-card');
    cards.forEach(card => {
        const modelName = card.getAttribute('data-model');
        const inputVal = parseFloat(card.querySelector('.price-input-input').value) || 0.0;
        const outputVal = parseFloat(card.querySelector('.price-input-output').value) || 0.0;
        const cacheReadVal = parseFloat(card.querySelector('.price-input-cacheRead').value) || 0.0;
        const cacheCreateVal = parseFloat(card.querySelector('.price-input-cacheCreate').value) || 0.0;
        const multiplierVal = parseFloat(card.querySelector('.price-input-multiplier').value) || 1.0;

        models[modelName] = {
            input: inputVal,
            output: outputVal,
            cacheRead: cacheReadVal,
            cacheCreate: cacheCreateVal,
            multiplier: multiplierVal
        };
    });

    // Gather exclude paths
    const excludePathsText = excludePathsInput.value;
    const excludePaths = excludePathsText.split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0);

    const payload = {
        exclude_paths: excludePaths,
        lang: document.getElementById('lang-select').value,
        sidebar_collapsed: document.getElementById('config-sidebar').classList.contains('collapsed'),
        models: models
    };

    try {
        const response = await fetch('/api/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (result.success) {
            // Reload stats and apply recalculation
            await fetchStats();
        } else {
            alert('保存失败: ' + result.error);
        }
    } catch (error) {
        console.error('Error saving config:', error);
        alert('保存配置出错');
    }
}

// Tooltip position helpers
function showTooltip(e, text) {
    if (!text) return;
    tooltipEl.textContent = text;
    tooltipEl.classList.add('active');
    positionTooltip(e);
}

function positionTooltip(e) {
    const offset = 15;
    let x = e.pageX + offset;
    let y = e.pageY + offset;

    const tooltipWidth = tooltipEl.offsetWidth;
    const tooltipHeight = tooltipEl.offsetHeight;
    const pageWidth = window.innerWidth + window.scrollX;
    const pageHeight = window.innerHeight + window.scrollY;

    if (x + tooltipWidth > pageWidth) {
        x = e.pageX - tooltipWidth - offset;
    }
    if (y + tooltipHeight > pageHeight) {
        y = e.pageY - tooltipHeight - offset;
    }

    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top = `${y}px`;
}

function hideTooltip() {
    tooltipEl.classList.remove('active');
}

// Fetch stats and configurations
async function fetchStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        
        appData.sessions = data.sessions || [];
        appData.config = data.config || { exclude_paths: [], lang: 'zh-CN', models: {} };
        const availableLanguages = data.languages || ['zh-CN', 'en-US'];
        
        // Fetch translation dictionary
        const lang = appData.config.lang || 'zh-CN';
        try {
            const langResponse = await fetch(`/lang/${lang}.json`);
            translations = await langResponse.json();
        } catch (err) {
            console.error('Failed to load translations for ' + lang + ', fallback to local keys', err);
            translations = {};
        }

        // Render Language Dropdown
        renderLanguageDropdown(availableLanguages, lang);

        // Translate static HTML items
        applyTranslations();

        // Apply Sidebar Collapsed Config
        const sidebar = document.getElementById('config-sidebar');
        const toggleBtn = document.getElementById('toggle-sidebar-btn');
        const sidebarCollapsed = appData.config.sidebar_collapsed || false;
        
        if (sidebarCollapsed) {
            sidebar.classList.add('collapsed');
            toggleBtn.setAttribute('data-tooltip', translations['tooltipExpand'] || '展开侧边栏');
            toggleBtn.setAttribute('data-i18n-tooltip', 'tooltipExpand');
        } else {
            sidebar.classList.remove('collapsed');
            toggleBtn.setAttribute('data-tooltip', translations['tooltipCollapse'] || '收起侧边栏');
            toggleBtn.setAttribute('data-i18n-tooltip', 'tooltipCollapse');
        }

        // Reset page back to 1 on reload
        sessionCurrentPage = 1;

        // Render all UI components
        renderConfigPanel();
        renderQuickStats();
        renderGlobalView();
        renderFrameworkView();
        renderProjectView();
        renderSessionView();
        renderSingleFrameworkSection();
    } catch (error) {
        console.error('Error fetching stats:', error);
    }
}

// Translation translation helper
function t(key, replacements = {}) {
    let text = translations[key] || key;
    for (const [k, v] of Object.entries(replacements)) {
        text = text.replace(`{${k}}`, v);
    }
    return text;
}

function renderLanguageDropdown(languages, selectedLang) {
    const langSelect = document.getElementById('lang-select');
    langSelect.innerHTML = languages.map(lang => 
        `<option value="${lang}" ${lang === selectedLang ? 'selected' : ''}>${lang}</option>`
    ).join('');
}

function applyTranslations() {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[key]) {
            el.textContent = translations[key];
        }
    });

    const tooltipElements = document.querySelectorAll('[data-i18n-tooltip]');
    tooltipElements.forEach(el => {
        const key = el.getAttribute('data-i18n-tooltip');
        if (translations[key]) {
            el.setAttribute('data-tooltip', translations[key]);
        }
    });
}

// Format numbers
function formatNumber(num) {
    return new Intl.NumberFormat('zh-CN').format(num);
}

// Format cost
function formatCost(cost) {
    if (cost === 0) return '$0.00';
    return `$${cost.toFixed(4)}`;
}

// Calculate Cache Hit Rate
function calculateHitRate(input, cacheRead, cacheWrite = 0) {
    const totalInput = input + cacheRead + cacheWrite;
    if (totalInput === 0) return '0.0%';
    return ((cacheRead / totalInput) * 100).toFixed(1) + '%';
}

// Check if a path matches a wildcard pattern (e.g. "C:\Users\*\Codex\*" or specific directory)
function pathMatchesPattern(path, pattern) {
    if (!path || !pattern) return false;
    
    const normPath = path.replace(/\\/g, '/').trim().toLowerCase();
    const normPattern = pattern.replace(/\\/g, '/').trim().toLowerCase();
    
    if (normPattern.includes('*')) {
        const escaped = normPattern.replace(/[-\/\\^$+.()|[\]{}]/g, '\\$&');
        const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
        try {
            const regex = new RegExp(regexStr);
            return regex.test(normPath);
        } catch (e) {
            const prefix = normPattern.split('*')[0];
            return normPath.startsWith(prefix);
        }
    } else {
        return normPath === normPattern;
    }
}

// Tooltip breakdown generator
function getTooltipBreakdown(modelBreakdown) {
    let tooltip = '';
    let totalComputed = 0;
    
    for (const [model, stats] of Object.entries(modelBreakdown)) {
        const pricing = appData.config.models[model] || { input: 0.0, output: 0.0, cacheRead: 0.0, cacheCreate: 0.0, multiplier: 1.0 };
        const multiplier = pricing.multiplier !== undefined ? pricing.multiplier : 1.0;

        const inCost = (stats.input_tokens * pricing.input) / 1e6;
        const outCost = (stats.output_tokens * pricing.output) / 1e6;
        const crCost = (stats.cache_read_tokens * pricing.cacheRead) / 1e6;
        const ccCost = (stats.cache_write_tokens * pricing.cacheCreate) / 1e6;
        const modelTotal = (inCost + outCost + crCost + ccCost) * multiplier;
        totalComputed += modelTotal;
        
        tooltip += `${t('model')}: ${model}\n`;
        tooltip += `  ${t('input')}: ${formatNumber(stats.input_tokens)} * $${pricing.input}/1M = $${inCost.toFixed(5)}\n`;
        tooltip += `  ${t('output')}: ${formatNumber(stats.output_tokens)} * $${pricing.output}/1M = $${outCost.toFixed(5)}\n`;
        if (stats.cache_read_tokens > 0) {
            tooltip += `  ${t('cacheReadLabel')}: ${formatNumber(stats.cache_read_tokens)} * $${pricing.cacheRead}/1M = $${crCost.toFixed(5)}\n`;
        }
        if (stats.cache_write_tokens > 0) {
            tooltip += `  ${t('cacheWriteLabel')}: ${formatNumber(stats.cache_write_tokens)} * $${pricing.cacheCreate}/1M = $${ccCost.toFixed(5)}\n`;
        }
        tooltip += `  ${t('modelMultiplier')}: ${multiplier}\n`;
        tooltip += `  ${t('modelSubtotal')}: $${modelTotal.toFixed(5)}\n\n`;
    }
    
    tooltip += `${t('totalAmount')}: $${totalComputed.toFixed(4)}`;
    return tooltip;
}

// Rendering Configuration
function renderConfigPanel() {
    // Fill exclude paths textarea
    excludePathsInput.value = (appData.config.exclude_paths || []).join('\n');

    const models = appData.config.models || {};
    const sortedModelNames = Object.keys(models).sort();
    
    if (sortedModelNames.length === 0) {
        modelsListContainer.innerHTML = `<div class="loading-small">${t('noModelRecord')}</div>`;
        return;
    }
    
    let html = '';
    sortedModelNames.forEach(modelName => {
        const pricing = models[modelName];
        const multiplier = pricing.multiplier !== undefined ? pricing.multiplier : 1.0;
        html += `
            <div class="model-pricing-card" data-model="${modelName}">
                <h4>${modelName}</h4>
                <div class="price-inputs-grid">
                    <div class="price-input-subgroup">
                        <label>${t('inputPrice')}</label>
                        <input type="number" class="price-input-input" step="0.0001" min="0" value="${pricing.input}">
                    </div>
                    <div class="price-input-subgroup">
                        <label>${t('outputPrice')}</label>
                        <input type="number" class="price-input-output" step="0.0001" min="0" value="${pricing.output}">
                    </div>
                    <div class="price-input-subgroup">
                        <label>${t('cacheReadPrice')}</label>
                        <input type="number" class="price-input-cacheRead" step="0.0001" min="0" value="${pricing.cacheRead}">
                    </div>
                    <div class="price-input-subgroup">
                        <label>${t('cacheCreatePrice')}</label>
                        <input type="number" class="price-input-cacheCreate" step="0.0001" min="0" value="${pricing.cacheCreate}">
                    </div>
                    <div class="price-input-subgroup full-width">
                        <label>${t('multiplier')}</label>
                        <input type="number" class="price-input-multiplier" step="0.01" min="0" value="${multiplier}">
                    </div>
                </div>
            </div>
        `;
    });
    
    modelsListContainer.innerHTML = html;
}

// Render Header Cards
function renderQuickStats() {
    let totalCost = 0.0;
    let totalTokens = 0;
    
    appData.sessions.forEach(s => {
        totalCost += s.cost;
        totalTokens += s.total_tokens;
    });
    
    cardTotalCost.textContent = formatCost(totalCost);
    cardTotalTokens.textContent = formatNumber(totalTokens);
    cardTotalSessions.textContent = formatNumber(appData.sessions.length);
}

// 1. Global View
function renderGlobalView() {
    let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
    let totalCost = 0.0;
    const modelStats = {};
    
    appData.sessions.forEach(s => {
        input += s.input_tokens;
        output += s.output_tokens;
        cacheRead += s.cache_read_tokens;
        cacheWrite += s.cache_write_tokens;
        totalCost += s.cost;
        
        for (const [model, stats] of Object.entries(s.models || {})) {
            if (!modelStats[model]) {
                modelStats[model] = { tokens: 0, cost: 0.0 };
            }
            modelStats[model].tokens += stats.total_tokens;
            modelStats[model].cost += stats.cost;
        }
    });
    
    const totalTokens = input + output + cacheRead + cacheWrite;
    const hitRate = calculateHitRate(input, cacheRead, cacheWrite);
    
    // Render Tokens Table
    const tokenTableBody = document.querySelector('#global-tokens-table tbody');
    tokenTableBody.innerHTML = `
        <tr><td>${t('inputTokens')}</td><td class="text-right mono">${formatNumber(input)}</td></tr>
        <tr><td>${t('outputTokens')}</td><td class="text-right mono">${formatNumber(output)}</td></tr>
        <tr><td>${t('cacheReadTokens')}</td><td class="text-right mono">${formatNumber(cacheRead)}</td></tr>
        <tr style="color: var(--accent-olive); font-weight: 500;">
            <td>${t('cacheHitRate')}</td>
            <td class="text-right mono">${hitRate}</td>
        </tr>
        <tr><td>${t('cacheWriteTokens')}</td><td class="text-right mono">${formatNumber(cacheWrite)}</td></tr>
        <tr style="font-weight: 600; border-top: 2px solid var(--border-color)">
            <td>${t('totalTokens')}</td>
            <td class="text-right mono">${formatNumber(totalTokens)}</td>
        </tr>
    `;
    
    // Render Models Table
    const modelTableBody = document.querySelector('#global-models-table tbody');
    if (Object.keys(modelStats).length === 0) {
        modelTableBody.innerHTML = `<tr><td colspan="4" class="loading-small">${t('noModelUsage')}</td></tr>`;
        return;
    }
    
    let modelHtml = '';
    const sortedModels = Object.entries(modelStats).sort((a, b) => b[1].tokens - a[1].tokens);
    
    sortedModels.forEach(([model, stats]) => {
        const percentage = totalTokens > 0 ? (stats.tokens / totalTokens * 100).toFixed(1) + '%' : '0%';
        
        // Construct breakdown for specific model in global stats
        const dummyBreakdown = {};
        dummyBreakdown[model] = {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            total_tokens: stats.tokens,
            cost: stats.cost
        };
        // Pull actual token details by summarizing them across sessions for accurate tooltip
        appData.sessions.forEach(s => {
            if (s.models && s.models[model]) {
                dummyBreakdown[model].input_tokens += s.models[model].input_tokens || 0;
                dummyBreakdown[model].output_tokens += s.models[model].output_tokens || 0;
                dummyBreakdown[model].cache_read_tokens += s.models[model].cache_read_tokens || 0;
                dummyBreakdown[model].cache_write_tokens += s.models[model].cache_write_tokens || 0;
            }
        });
        
        const tooltip = getTooltipBreakdown(dummyBreakdown);
        
        modelHtml += `
            <tr>
                <td class="mono">${model}</td>
                <td class="text-right mono">${formatNumber(stats.tokens)}</td>
                <td class="text-right">${percentage}</td>
                <td class="text-right"><span class="cost-value" data-tooltip="${tooltip}">${formatCost(stats.cost)}</span></td>
            </tr>
        `;
    });
    
    modelTableBody.innerHTML = modelHtml;
}

// 2. Framework View
function renderFrameworkView() {
    const fwStats = {};
    
    appData.sessions.forEach(s => {
        const fw = s.framework;
        if (!fwStats[fw]) {
            fwStats[fw] = {
                sessions: 0,
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
                cost: 0.0,
                models: {}
            };
        }
        
        fwStats[fw].sessions += 1;
        fwStats[fw].input += s.input_tokens;
        fwStats[fw].output += s.output_tokens;
        fwStats[fw].cacheRead += s.cache_read_tokens;
        fwStats[fw].cacheWrite += s.cache_write_tokens;
        fwStats[fw].total += s.total_tokens;
        fwStats[fw].cost += s.cost;
        
        // Merge models for framework tooltip
        for (const [model, stats] of Object.entries(s.models || {})) {
            if (!fwStats[fw].models[model]) {
                fwStats[fw].models[model] = {
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_read_tokens: 0,
                    cache_write_tokens: 0,
                    total_tokens: 0,
                    cost: 0.0
                };
            }
            fwStats[fw].models[model].input_tokens += stats.input_tokens || 0;
            fwStats[fw].models[model].output_tokens += stats.output_tokens || 0;
            fwStats[fw].models[model].cache_read_tokens += stats.cache_read_tokens || 0;
            fwStats[fw].models[model].cache_write_tokens += stats.cache_write_tokens || 0;
            fwStats[fw].models[model].total_tokens += stats.total_tokens || 0;
            fwStats[fw].models[model].cost += stats.cost || 0.0;
        }
    });
    
    const tableBody = document.querySelector('#framework-table tbody');
    if (Object.keys(fwStats).length === 0) {
        tableBody.innerHTML = `<tr><td colspan="9" class="loading-small">${t('noData')}</td></tr>`;
        return;
    }
    
    let html = '';
    Object.entries(fwStats).forEach(([fw, stats]) => {
        const tooltip = getTooltipBreakdown(stats.models);
        const hitRate = calculateHitRate(stats.input, stats.cacheRead, stats.cacheWrite);
        html += `
            <tr>
                <td><span class="badge ${fw === 'Claude Code' ? 'badge-claude' : 'badge-codex'}">${fw}</span></td>
                <td class="text-right mono">${formatNumber(stats.sessions)}</td>
                <td class="text-right mono">${formatNumber(stats.input)}</td>
                <td class="text-right mono">${formatNumber(stats.output)}</td>
                <td class="text-right mono">${formatNumber(stats.cacheRead)}</td>
                <td class="text-right mono font-weight-500" style="color: var(--accent-olive)">${hitRate}</td>
                <td class="text-right mono">${formatNumber(stats.cacheWrite)}</td>
                <td class="text-right mono" style="font-weight: 500">${formatNumber(stats.total)}</td>
                <td class="text-right"><span class="cost-value" data-tooltip="${tooltip}">${formatCost(stats.cost)}</span></td>
            </tr>
        `;
    });
    tableBody.innerHTML = html;
}

// Path normalization for checks
function normalizePath(p) {
    if (!p) return '';
    return p.replace(/\\/g, '/').toLowerCase();
}

// 3. Project View (Glob-based Directory Exclusion)
function renderProjectView() {
    const projectStats = {};
    const excludePatterns = appData.config.exclude_paths || [];
    
    appData.sessions.forEach(s => {
        // FILTER: Check if session CWD matches any exclude patterns (applies to all agents)
        let isExcluded = false;
        for (const pattern of excludePatterns) {
            if (pathMatchesPattern(s.cwd, pattern)) {
                isExcluded = true;
                break;
            }
        }
        if (isExcluded) return;
        
        const projectKey = s.cwd || 'unknown';
        
        if (!projectStats[projectKey]) {
            projectStats[projectKey] = {
                cwd: s.cwd || 'unknown',
                sessions: 0,
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
                cost: 0.0,
                models: {}
            };
        }
        
        const p = projectStats[projectKey];
        p.sessions += 1;
        p.input += s.input_tokens;
        p.output += s.output_tokens;
        p.cacheRead += s.cache_read_tokens;
        p.cacheWrite += s.cache_write_tokens || 0;
        p.total += s.total_tokens;
        p.cost += s.cost;
        
        // Merge models for project cost tooltip
        for (const [model, stats] of Object.entries(s.models || {})) {
            if (!p.models[model]) {
                p.models[model] = {
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_read_tokens: 0,
                    cache_write_tokens: 0,
                    total_tokens: 0,
                    cost: 0.0
                };
            }
            p.models[model].input_tokens += stats.input_tokens || 0;
            p.models[model].output_tokens += stats.output_tokens || 0;
            p.models[model].cache_read_tokens += stats.cache_read_tokens || 0;
            p.models[model].cache_write_tokens += stats.cache_write_tokens || 0;
            p.models[model].total_tokens += stats.total_tokens || 0;
            p.models[model].cost += stats.cost || 0.0;
        }
    });
    
    const tableBody = document.querySelector('#project-table tbody');
    if (Object.keys(projectStats).length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="loading-small">${t('noData')}</td></tr>`;
        return;
    }
    
    // Sort projects by cost desc
    const sortedProjects = Object.values(projectStats).sort((a, b) => b.cost - a.cost);
    
    let html = '';
    sortedProjects.forEach(p => {
        const tooltip = getTooltipBreakdown(p.models);
        const hitRate = calculateHitRate(p.input, p.cacheRead, p.cacheWrite);
        
        html += `
            <tr>
                <td class="path-cell" title="${p.cwd}">${p.cwd}</td>
                <td class="text-right mono">${formatNumber(p.sessions)}</td>
                <td class="text-right mono">${formatNumber(p.input)}</td>
                <td class="text-right mono">${formatNumber(p.output)}</td>
                <td class="text-right mono">${formatNumber(p.cacheRead)}</td>
                <td class="text-right mono font-weight-500" style="color: var(--accent-olive)">${hitRate}</td>
                <td class="text-right mono" style="font-weight: 500">${formatNumber(p.total)}</td>
                <td class="text-right"><span class="cost-value" data-tooltip="${tooltip}">${formatCost(p.cost)}</span></td>
            </tr>
        `;
    });
    tableBody.innerHTML = html;
}

// 4. Session View (Paginated)
function renderSessionView() {
    const tableBody = document.querySelector('#session-table tbody');
    const paginationContainer = document.getElementById('session-pagination');

    if (appData.sessions.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="loading-small">${t('noData')}</td></tr>`;
        paginationContainer.innerHTML = '';
        return;
    }
    
    // Sort by start time descending
    const sortedSessions = [...appData.sessions].sort((a, b) => {
        const timeA = a.start || a.end || '';
        const timeB = b.start || b.end || '';
        return timeB.localeCompare(timeA);
    });

    const totalSessions = sortedSessions.length;
    const totalPages = Math.ceil(totalSessions / sessionPageSize);
    
    // Boundary check for current page
    if (sessionCurrentPage < 1) sessionCurrentPage = 1;
    if (sessionCurrentPage > totalPages) sessionCurrentPage = totalPages;

    const startIndex = (sessionCurrentPage - 1) * sessionPageSize;
    const paginatedSessions = sortedSessions.slice(startIndex, startIndex + sessionPageSize);
    
    let html = '';
    paginatedSessions.forEach(s => {
        const tooltip = getTooltipBreakdown(s.models || {});
        
        // Formatting timestamp for display
        let dateStr = '未知时间';
        if (s.start) {
            try {
                const dt = new Date(s.start);
                dateStr = dt.toLocaleString('zh-CN', { hour12: false });
            } catch(e) {}
        }
        
        const hitRate = calculateHitRate(s.input_tokens, s.cache_read_tokens, s.cache_write_tokens);
        const tokensTooltip = `${t('input')}: ${formatNumber(s.input_tokens)}\n${t('output')}: ${formatNumber(s.output_tokens)}\n${t('cacheReadLabel')}: ${formatNumber(s.cache_read_tokens)}\n${t('cacheWriteLabel')}: ${formatNumber(s.cache_write_tokens || 0)}\n${t('cacheHitRateCol')}: ${hitRate}`;
            
        html += `
            <tr>
                <td style="white-space: nowrap">${dateStr}</td>
                <td><span class="badge ${s.framework === 'Claude Code' ? 'badge-claude' : 'badge-codex'}">${s.framework}</span></td>
                <td class="mono" title="${s.id}" style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.id}</td>
                <td class="path-cell" title="${s.cwd}">${s.cwd}</td>
                <td class="text-right mono"><span class="hover-detail" data-tooltip="${tokensTooltip}">${formatNumber(s.total_tokens)}</span></td>
                <td class="text-right"><span class="cost-value" data-tooltip="${tooltip}">${formatCost(s.cost)}</span></td>
            </tr>
        `;
    });
    tableBody.innerHTML = html;

    // Render Pagination Controls
    const prevText = t('prevPage');
    const nextText = t('nextPage');
    const pageText = t('pageInfo', { current: sessionCurrentPage, total: totalPages, count: totalSessions });

    paginationContainer.innerHTML = `
        <button class="pagination-btn" id="prev-page-btn" ${sessionCurrentPage === 1 ? 'disabled' : ''}>${prevText}</button>
        <span class="pagination-info">${pageText}</span>
        <button class="pagination-btn" id="next-page-btn" ${sessionCurrentPage === totalPages ? 'disabled' : ''}>${nextText}</button>
    `;

    // Bind Pagination Events
    document.getElementById('prev-page-btn').addEventListener('click', () => {
        if (sessionCurrentPage > 1) {
            sessionCurrentPage--;
            renderSessionView();
        }
    });

    document.getElementById('next-page-btn').addEventListener('click', () => {
        if (sessionCurrentPage < totalPages) {
            sessionCurrentPage++;
            renderSessionView();
        }
    });
}

// Single Framework detailed view helper functions
function initSingleFwDateRange() {
    if (!singleFwState.startDate || !singleFwState.endDate) {
        const today = new Date();
        const start = new Date();
        start.setDate(today.getDate() - 6); // Default 7d (today + 6 days ago)
        
        singleFwState.startDate = formatDateToYYYYMMDD(start);
        singleFwState.endDate = formatDateToYYYYMMDD(today);
        singleFwState.activePreset = 7;
        
        document.getElementById('fw-start-date').value = singleFwState.startDate;
        document.getElementById('fw-end-date').value = singleFwState.endDate;
    }
}

function formatDateToYYYYMMDD(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function renderSingleFrameworkSection() {
    // 1. Gather all unique frameworks from sessions
    const frameworks = [...new Set(appData.sessions.map(s => s.framework))].sort();
    
    if (frameworks.length === 0) {
        document.getElementById('single-framework-card').style.display = 'none';
        return;
    } else {
        document.getElementById('single-framework-card').style.display = 'block';
    }
    
    // 2. Default to first framework if none selected
    if (!singleFwState.selectedFw || !frameworks.includes(singleFwState.selectedFw)) {
        singleFwState.selectedFw = frameworks[0];
    }
    
    // 3. Init date range values
    initSingleFwDateRange();
    document.getElementById('fw-end-date').min = singleFwState.startDate;
    document.getElementById('fw-start-date').max = singleFwState.endDate;
    
    // 4. Render tabs
    const tabsContainer = document.getElementById('fw-tabs-container');
    tabsContainer.innerHTML = frameworks.map(fw => `
        <button class="fw-tab-btn ${fw === singleFwState.selectedFw ? 'active' : ''}" data-fw="${fw}">${fw}</button>
    `).join('');
    
    // 5. Filter sessions
    const startObj = new Date(singleFwState.startDate + 'T00:00:00');
    const endObj = new Date(singleFwState.endDate + 'T23:59:59');
    
    const fwSessions = appData.sessions.filter(s => {
        if (s.framework !== singleFwState.selectedFw) return false;
        
        const sTime = s.start || s.end || '';
        if (!sTime) return false;
        
        const sDate = new Date(sTime);
        return sDate >= startObj && sDate <= endObj;
    });
    
    // 6. Aggregate core metrics
    let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, sessionsCount = fwSessions.length, cost = 0.0;
    const modelBreakdown = {};
    
    fwSessions.forEach(s => {
        input += s.input_tokens || 0;
        output += s.output_tokens || 0;
        cacheRead += s.cache_read_tokens || 0;
        cacheWrite += s.cache_write_tokens || 0;
        cost += s.cost || 0.0;
        
        // Sum models for tooltip breakdown
        for (const [model, stats] of Object.entries(s.models || {})) {
            if (!modelBreakdown[model]) {
                modelBreakdown[model] = {
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_read_tokens: 0,
                    cache_write_tokens: 0,
                    total_tokens: 0,
                    cost: 0.0
                };
            }
            modelBreakdown[model].input_tokens += stats.input_tokens || 0;
            modelBreakdown[model].output_tokens += stats.output_tokens || 0;
            modelBreakdown[model].cache_read_tokens += stats.cache_read_tokens || 0;
            modelBreakdown[model].cache_write_tokens += stats.cache_write_tokens || 0;
            modelBreakdown[model].total_tokens += stats.total_tokens || 0;
            modelBreakdown[model].cost += stats.cost || 0.0;
        }
    });
    
    // Render stats card values
    document.getElementById('fw-stat-input').textContent = formatNumber(input);
    document.getElementById('fw-stat-output').textContent = formatNumber(output);
    document.getElementById('fw-stat-cache-read').textContent = formatNumber(cacheRead);
    document.getElementById('fw-stat-cache-write').textContent = formatNumber(cacheWrite);
    
    const hitRateStr = calculateHitRate(input, cacheRead, cacheWrite);
    document.getElementById('fw-stat-hit-rate').textContent = hitRateStr;
    document.getElementById('fw-stat-hit-rate-fill').style.width = hitRateStr;
    
    const costEl = document.getElementById('fw-stat-cost');
    costEl.textContent = formatCost(cost);
    
    // Attach model cost detail breakdown to tooltip
    const tooltipText = getTooltipBreakdown(modelBreakdown);
    costEl.setAttribute('data-tooltip', tooltipText);
    
    document.getElementById('fw-stat-sessions-count').textContent = `${formatNumber(sessionsCount)} ${t('sessions')}`;
    
    // 7. Render trend chart
    renderTrendChart(fwSessions, startObj, endObj);
}

function renderTrendChart(sessions, startDate, endDate) {
    const dateLabels = [];
    const dateKeys = [];
    
    let current = new Date(startDate);
    const end = new Date(endDate);
    while (current <= end) {
        const yyyy = current.getFullYear();
        const mm = String(current.getMonth() + 1).padStart(2, '0');
        const dd = String(current.getDate()).padStart(2, '0');
        const key = `${yyyy}-${mm}-${dd}`;
        dateKeys.push(key);
        dateLabels.push(`${mm}/${dd}`);
        current.setDate(current.getDate() + 1);
    }
    
    // Daily aggregations
    const dailyData = {};
    dateKeys.forEach(k => {
        dailyData[k] = {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0.0
        };
    });
    
    sessions.forEach(s => {
        const sTime = s.start || s.end || '';
        if (!sTime) return;
        
        const dt = new Date(sTime);
        const yyyy = dt.getFullYear();
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const dd = String(dt.getDate()).padStart(2, '0');
        const key = `${yyyy}-${mm}-${dd}`;
        
        if (dailyData[key]) {
            dailyData[key].input += s.input_tokens || 0;
            dailyData[key].output += s.output_tokens || 0;
            dailyData[key].cacheRead += s.cache_read_tokens || 0;
            dailyData[key].cacheWrite += s.cache_write_tokens || 0;
            dailyData[key].cost += s.cost || 0.0;
        }
    });
    
    const inputDataset = [];
    const outputDataset = [];
    const cacheReadDataset = [];
    const cacheWriteDataset = [];
    const costDataset = [];
    
    dateKeys.forEach(k => {
        inputDataset.push(dailyData[k].input);
        outputDataset.push(dailyData[k].output);
        cacheReadDataset.push(dailyData[k].cacheRead);
        cacheWriteDataset.push(dailyData[k].cacheWrite);
        costDataset.push(dailyData[k].cost);
    });
    
    if (frameworkTrendChartInstance) {
        frameworkTrendChartInstance.destroy();
    }
    
    const chartCanvas = document.getElementById('framework-trend-chart');
    if (!chartCanvas) return;
    
    const ctx = chartCanvas.getContext('2d');
    
    // Create soft gradients matching Morandi aesthetic
    const createGradient = (color1, color2) => {
        const grad = ctx.createLinearGradient(0, 0, 0, 300);
        grad.addColorStop(0, color1);
        grad.addColorStop(1, color2);
        return grad;
    };
    
    const inputGrad = createGradient('rgba(147, 162, 176, 0.25)', 'rgba(147, 162, 176, 0.01)'); // 雾霾蓝
    const outputGrad = createGradient('rgba(184, 163, 143, 0.25)', 'rgba(184, 163, 143, 0.01)'); // 暖灰褐
    const readGrad = createGradient('rgba(138, 154, 134, 0.25)', 'rgba(138, 154, 134, 0.01)'); // 灰绿
    const writeGrad = createGradient('rgba(196, 154, 136, 0.25)', 'rgba(196, 154, 136, 0.01)'); // 陶土红
    
    frameworkTrendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dateLabels,
            datasets: [
                {
                    label: t('input') || 'Input',
                    data: inputDataset,
                    borderColor: '#93a2b0', // 雾霾蓝
                    backgroundColor: inputGrad,
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2.5,
                    yAxisID: 'y'
                },
                {
                    label: t('output') || 'Output',
                    data: outputDataset,
                    borderColor: '#b8a38f', // 暖灰褐
                    backgroundColor: outputGrad,
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2.5,
                    yAxisID: 'y'
                },
                {
                    label: t('cacheReadLabel') || 'Cache Read',
                    data: cacheReadDataset,
                    borderColor: '#8a9a86', // 灰绿
                    backgroundColor: readGrad,
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2.5,
                    yAxisID: 'y'
                },
                {
                    label: t('cacheWriteLabel') || 'Cache Write',
                    data: cacheWriteDataset,
                    borderColor: '#c49a88', // 陶土红
                    backgroundColor: writeGrad,
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2.5,
                    yAxisID: 'y'
                },
                {
                    label: (t('totalCost') || 'Cost') + ' (USD)',
                    data: costDataset,
                    borderColor: '#d06a4c', // 陶土红偏深突出
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.4,
                    borderWidth: 2.5,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            elements: {
                point: {
                    radius: 0,
                    hoverRadius: 5
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        boxHeight: 12,
                        font: {
                            family: 'var(--font-sans)',
                            size: 11
                        },
                        color: 'var(--text-secondary)'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(60, 64, 61, 0.95)',
                    titleColor: '#ffffff',
                    bodyColor: '#e3e2de',
                    titleFont: {
                        family: 'var(--font-sans)',
                        weight: 'bold'
                    },
                    bodyFont: {
                        family: 'var(--font-sans)'
                    },
                    padding: 10,
                    borderRadius: 6,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.dataset.yAxisID === 'y1') {
                                label += '$' + context.parsed.y.toFixed(6);
                            } else {
                                label += formatNumber(context.parsed.y);
                            }
                            return label;
                        },
                        afterBody: function(tooltipItems) {
                            if (!tooltipItems.length) return '';
                            const dataIndex = tooltipItems[0].dataIndex;
                            const inputVal = inputDataset[dataIndex] || 0;
                            const readVal = cacheReadDataset[dataIndex] || 0;
                            const totalInput = inputVal + readVal;
                            const rate = totalInput > 0 ? ((readVal / totalInput) * 100).toFixed(1) + '%' : '0.0%';
                            return '\n' + (translations['cacheHitRateCol'] || 'Cache Hit Rate') + ': ' + rate;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: 'var(--text-secondary)',
                        font: {
                            family: 'var(--font-sans)',
                            size: 10
                        }
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Tokens',
                        color: 'var(--text-secondary)',
                        font: {
                            family: 'var(--font-sans)',
                            size: 11,
                            weight: 500
                        }
                    },
                    grid: {
                        color: '#f0ede9'
                    },
                    ticks: {
                        color: 'var(--text-secondary)',
                        font: {
                            family: 'var(--font-sans)',
                            size: 10
                        },
                        callback: function(value) {
                            if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M';
                            if (value >= 1e3) return (value / 1e3).toFixed(0) + 'k';
                            return value;
                        }
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Cost (USD)',
                        color: 'var(--text-secondary)',
                        font: {
                            family: 'var(--font-sans)',
                            size: 11,
                            weight: 500
                        }
                    },
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        color: 'var(--text-secondary)',
                        font: {
                            family: 'var(--font-sans)',
                            size: 10
                        },
                        callback: function(value) {
                            return '$' + value.toFixed(4);
                        }
                    }
                }
            }
        }
    });
}

