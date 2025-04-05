// Background script for Stopwatch Counter Pro Chrome Extension

// Import database functionality
importScripts('database.js');

// Stopwatch state in memory
let stopwatchState = {
  elapsedTime: 0,
  running: false,
  startTime: null,
  timerInterval: null
};

// Function to start the background stopwatch
function startBackgroundStopwatch() {
  if (!stopwatchState.running) {
    console.log('Starting background stopwatch');
    
    // Get the current time
    stopwatchState.startTime = Date.now() - stopwatchState.elapsedTime;
    stopwatchState.running = true;
    
    // Save the state to the database
    updateStopwatchInDatabase();
    
    // Create an interval to update the time
    stopwatchState.timerInterval = setInterval(updateElapsedTime, 100);
  }
}

// Function to stop the background stopwatch
function stopBackgroundStopwatch() {
  if (stopwatchState.running) {
    console.log('Stopping background stopwatch');
    
    // Clear the interval
    clearInterval(stopwatchState.timerInterval);
    stopwatchState.timerInterval = null;
    stopwatchState.running = false;
    
    // Update the time one last time and save
    updateElapsedTime();
    updateStopwatchInDatabase();
  }
}

// Function to reset the background stopwatch
function resetBackgroundStopwatch() {
  console.log('Resetting background stopwatch');
  
  // Clear the interval if running
  if (stopwatchState.timerInterval) {
    clearInterval(stopwatchState.timerInterval);
    stopwatchState.timerInterval = null;
  }
  
  // Reset all values
  stopwatchState.elapsedTime = 0;
  stopwatchState.running = false;
  stopwatchState.startTime = null;
  
  // Save to database
  updateStopwatchInDatabase();
}

// Function to update elapsed time
function updateElapsedTime() {
  if (stopwatchState.running && stopwatchState.startTime) {
    stopwatchState.elapsedTime = Date.now() - stopwatchState.startTime;
    
    // Update database every second to avoid too many writes
    if (stopwatchState.elapsedTime % 1000 < 100) {
      updateStopwatchInDatabase();
    }
  }
}

// Function to save the stopwatch state to the database
async function updateStopwatchInDatabase() {
  try {
    await Database.Stopwatch.saveState({
      id: 'current',
      elapsedTime: stopwatchState.elapsedTime,
      running: stopwatchState.running,
      startTime: stopwatchState.startTime
    });
  } catch (error) {
    console.error('Error saving stopwatch state:', error);
  }
}

// Function to load the stopwatch state from the database
async function loadStopwatchFromDatabase() {
  try {
    const savedState = await Database.Stopwatch.loadState();
    
    if (savedState) {
      stopwatchState.elapsedTime = savedState.elapsedTime || 0;
      stopwatchState.running = savedState.running || false;
      
      // If the stopwatch was running when the browser closed, restart it
      if (stopwatchState.running) {
        stopwatchState.startTime = Date.now() - stopwatchState.elapsedTime;
        stopwatchState.timerInterval = setInterval(updateElapsedTime, 100);
      }
      
      console.log('Loaded stopwatch state:', stopwatchState);
    }
  } catch (error) {
    console.error('Error loading stopwatch state:', error);
  }
}

// Listen for when the extension is installed or updated
chrome.runtime.onInstalled.addListener(async function() {
  console.log('Stopwatch Counter Pro extension installed');
  
  try {
    // Initialize database with default values if needed
    const db = await openDatabase();
    
    // Check if stopwatch data exists, if not initialize it
    const stopwatchData = await Database.Stopwatch.loadState();
    if (!stopwatchData) {
      await Database.Stopwatch.saveState({
        id: 'current',
        elapsedTime: 0,
        running: false,
        startTime: null
      });
    }
    
    // Load the state into memory
    await loadStopwatchFromDatabase();
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  console.log('Received message:', request.action);
  
  // Handle stopwatch actions
  if (request.action === 'getStopwatchState') {
    // Return current state to popup
    sendResponse({
      elapsedTime: stopwatchState.elapsedTime,
      running: stopwatchState.running
    });
  }
  else if (request.action === 'startStopwatch') {
    startBackgroundStopwatch();
    sendResponse({ success: true });
  }
  else if (request.action === 'stopStopwatch') {
    stopBackgroundStopwatch();
    sendResponse({ success: true });
  }
  else if (request.action === 'resetStopwatch') {
    resetBackgroundStopwatch();
    sendResponse({ success: true });
  }
  // Handle data backup if needed
  else if (request.action === 'backup') {
    (async () => {
      try {
        const stopwatchData = await Database.Stopwatch.loadState();
        const counters = await Database.Counters.loadCounters();
        const sessions = await Database.Sessions.loadSessions();
        
        const backupData = {
          timestamp: Date.now(),
          stopwatch: stopwatchData,
          counters: counters,
          sessions: sessions
        };
        
        // Send the backup data to the popup
        sendResponse({ success: true, data: backupData });
      } catch (error) {
        console.error('Error creating backup:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep the message channel open for async response
  }
  
  return true; // Keep the message channel open
});

// Initialize the stopwatch on service worker startup
loadStopwatchFromDatabase();
