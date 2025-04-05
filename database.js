// Database handling for the Stopwatch with Counters Chrome extension
// Using IndexedDB for data persistence

const DB_NAME = 'StopwatchCountersDB';
const DB_VERSION = 2; // Upgraded version to add time series store
const STOPWATCH_STORE = 'stopwatch';
const COUNTERS_STORE = 'counters';
const SESSIONS_STORE = 'sessions';
const TIMESERIES_STORE = 'timeSeries';

// Open database connection
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;
      
      // Create object stores if they don't exist
      if (!db.objectStoreNames.contains(STOPWATCH_STORE)) {
        db.createObjectStore(STOPWATCH_STORE, { keyPath: 'id' });
      }
      
      if (!db.objectStoreNames.contains(COUNTERS_STORE)) {
        db.createObjectStore(COUNTERS_STORE, { keyPath: 'id', autoIncrement: true });
      }
      
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        const sessionsStore = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
        sessionsStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      
      // Add the time series store in version 2
      if (oldVersion < 2 && !db.objectStoreNames.contains(TIMESERIES_STORE)) {
        const timeSeriesStore = db.createObjectStore(TIMESERIES_STORE, { keyPath: 'id', autoIncrement: true });
        // Create indexes for efficient queries
        timeSeriesStore.createIndex('counterName', 'counterName', { unique: false });
        timeSeriesStore.createIndex('timestamp', 'timestamp', { unique: false });
        timeSeriesStore.createIndex('elapsedTime', 'elapsedTime', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      console.error('Database error:', event.target.error);
      reject(event.target.error);
    };
  });
}

// Stopwatch operations
const StopwatchDB = {
  // Save stopwatch state
  saveState: async (stopwatchData) => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([STOPWATCH_STORE], 'readwrite');
      const store = transaction.objectStore(STOPWATCH_STORE);
      
      // Always use the same ID for the stopwatch state
      stopwatchData.id = 'current';
      
      // Add or update the stopwatch state
      store.put(stopwatchData);
      
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = (event) => reject(event.target.error);
      });
    } catch (error) {
      console.error('Error saving stopwatch state:', error);
      return false;
    }
  },

  // Load stopwatch state
  loadState: async () => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([STOPWATCH_STORE], 'readonly');
      const store = transaction.objectStore(STOPWATCH_STORE);
      
      const request = store.get('current');
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = (event) => reject(event.target.error);
      });
    } catch (error) {
      console.error('Error loading stopwatch state:', error);
      return null;
    }
  }
};

// Counters operations
const CountersDB = {
  // Save a counter
  saveCounter: async (counter) => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([COUNTERS_STORE], 'readwrite');
      const store = transaction.objectStore(COUNTERS_STORE);
      
      // Add or update the counter
      const request = counter.id ? store.put(counter) : store.add(counter);
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
      });
    } catch (error) {
      console.error('Error saving counter:', error);
      return null;
    }
  },

  // Save multiple counters
  saveCounters: async (counters) => {
    try {
      const db = await openDatabase();
      
      // First clear existing counters
      const clearTx = db.transaction([COUNTERS_STORE], 'readwrite');
      const clearStore = clearTx.objectStore(COUNTERS_STORE);
      await clearStore.clear();
      
      // Wait for clear operation to complete
      await new Promise((resolve, reject) => {
        clearTx.oncomplete = () => resolve();
        clearTx.onerror = (event) => reject(event.target.error);
      });
      
      // Then add new counters in a separate transaction
      const addTx = db.transaction([COUNTERS_STORE], 'readwrite');
      const addStore = addTx.objectStore(COUNTERS_STORE);
      
      // Add all counters one by one
      if (counters && counters.length > 0) {
        for (const counter of counters) {
          addStore.add(counter);
        }
      }
      
      return new Promise((resolve, reject) => {
        addTx.oncomplete = () => {
          console.log('All counters saved successfully');
          resolve(true);
        };
        addTx.onerror = (event) => {
          console.error('Error in transaction:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error('Error saving counters:', error);
      return false;
    }
  },

  // Load all counters
  loadCounters: async () => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([COUNTERS_STORE], 'readonly');
      const store = transaction.objectStore(COUNTERS_STORE);
      
      const request = store.getAll();
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (event) => reject(event.target.error);
      });
    } catch (error) {
      console.error('Error loading counters:', error);
      return [];
    }
  },

  // Delete a counter
  deleteCounter: async (counterId) => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([COUNTERS_STORE], 'readwrite');
      const store = transaction.objectStore(COUNTERS_STORE);
      
      store.delete(counterId);
      
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = (event) => reject(event.target.error);
      });
    } catch (error) {
      console.error('Error deleting counter:', error);
      return false;
    }
  }
};

// Session operations (for historical data)
const SessionsDB = {
  // Save a session (complete stopwatch and counter state at a point in time)
  saveSession: async (sessionData) => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([SESSIONS_STORE], 'readwrite');
      const store = transaction.objectStore(SESSIONS_STORE);
      
      // Add timestamp if not present
      if (!sessionData.timestamp) {
        sessionData.timestamp = Date.now();
      }
      
      const request = store.add(sessionData);
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
      });
    } catch (error) {
      console.error('Error saving session:', error);
      return null;
    }
  },

  // Load all sessions
  loadSessions: async () => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([SESSIONS_STORE], 'readonly');
      const store = transaction.objectStore(SESSIONS_STORE);
      const index = store.index('timestamp');
      
      const request = index.getAll();
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (event) => reject(event.target.error);
      });
    } catch (error) {
      console.error('Error loading sessions:', error);
      return [];
    }
  },

  // Get a specific session
  getSession: async (sessionId) => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([SESSIONS_STORE], 'readonly');
      const store = transaction.objectStore(SESSIONS_STORE);
      
      const request = store.get(sessionId);
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = (event) => reject(event.target.error);
      });
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    }
  },

  // Delete a session
  deleteSession: async (sessionId) => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([SESSIONS_STORE], 'readwrite');
      const store = transaction.objectStore(SESSIONS_STORE);
      
      store.delete(sessionId);
      
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = (event) => reject(event.target.error);
      });
    } catch (error) {
      console.error('Error deleting session:', error);
      return false;
    }
  }
};

// Time Series operations for tracking counter changes over time
const TimeSeriesDB = {
  // Save a data point for time series
  saveDataPoint: async (dataPoint) => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([TIMESERIES_STORE], 'readwrite');
      const store = transaction.objectStore(TIMESERIES_STORE);
      
      // Add timestamp if not present
      if (!dataPoint.timestamp) {
        dataPoint.timestamp = Date.now();
      }
      
      const request = store.add(dataPoint);
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
      });
    } catch (error) {
      console.error('Error saving time series data point:', error);
      return null;
    }
  },
  
  // Get all data points for a counter
  getDataPointsByCounter: async (counterName) => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([TIMESERIES_STORE], 'readonly');
      const store = transaction.objectStore(TIMESERIES_STORE);
      const index = store.index('counterName');
      
      const request = index.getAll(IDBKeyRange.only(counterName));
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (event) => reject(event.target.error);
      });
    } catch (error) {
      console.error('Error getting time series data points:', error);
      return [];
    }
  },
  
  // Get all data points for the current session
  getAllDataPoints: async () => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([TIMESERIES_STORE], 'readonly');
      const store = transaction.objectStore(TIMESERIES_STORE);
      const index = store.index('timestamp');
      
      const request = index.getAll();
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          // Sort by elapsedTime to ensure chronological order
          const results = request.result || [];
          results.sort((a, b) => a.elapsedTime - b.elapsedTime);
          resolve(results);
        };
        request.onerror = (event) => reject(event.target.error);
      });
    } catch (error) {
      console.error('Error getting all time series data points:', error);
      return [];
    }
  },
  
  // Clear time series data
  clearData: async () => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([TIMESERIES_STORE], 'readwrite');
      const store = transaction.objectStore(TIMESERIES_STORE);
      
      store.clear();
      
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = (event) => reject(event.target.error);
      });
    } catch (error) {
      console.error('Error clearing time series data:', error);
      return false;
    }
  }
};

// Export the database operations
const Database = {
  Stopwatch: StopwatchDB,
  Counters: CountersDB,
  Sessions: SessionsDB,
  TimeSeries: TimeSeriesDB
};
