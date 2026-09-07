const worker = new Worker('worker.js');

// UI Elements
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const dropZone = document.getElementById('drop-zone');
const fileUpload = document.getElementById('file-upload');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const chatHistory = document.getElementById('chat-history');
const insightsContent = document.getElementById('insights-content');
const plotContainer = document.getElementById('plot-container');
const agentThinking = document.getElementById('agent-thinking');
const datasetInfo = document.getElementById('dataset-info');
const rowCountEl = document.getElementById('row-count');
const colCountEl = document.getElementById('col-count');

// State
let isEngineReady = false;
let hasData = false;

// Worker Message Handler
worker.onmessage = function(e) {
    const { type, data, error } = e.data;

    if (error) {
        console.error("Worker Error:", error);
        appendChatMessage("System", `Error: ${error}`, true);
        setStatus("Error", "red");
        agentThinking.classList.add('hidden');
        return;
    }

    switch(type) {
        case 'INIT_STATUS':
            statusText.textContent = data.message;
            if (data.status === 'ready') {
                isEngineReady = true;
                setStatus("Engine Ready", "green");
                if (hasData) enableChat();
            }
            break;
            
        case 'DATA_PROFILED':
            hasData = true;
            datasetInfo.classList.remove('hidden');
            rowCountEl.textContent = data.rows;
            colCountEl.textContent = data.cols;
            insightsContent.textContent = data.summary;
            if (isEngineReady) enableChat();
            
            // Render initial plot if any
            if (data.plot) {
                renderPlot(data.plot);
            }
            
            setStatus("Data Loaded", "green");
            break;

        case 'CHAT_RESPONSE':
            agentThinking.classList.add('hidden');
            appendChatMessage("Agent", data.text);
            
            if (data.insights) {
                insightsContent.textContent = data.insights;
            }
            if (data.plot) {
                renderPlot(data.plot);
            }
            break;
    }
};

// UI Helpers
function setStatus(text, color) {
    statusText.textContent = text;
    statusIndicator.className = `w-2 h-2 rounded-full bg-${color}-500`;
}

function enableChat() {
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.placeholder = "Ask me to analyze the data, find predictors, or train a model...";
}

function appendChatMessage(sender, text, isError = false) {
    const div = document.createElement('div');
    div.className = 'flex gap-2 ' + (sender === 'User' ? 'justify-end' : '');
    
    let innerClass = sender === 'User' 
        ? 'bg-blue-600 text-white rounded-lg rounded-tr-none' 
        : (isError ? 'bg-red-900 text-red-100 rounded-lg rounded-tl-none' : 'bg-gray-700 text-gray-100 rounded-lg rounded-tl-none');
    
    div.innerHTML = `
        <div class="${innerClass} p-3 text-sm max-w-[90%] whitespace-pre-wrap">${text}</div>
    `;
    
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

function renderPlot(plotDataJSON) {
    try {
        const plotData = JSON.parse(plotDataJSON);
        plotContainer.innerHTML = ''; // Clear
        Plotly.newPlot(plotContainer, plotData.data, {
            ...plotData.layout,
            paper_bgcolor: '#111827',
            plot_bgcolor: '#111827',
            font: { color: '#9CA3AF' }
        }, {responsive: true});
    } catch (e) {
        console.error("Plotly render error", e);
    }
}

// Event Listeners
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, highlight, false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, unhighlight, false);
});

function highlight(e) {
    dropZone.classList.add('border-blue-500', 'bg-gray-750');
}

function unhighlight(e) {
    dropZone.classList.remove('border-blue-500', 'bg-gray-750');
}

dropZone.addEventListener('drop', handleDrop, false);
fileUpload.addEventListener('change', (e) => handleFiles(e.target.files));

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    handleFiles(files);
}

function handleFiles(files) {
    if (files.length === 0) return;
    const file = files[0];
    
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
        alert("Please upload a CSV file.");
        return;
    }

    setStatus("Reading File...", "yellow");
    const reader = new FileReader();
    reader.onload = (e) => {
        const csvContent = e.target.result;
        setStatus("Processing Data...", "yellow");
        worker.postMessage({ type: 'PROCESS_CSV', data: csvContent });
    };
    reader.readAsText(file);
}

// Chat Listeners
function handleSendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    
    appendChatMessage("User", text);
    chatInput.value = '';
    
    agentThinking.classList.remove('hidden');
    worker.postMessage({ type: 'CHAT_REQUEST', data: text });
}

sendBtn.addEventListener('click', handleSendChat);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSendChat();
});
