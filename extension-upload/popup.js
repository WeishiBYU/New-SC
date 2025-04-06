// Global variables for stopwatch (local UI display only)
let stopwatchInterval;
let stopwatchRunning = false;
let elapsedTime = 0;
let localUpdateInterval;

// Global variable for counters
let counters = [];

// Flag to track if data has been modified
let dataModified = false;

// Initialize the Chart.js chart
let counterChart = null;

// DOM Elements
document.addEventListener('DOMContentLoaded', async function() {
  // Load data from IndexedDB
  await loadData();

  // Initialize UI elements
  initializeTabs();
  initializeStopwatch();
  initializeCounters();
  initializeChartDisplay();
  
  // Set up event listeners
  document.getElementById('start-stop').addEventListener('click', toggleStopwatch);
  document.getElementById('reset').addEventListener('click', resetStopwatch);
  document.getElementById('add-counter').addEventListener('click', addCounter);
  document.getElementById('export-csv').addEventListener('click', exportToCSV);
  document.getElementById('save-session').addEventListener('click', saveSession);
  document.getElementById('view-history').addEventListener('click', viewSessionHistory);
  document.getElementById('chart-type').addEventListener('change', changeChartType);
  document.getElementById('compare-chart').addEventListener('click', showComparisonChart);
  
  // Close button for history modal
  const closeModal = document.getElementById('close-modal');
  if (closeModal) {
    closeModal.addEventListener('click', function() {
      document.getElementById('history-modal').classList.add('hidden');
    });
  }
  
  // Add event delegation for counter buttons
  document.getElementById('counters-container').addEventListener('click', handleCounterButtonClick);
  
  // Listen for popup closing to save data
  window.addEventListener('beforeunload', function() {
    if (dataModified) {
      saveData();
    }
  });
});

// Event delegation handler for counter buttons
function handleCounterButtonClick(event) {
  const target = event.target;
  // Find closest counter item to get index
  const counterItem = target.closest('.counter-item');
  if (!counterItem) return;
  
  const index = parseInt(counterItem.getAttribute('data-index'));
  
  if (target.classList.contains('increment')) {
    incrementCounter(index);
  } else if (target.classList.contains('decrement')) {
    decrementCounter(index);
  } else if (target.classList.contains('delete')) {
    deleteCounter(index);
  }
}

// Initialize tabs functionality
function initializeTabs() {
  const tabs = document.querySelectorAll('.tab');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs
      tabs.forEach(t => t.classList.remove('active'));
      
      // Add active class to clicked tab
      tab.classList.add('active');
      
      // Hide all tab content
      const tabContents = document.querySelectorAll('.tab-content');
      tabContents.forEach(content => content.classList.add('hidden'));
      
      // Show selected tab content
      const tabName = tab.getAttribute('data-tab');
      const selectedContent = document.getElementById(`${tabName}-section`);
      if (selectedContent) {
        selectedContent.classList.remove('hidden');
      }
      
      // If chart tab is selected, update the chart
      if (tabName === 'charts') {
        updateChart();
      }
    });
  });
}

// Load saved data from background script and IndexedDB
async function loadData() {
  try {
    // Check if we're in a Chrome extension environment
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      // Load stopwatch state from background script
      chrome.runtime.sendMessage({ action: 'getStopwatchState' }, function(response) {
        if (response) {
          console.log('Got stopwatch state from background:', response);
          elapsedTime = response.elapsedTime || 0;
          stopwatchRunning = response.running || false;
          
          // Update the UI
          updateStopwatchDisplay();
          
          // Set up local update interval to keep the UI in sync with background
          if (localUpdateInterval) {
            clearInterval(localUpdateInterval);
          }
          
          if (stopwatchRunning) {
            localUpdateInterval = setInterval(updateStopwatchDisplay, 100);
            document.getElementById('start-stop').textContent = 'Stop';
            document.getElementById('start-stop').classList.remove('start');
            document.getElementById('start-stop').classList.add('stop');
            document.getElementById('stopwatch-display').classList.add('running');
          }
          
          // Update background running indicator
          updateBackgroundIndicator();
        }
      });
    }
    
    // Load counters using the Database API if available
    if (typeof Database !== 'undefined' && Database.Counters) {
      try {
        const countersResult = await Database.Counters.loadCounters();
        
        if (countersResult && countersResult.length > 0) {
          console.log('Loaded counters from Database API:', countersResult);
          counters = countersResult;
          renderCounters();
          updateChart();
        } else {
          console.log('No counters found in database');
          counters = [];
        }
      } catch (dbError) {
        console.error('Error loading counters with Database API:', dbError);
        
        // Fallback to direct IndexedDB if Database API fails
        const db = await openDatabase();
        const countersTx = db.transaction(['counters'], 'readonly');
        const countersStore = countersTx.objectStore('counters');
        const countersResult = await countersStore.getAll();
        
        if (countersResult && countersResult.length > 0) {
          console.log('Loaded counters from direct IndexedDB:', countersResult);
          counters = countersResult;
          renderCounters();
          updateChart();
        } else {
          console.log('No counters found in database');
          counters = [];
        }
      }
    } else {
      // Fallback to direct IndexedDB if Database API is not available
      const db = await openDatabase();
      const countersTx = db.transaction(['counters'], 'readonly');
      const countersStore = countersTx.objectStore('counters');
      const countersResult = await countersStore.getAll();
      
      if (countersResult && countersResult.length > 0) {
        console.log('Loaded counters from direct IndexedDB:', countersResult);
        counters = countersResult;
        renderCounters();
        updateChart();
      } else {
        console.log('No counters found in database');
        counters = [];
      }
    }
    
    // Reset the modified flag since we just loaded
    dataModified = false;
    
    // Return a resolved promise when done
    return Promise.resolve();
  } catch (error) {
    console.error('Error loading data:', error);
    return Promise.reject(error);
  }
}

// Save data to IndexedDB
async function saveData() {
  try {
    console.log('Saving counters to database:', counters);
    
    // Use the proper Database API from database.js if available
    if (typeof Database !== 'undefined' && Database.Counters) {
      await Database.Counters.saveCounters(counters);
      console.log('Counters saved using Database API');
    } else {
      // Fallback to direct IndexedDB operations if Database API is not available
      const db = await openDatabase();
      
      // Clear existing counters
      const clearTx = db.transaction(['counters'], 'readwrite');
      const counterStore = clearTx.objectStore('counters');
      await counterStore.clear();
      
      // Wait for clear to complete
      await new Promise((resolve, reject) => {
        clearTx.oncomplete = () => resolve();
        clearTx.onerror = (event) => reject(event.target.error);
      });
      
      // Save each counter
      const tx = db.transaction(['counters'], 'readwrite');
      const store = tx.objectStore('counters');
      
      if (counters && counters.length > 0) {
        for (const counter of counters) {
          await store.add(counter);
        }
      }
      
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => {
          console.log('Counters saved successfully via direct IndexedDB');
          resolve();
        };
        tx.onerror = (event) => {
          console.error('Error in transaction:', event.target.error);
          reject(event.target.error);
        };
      });
    }
    
    // Reset the modified flag
    dataModified = false;
    return Promise.resolve();
  } catch (error) {
    console.error('Error saving data:', error);
    return Promise.reject(error);
  }
}

// Show save session modal and handle session saving
async function saveSession() {
  try {
    const modal = document.getElementById('save-session-modal');
    const timeDisplay = document.getElementById('session-time-display');
    const countersSummary = document.getElementById('session-counters-summary');
    const sessionNameInput = document.getElementById('session-name');
    
    // Display current session details
    const hours = Math.floor(elapsedTime / 3600000).toString().padStart(2, '0');
    const minutes = Math.floor((elapsedTime % 3600000) / 60000).toString().padStart(2, '0');
    const seconds = Math.floor((elapsedTime % 60000) / 1000).toString().padStart(2, '0');
    
    timeDisplay.innerHTML = `
      <strong>Elapsed Time:</strong> ${hours}:${minutes}:${seconds}
    `;
    
    countersSummary.innerHTML = `
      <strong>Counters:</strong><br>
      ${counters.map(counter => `${counter.name}: ${counter.value}`).join('<br>')}
    `;
    
    // Set default session name
    const defaultName = `Session ${new Date().toLocaleString()}`;
    sessionNameInput.value = defaultName;
    sessionNameInput.select();
    
    // Show modal
    modal.classList.remove('hidden');
    
    // Handle save button click
    const handleSave = async () => {
      const sessionName = sessionNameInput.value.trim() || defaultName;
      const timestamp = new Date().toISOString();
      
      const sessionData = {
        id: timestamp,
        date: timestamp,
        name: sessionName,
        elapsedTime: elapsedTime,
        counters: JSON.parse(JSON.stringify(counters))
      };
      
      try {
        // Use Database API instead of direct IndexedDB
        await Database.Sessions.saveSession(sessionData);
        modal.classList.add('hidden');
        alert('Session saved successfully!');
      } catch (error) {
        console.error('Error saving session:', error);
        alert('Error saving session: ' + error.message);
      }
    };
    
    // Add event listeners
    const confirmButton = document.getElementById('confirm-save-session');
    const cancelButton = document.getElementById('cancel-save-session');
    
    // Remove existing listeners if any
    const newConfirmButton = confirmButton.cloneNode(true);
    const newCancelButton = cancelButton.cloneNode(true);
    confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);
    cancelButton.parentNode.replaceChild(newCancelButton, cancelButton);
    
    // Add new listeners
    newConfirmButton.addEventListener('click', handleSave);
    newCancelButton.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
    
    // Handle Enter key in input
    sessionNameInput.addEventListener('keyup', (event) => {
      if (event.key === 'Enter') {
        handleSave();
      }
    });
    
  } catch (error) {
    console.error('Error showing save session modal:', error);
    alert('Error showing save session modal: ' + error.message);
  }
}

// Show session history with enhanced functionality
async function viewSessionHistory() {
  try {
    const modal = document.getElementById('history-modal');
    const sessionList = document.getElementById('session-list');
    const sessionSearch = document.getElementById('session-search');
    const sessionSort = document.getElementById('session-sort');
    const sessionActions = document.getElementById('session-actions');
    const modalContent = modal.querySelector('.history-modal-content');
    
    // Reset modal state
    modalContent.style.transform = 'scale(0.95)';
    modalContent.style.opacity = '0';
    
    // Clear previous content
    sessionList.innerHTML = '';
    
    // Show modal first
    modal.classList.remove('hidden');
    
    // Load all sessions
    const sessions = await Database.Sessions.loadSessions();
    
    if (!sessions || sessions.length === 0) {
      sessionList.innerHTML = '<li class="empty-message">No saved sessions found.</li>';
    } else {
      // Function to render sessions
      const renderSessions = (sessionsToRender) => {
        sessionList.innerHTML = '';
        sessionsToRender.forEach(session => {
          const li = document.createElement('li');
          li.className = 'session-item';
          li.setAttribute('data-id', session.id);
          
          // Format times
          const hours = Math.floor(session.elapsedTime / 3600000).toString().padStart(2, '0');
          const minutes = Math.floor((session.elapsedTime % 3600000) / 60000).toString().padStart(2, '0');
          const seconds = Math.floor((session.elapsedTime % 60000) / 1000).toString().padStart(2, '0');
          const date = new Date(session.date);
          
          // Generate counter summary
          const counterSummary = session.counters && session.counters.length > 0 
            ? session.counters.map(counter => `${counter.name}: ${counter.value}`).join(', ')
            : 'No counters';
          
          li.innerHTML = `
            <strong>${session.name}</strong><br>
            Time: ${hours}:${minutes}:${seconds}<br>
            Date: ${date.toLocaleString()}<br>
            Counters: ${counterSummary}
          `;
          
          // Handle session selection
          li.addEventListener('click', (e) => {
            // Remove selected class from all items
            document.querySelectorAll('.session-item').forEach(item => 
              item.classList.remove('selected'));
            
            // Add selected class to clicked item
            li.classList.add('selected');
            
            // Show actions
            sessionActions.classList.remove('hidden');
            sessionActions.setAttribute('data-selected-id', session.id);
          });
          
          // Double click to load
          li.addEventListener('dblclick', () => loadSession(session));
          
          sessionList.appendChild(li);
        });
      };
      
      // Initial render
      renderSessions(sessions);
      
      // Search functionality
      sessionSearch.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const filteredSessions = sessions.filter(session => 
          session.name.toLowerCase().includes(searchTerm) ||
          new Date(session.date).toLocaleString().toLowerCase().includes(searchTerm)
        );
        renderSessions(filteredSessions);
      });
      
      // Sorting functionality
      sessionSort.addEventListener('change', (e) => {
        const sortType = e.target.value;
        const sortedSessions = [...sessions];
        
        switch (sortType) {
          case 'date-desc':
            sortedSessions.sort((a, b) => new Date(b.date) - new Date(a.date));
            break;
          case 'date-asc':
            sortedSessions.sort((a, b) => new Date(a.date) - new Date(b.date));
            break;
          case 'name':
            sortedSessions.sort((a, b) => a.name.localeCompare(b.name));
            break;
        }
        
        renderSessions(sortedSessions);
      });
    }

    // Show animation after a brief delay
    requestAnimationFrame(() => {
      modalContent.style.transform = 'scale(1)';
      modalContent.style.opacity = '1';
    });
    
  } catch (error) {
    console.error('Error loading sessions:', error);
    alert('Error loading sessions: ' + error.message);
  }
}

// Load a saved session
async function loadSession(session) {
  try {
    // Confirm before loading
    if (!confirm('Loading this session will replace your current data. Continue?')) {
      return;
    }
    
    // Clear existing time series data first
    await resetTimeSeriesData();
    
    // Load the session data
    elapsedTime = session.elapsedTime;
    counters = Array.isArray(session.counters) ? JSON.parse(JSON.stringify(session.counters)) : [];
    
    // Mark data as modified
    dataModified = true;
    
    // Update the UI
    updateStopwatchDisplay();
    renderCounters();
    updateChart();
    
    // If stopwatch is running, stop it
    if (stopwatchRunning) {
      chrome.runtime.sendMessage({ action: 'stopStopwatch' });
      stopwatchRunning = false;
      clearInterval(localUpdateInterval);
      document.getElementById('start-stop').textContent = 'Start';
      document.getElementById('start-stop').classList.remove('stop');
      document.getElementById('start-stop').classList.add('start');
      document.getElementById('stopwatch-display').classList.remove('running');
    }
    
    // Send to background script
    chrome.runtime.sendMessage({ 
      action: 'updateStopwatch', 
      elapsedTime: elapsedTime,
      running: false
    });
    
    // Save to IndexedDB immediately
    await saveData();
    
    // Hide the modal
    document.getElementById('history-modal').classList.add('hidden');
    
    // Show success message
    alert('Session loaded successfully!');
    
  } catch (error) {
    console.error('Error loading session:', error);
    alert('Error loading session: ' + error.message);
  }
}

// Initialize the stopwatch UI
function initializeStopwatch() {
  updateStopwatchDisplay();
  
  // Setup background running indicator
  updateBackgroundIndicator();
}

// Toggle stopwatch (start/stop)
function toggleStopwatch() {
  const startStopBtn = document.getElementById('start-stop');
  const stopwatchDisplay = document.getElementById('stopwatch-display');
  
  if (stopwatchRunning) {
    stopStopwatch();
    startStopBtn.textContent = 'Start';
    startStopBtn.classList.remove('stop');
    startStopBtn.classList.add('start');
    stopwatchDisplay.classList.remove('running');
  } else {
    startStopwatch();
    startStopBtn.textContent = 'Stop';
    startStopBtn.classList.remove('start');
    startStopBtn.classList.add('stop');
    stopwatchDisplay.classList.add('running');
  }
}

// Start the stopwatch
function startStopwatch() {
  // Tell background script to start
  chrome.runtime.sendMessage({ action: 'startStopwatch' });
  
  // Update local state
  stopwatchRunning = true;
  
  // Start local interval for UI updates
  localUpdateInterval = setInterval(updateStopwatchDisplay, 100);
  
  // Update background indicator
  updateBackgroundIndicator();
}

// Stop the stopwatch
function stopStopwatch() {
  // Tell background script to stop
  chrome.runtime.sendMessage({ action: 'stopStopwatch' });
  
  // Update local state
  stopwatchRunning = false;
  
  // Clear local interval
  if (localUpdateInterval) {
    clearInterval(localUpdateInterval);
  }
  
  // Update background indicator
  updateBackgroundIndicator();
}

// Reset the stopwatch
function resetStopwatch() {
  if (confirm('Are you sure you want to reset the stopwatch? This will also clear the time series data.')) {
    // Tell background script to reset
    chrome.runtime.sendMessage({ action: 'resetStopwatch' });
    
    // Update local state
    elapsedTime = 0;
    updateStopwatchDisplay();
    
    // Reset time series data
    resetTimeSeriesData().then(() => {
      // Update chart after time series data is cleared
      if (counterChart) {
        // Reset chart data
        counterChart.data.datasets[0].data = counters.map(counter => counter.value);
        counterChart.update();
      }
    });
    
    // If stopwatch is running, update UI accordingly
    if (stopwatchRunning) {
      stopwatchRunning = false;
      if (localUpdateInterval) {
        clearInterval(localUpdateInterval);
      }
      document.getElementById('start-stop').textContent = 'Start';
      document.getElementById('start-stop').classList.remove('stop');
      document.getElementById('start-stop').classList.add('start');
      document.getElementById('stopwatch-display').classList.remove('running');
    }
    
    // Update background indicator
    updateBackgroundIndicator();
  }
}

// Reset time series data in IndexedDB
async function resetTimeSeriesData() {
  try {
    // Try to use Database API first
    if (typeof Database !== 'undefined' && Database.TimeSeries) {
      try {
        await Database.TimeSeries.clearData();
        console.log('Time series data cleared using Database API');
        return;
      } catch (dbError) {
        console.error('Error clearing time series data with Database API:', dbError);
        // Fall through to direct IndexedDB if Database API fails
      }
    }
    
    // Fallback to direct IndexedDB
    const db = await openDatabase();
    const tx = db.transaction(['timeSeries'], 'readwrite');
    const store = tx.objectStore('timeSeries');
    await store.clear();
    console.log('Time series data cleared directly from IndexedDB');
  } catch (error) {
    console.error('Error clearing time series data:', error);
  }
}

// Update the stopwatch display
function updateStopwatchDisplay() {
  // If stopwatch is running, update elapsed time from background script
  if (stopwatchRunning) {
    chrome.runtime.sendMessage({ action: 'getStopwatchState' }, function(response) {
      if (response) {
        elapsedTime = response.elapsedTime || 0;
        
        // Format and display the time
        formatAndDisplayTime();
      }
    });
  } else {
    // Just format and display the current elapsed time
    formatAndDisplayTime();
  }
}

// Format and display the time
function formatAndDisplayTime() {
  const hours = Math.floor(elapsedTime / 3600000);
  const minutes = Math.floor((elapsedTime % 3600000) / 60000);
  const seconds = Math.floor((elapsedTime % 60000) / 1000);
  const milliseconds = Math.floor((elapsedTime % 1000) / 10);
  
  updateTimeElement('hours', hours.toString().padStart(2, '0'));
  updateTimeElement('minutes', minutes.toString().padStart(2, '0'));
  updateTimeElement('seconds', seconds.toString().padStart(2, '0'));
  updateTimeElement('milliseconds', milliseconds.toString().padStart(2, '0'));
}

// Update time element with animation
function updateTimeElement(id, newValue) {
  const element = document.getElementById(id);
  if (element && element.textContent !== newValue) {
    // Add a small animation effect
    element.classList.add('updating');
    setTimeout(() => element.classList.remove('updating'), 150);
    element.textContent = newValue;
  } else if (element) {
    element.textContent = newValue;
  }
}

// Update background running indicator
function updateBackgroundIndicator() {
  const indicator = document.getElementById('background-indicator');
  if (indicator) {
    if (stopwatchRunning) {
      indicator.classList.add('running');
    } else {
      indicator.classList.remove('running');
    }
  }
}

// Initialize counters UI
function initializeCounters() {
  renderCounters();
}

// Render counters UI
function renderCounters() {
  const countersContainer = document.getElementById('counters-container');
  countersContainer.innerHTML = '';
  
  if (!counters || counters.length === 0) {
    countersContainer.innerHTML = '<div class="empty-message">No counters yet. Add your first counter below.</div>';
    return;
  }
  
  counters.forEach((counter, index) => {
    const counterElement = document.createElement('div');
    counterElement.className = 'counter-item';
    counterElement.setAttribute('draggable', true);
    counterElement.setAttribute('data-index', index);
    
    counterElement.innerHTML = `
      <div class="drag-handle">⋮⋮</div>
      <span class="counter-name">${counter.name}</span>
      <div class="counter-controls">
        <button class="counter-btn decrement">-</button>
        <span class="counter-value">${counter.value}</span>
        <button class="counter-btn increment">+</button>
        <button class="counter-btn delete">&times;</button>
      </div>
    `;
    
    // Add drag and drop event listeners
    counterElement.addEventListener('dragstart', handleDragStart);
    counterElement.addEventListener('dragover', handleDragOver);
    counterElement.addEventListener('dragenter', handleDragEnter);
    counterElement.addEventListener('dragleave', handleDragLeave);
    counterElement.addEventListener('drop', handleDrop);
    counterElement.addEventListener('dragend', handleDragEnd);
    
    countersContainer.appendChild(counterElement);
  });
}

// Drag and drop handlers
function handleDragStart(e) {
  this.classList.add('drag-in-progress');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.getAttribute('data-index'));
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault(); // Allows us to drop
  }
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter(e) {
  this.classList.add('drag-over');
}

function handleDragLeave(e) {
  this.classList.remove('drag-over');
}

function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation(); // Stops the browser from redirecting
  }
  
  // Get the dragged and drop indices
  const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
  const toIndex = parseInt(this.getAttribute('data-index'));
  
  if (fromIndex !== toIndex) {
    // Reorder counters array
    const [movedItem] = counters.splice(fromIndex, 1);
    counters.splice(toIndex, 0, movedItem);
    
    // Mark data as modified
    dataModified = true;
    
    // Save to database and re-render
    saveData().then(() => {
      renderCounters();
      updateChart();
    });
  }
  
  return false;
}

function handleDragEnd(e) {
  // Remove all drag over classes
  document.querySelectorAll('.counter-item').forEach(item => {
    item.classList.remove('drag-over');
    item.classList.remove('drag-in-progress');
  });
}

// Add a new counter
function addCounter() {
  const nameInput = document.getElementById('counter-name');
  const name = nameInput.value.trim();
  
  if (name) {
    // Create new counter
    const newCounter = { name, value: 0 };
    counters.push(newCounter);
    
    // Mark data as modified
    dataModified = true;
    
    // Clear input
    nameInput.value = '';
    
    // Save and render
    saveData().then(() => {
      renderCounters();
      updateChart();
    });
  } else {
    alert('Please enter a counter name');
  }
}

// Increment a counter and record time series data
async function incrementCounter(index) {
  if (index >= 0 && index < counters.length) {
    counters[index].value++;
    
    // Mark data as modified
    dataModified = true;
    
    // Record the change in time series
    await recordTimeSeriesData(counters[index].name, counters[index].value, 'increment');
    
    // Save and render
    await saveData();
    renderCounters();
    updateChart();
  }
}

// Decrement a counter and record time series data
async function decrementCounter(index) {
  if (index >= 0 && index < counters.length) {
    counters[index].value--;
    
    // Mark data as modified
    dataModified = true;
    
    // Record the change in time series
    await recordTimeSeriesData(counters[index].name, counters[index].value, 'decrement');
    
    // Save and render
    await saveData();
    renderCounters();
    updateChart();
  }
}

// Record time series data when counter changes
async function recordTimeSeriesData(counterName, newValue, action) {
  try {
    // Create time series entry
    const timeSeriesEntry = {
      timestamp: new Date().toISOString(),
      counterName: counterName,
      value: newValue,
      action: action,
      elapsedTime: elapsedTime
    };
    
    // Use Database API if available
    if (typeof Database !== 'undefined' && Database.TimeSeries) {
      try {
        await Database.TimeSeries.saveDataPoint(timeSeriesEntry);
        console.log('Time series data saved using Database API');
        return Promise.resolve();
      } catch (dbError) {
        console.error('Error saving time series with Database API:', dbError);
        // Fall through to direct IndexedDB if Database API fails
      }
    }
    
    // Fallback to direct IndexedDB
    const db = await openDatabase();
    const tx = db.transaction(['timeSeries'], 'readwrite');
    const store = tx.objectStore('timeSeries');
    
    await store.add(timeSeriesEntry);
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.log('Time series data saved directly to IndexedDB');
        resolve();
      };
      tx.onerror = (event) => reject(event.target.error);
    });
  } catch (error) {
    console.error('Error recording time series data:', error);
    return Promise.reject(error);
  }
}

// Delete a counter
function deleteCounter(index) {
  if (confirm(`Are you sure you want to delete the counter "${counters[index].name}"?`)) {
    counters.splice(index, 1);
    
    // Mark data as modified
    dataModified = true;
    
    // Save and render
    saveData().then(() => {
      renderCounters();
      updateChart();
    });
  }
}

// Initialize the chart display
function initializeChartDisplay() {
  const ctx = document.getElementById('counter-chart').getContext('2d');
  
  // Create initial chart
  counterChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        label: 'Counter Values',
        data: [],
        backgroundColor: [
          'rgba(75, 192, 192, 0.7)',
          'rgba(54, 162, 235, 0.7)',
          'rgba(255, 206, 86, 0.7)',
          'rgba(255, 99, 132, 0.7)',
          'rgba(153, 102, 255, 0.7)'
        ],
        borderColor: [
          'rgba(75, 192, 192, 1)',
          'rgba(54, 162, 235, 1)',
          'rgba(255, 206, 86, 1)',
          'rgba(255, 99, 132, 1)',
          'rgba(153, 102, 255, 1)'
        ],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  });
  
  // Initial update
  updateChart();
}

// Update the chart with current counter data
function updateChart() {
  if (!counterChart) return;
  
  const labels = counters.map(counter => counter.name);
  const data = counters.map(counter => counter.value);
  
  counterChart.data.labels = labels;
  counterChart.data.datasets[0].data = data;
  
  // Ensure we have enough colors
  const backgroundColor = [];
  const borderColor = [];
  
  const baseColors = [
    [75, 192, 192],   // Teal
    [54, 162, 235],   // Blue
    [255, 206, 86],   // Yellow
    [255, 99, 132],   // Red
    [153, 102, 255],  // Purple
    [255, 159, 64],   // Orange
    [199, 199, 199],  // Gray
    [83, 102, 255],   // Indigo
    [255, 99, 71],    // Tomato
    [50, 205, 50]     // Lime Green
  ];
  
  for (let i = 0; i < labels.length; i++) {
    const colorIndex = i % baseColors.length;
    const [r, g, b] = baseColors[colorIndex];
    backgroundColor.push(`rgba(${r}, ${g}, ${b}, 0.7)`);
    borderColor.push(`rgba(${r}, ${g}, ${b}, 1)`);
  }
  
  counterChart.data.datasets[0].backgroundColor = backgroundColor;
  counterChart.data.datasets[0].borderColor = borderColor;
  
  counterChart.update();
}

// Change chart type
function changeChartType() {
  const chartType = document.getElementById('chart-type').value;
  
  if (counterChart) {
    counterChart.config.type = chartType;
    counterChart.update();
  }
}

// Show comparison chart (Time vs Counter)
async function showComparisonChart() {
  try {
    let timeSeriesData = [];
    
    // Try to load time series data from Database API first
    if (typeof Database !== 'undefined' && Database.TimeSeries) {
      try {
        timeSeriesData = await Database.TimeSeries.getAllDataPoints();
        console.log('Time series data loaded from Database API');
      } catch (dbError) {
        console.error('Error loading time series data with Database API:', dbError);
        // Fall through to direct IndexedDB if Database API fails
      }
    }
    
    // Fallback to direct IndexedDB if needed or if no data was retrieved
    if (!timeSeriesData || timeSeriesData.length === 0) {
      try {
        const db = await openDatabase();
        const tx = db.transaction(['timeSeries'], 'readonly');
        const store = tx.objectStore('timeSeries');
        timeSeriesData = await store.getAll();
        console.log('Time series data loaded directly from IndexedDB');
      } catch (indexDbError) {
        console.error('Error loading time series data from IndexedDB:', indexDbError);
      }
    }
    
    // Check if we have data to display
    if (!timeSeriesData || timeSeriesData.length === 0) {
      alert('No time series data available. Try incrementing or decrementing your counters to generate data.');
      return;
    }
    
    // Group data by counter name
    const counterData = {};
    
    // Process time series data
    timeSeriesData.forEach(entry => {
      if (!counterData[entry.counterName]) {
        counterData[entry.counterName] = [];
      }
      
      counterData[entry.counterName].push({
        x: entry.elapsedTime, // Use elapsed time for x-axis
        y: entry.value,
        timestamp: new Date(entry.timestamp)
      });
    });
    
    // Sort data points by elapsed time for each counter
    Object.keys(counterData).forEach(counterName => {
      counterData[counterName].sort((a, b) => a.x - b.x);
    });
    
    // Create datasets for chart
    const datasets = [];
    const baseColors = [
      [75, 192, 192],   // Teal
      [54, 162, 235],   // Blue
      [255, 206, 86],   // Yellow
      [255, 99, 132],   // Red
      [153, 102, 255],  // Purple
      [255, 159, 64]    // Orange
    ];
    
    Object.keys(counterData).forEach((counterName, index) => {
      const colorIndex = index % baseColors.length;
      const [r, g, b] = baseColors[colorIndex];
      
      datasets.push({
        label: counterName,
        data: counterData[counterName],
        borderColor: `rgba(${r}, ${g}, ${b}, 1)`,
        backgroundColor: `rgba(${r}, ${g}, ${b}, 0.1)`,
        fill: false,
        tension: 0.1
      });
    });
    
    // Update chart
    if (counterChart) {
      counterChart.destroy();
    }
    
    const ctx = document.getElementById('counter-chart').getContext('2d');
    counterChart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            position: 'bottom',
            title: {
              display: true,
              text: 'Elapsed Time (seconds)'
            },
            ticks: {
              callback: function(value) {
                // Convert milliseconds to seconds for display
                return (value / 1000).toFixed(1) + 's';
              }
            }
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Counter Value'
            }
          }
        },
        plugins: {
          tooltip: {
            callbacks: {
              title: function(tooltipItems) {
                const item = tooltipItems[0];
                const dataPoint = item.raw;
                return `Time: ${formatElapsedTime(dataPoint.x)}`;
              },
              label: function(context) {
                const dataPoint = context.raw;
                return `${context.dataset.label}: ${dataPoint.y}`;
              },
              afterLabel: function(context) {
                const dataPoint = context.raw;
                return `Date: ${dataPoint.timestamp.toLocaleString()}`;
              }
            }
          }
        }
      }
    });
    
  } catch (error) {
    console.error('Error generating comparison chart:', error);
    alert('Error generating comparison chart: ' + error.message);
  }
}

// Format elapsed time for display (HH:MM:SS)
function formatElapsedTime(milliseconds) {
  const hours = Math.floor(milliseconds / 3600000).toString().padStart(2, '0');
  const minutes = Math.floor((milliseconds % 3600000) / 60000).toString().padStart(2, '0');
  const seconds = Math.floor((milliseconds % 60000) / 1000).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

// Function to finish CSV export process
function finishCSVExport(csvContent, modal, box, message, progressFill) {
  // Create a Blob and download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, `stopwatch-counter-export-${new Date().toISOString().split('T')[0]}.csv`);
  
  // Update UI to show completion
  message.textContent = 'Export completed!';
  progressFill.style.width = '100%';
  
  setTimeout(() => {
    modal.remove();
  }, 1500);
}

// Export data to CSV
function exportToCSV() {
  // Create a modal for export progress
  const modal = document.createElement('div');
  modal.style = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  `;
  
  const box = document.createElement('div');
  box.style = `
    background: white;
    padding: 20px;
    border-radius: 10px;
    width: 80%;
    max-width: 400px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  `;
  
  const title = document.createElement('h3');
  title.textContent = 'Exporting Data';
  title.style = 'margin-top: 0; color: #3a86ff;';
  
  const message = document.createElement('p');
  message.textContent = 'Preparing CSV export...';
  
  const progressContainer = document.createElement('div');
  progressContainer.style = `
    width: 100%;
    height: 8px;
    background: #e9ecef;
    border-radius: 4px;
    overflow: hidden;
    margin-top: 15px;
  `;
  
  const progressFill = document.createElement('div');
  progressFill.style = `
    height: 100%;
    width: 0%;
    background: #4cc9be;
    transition: width 0.3s ease;
  `;
  
  progressContainer.appendChild(progressFill);
  box.appendChild(title);
  box.appendChild(message);
  box.appendChild(progressContainer);
  modal.appendChild(box);
  document.body.appendChild(modal);
  
  // Start progress animation
  setTimeout(() => {
    progressFill.style.width = '30%';
  }, 200);
  
  // Build basic CSV data from counters
  let csvContent = 'Counter Name,Value\n';
  counters.forEach(counter => {
    csvContent += `"${counter.name}",${counter.value}\n`;
  });
  
  csvContent += '\nStopwatch Time,' + formatElapsedTime(elapsedTime) + '\n\n';
  
  // Update progress
  setTimeout(() => {
    progressFill.style.width = '60%';
    message.textContent = 'Processing time series data...';
  }, 500);
  
  // Add time series data if available
  // Try to get data through Database API first
  const getTimeSeriesData = async () => {
    let timeSeriesData = [];
    
    try {
      if (typeof Database !== 'undefined' && Database.TimeSeries) {
        try {
          timeSeriesData = await Database.TimeSeries.getAllDataPoints();
          console.log('Time series data for export loaded from Database API');
        } catch (dbError) {
          console.error('Error loading time series data for export with Database API:', dbError);
          // Fall through to direct IndexedDB if Database API fails
        }
      }
      
      // If no data or error with Database API, try direct IndexedDB
      if (!timeSeriesData || timeSeriesData.length === 0) {
        const db = await openDatabase();
        const tx = db.transaction(['timeSeries'], 'readonly');
        const store = tx.objectStore('timeSeries');
        timeSeriesData = await store.getAll();
        console.log('Time series data for export loaded directly from IndexedDB');
      }
      
      if (timeSeriesData && timeSeriesData.length > 0) {
        // Add time series section
        csvContent += '\nTime Series Data\n';
        csvContent += 'Timestamp,Counter Name,Action,Value,Elapsed Time (ms),Elapsed Time (formatted)\n';
        
        const timeSeriesArray = Array.isArray(timeSeriesData) ? timeSeriesData : [timeSeriesData];
        timeSeriesArray.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        timeSeriesArray.forEach(entry => {
          const formattedTime = formatElapsedTime(entry.elapsedTime);
          csvContent += `"${entry.timestamp}","${entry.counterName}","${entry.action}",${entry.value},${entry.elapsedTime},"${formattedTime}"\n`;
        });
      }
      
      // Update progress and complete
      progressFill.style.width = '90%';
      message.textContent = 'Finalizing export...';
      
      setTimeout(() => {
        finishCSVExport(csvContent, modal, box, message, progressFill);
      }, 500);
      
    } catch (error) {
      console.error('Error processing time series data for export:', error);
      message.textContent = 'Error: ' + error.message;
      progressFill.style.backgroundColor = '#ff5a5f';
      
      setTimeout(() => {
        finishCSVExport(csvContent, modal, box, message, progressFill);
      }, 1000);
    }
  };
  
  // Start the data retrieval process
  getTimeSeriesData();
}
