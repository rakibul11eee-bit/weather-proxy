const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// API Configuration
const API_KEYS = [
    process.env.b829ee88a8488d67d0a7ec8a8d7ac618,
    process.env.c6ab8c5ad781aa026691fbeb9814f474,
    process.env.f064dc8746bf8ad507c620b6c5a3c7be,
    process.env.f8910302cae5b18ea9eb016b0f43a1aa
].filter(key => key); // Remove any undefined keys

const DAILY_LIMIT = parseInt(process.env.DAILY_LIMIT) || 900;
const PORT = process.env.PORT || 3000;

// Key rotation and usage tracking
let currentKeyIndex = 0;
let keyUsage = {};
let lastResetDate = new Date().toDateString();

// Initialize usage tracking
function initializeUsage() {
    API_KEYS.forEach((key, index) => {
        keyUsage[index] = 0;
    });
}

// Reset daily usage
function resetDailyUsage() {
    const today = new Date().toDateString();
    if (lastResetDate !== today) {
        console.log('Resetting daily usage counters');
        initializeUsage();
        lastResetDate = today;
    }
}

// Get next available API key
function getNextApiKey() {
    resetDailyUsage();
    
    // Try current key first
    if (keyUsage[currentKeyIndex] < DAILY_LIMIT) {
        return {
            key: API_KEYS[currentKeyIndex],
            index: currentKeyIndex
        };
    }
    
    // Find next available key
    for (let i = 0; i < API_KEYS.length; i++) {
        const testIndex = (currentKeyIndex + i) % API_KEYS.length;
        if (keyUsage[testIndex] < DAILY_LIMIT) {
            currentKeyIndex = testIndex;
            console.log(`Switched to API key ${testIndex + 1}`);
            return {
                key: API_KEYS[testIndex],
                index: testIndex
            };
        }
    }
    
    // All keys exhausted
    return null;
}

// Track API usage
function trackUsage(keyIndex) {
    keyUsage[keyIndex]++;
    console.log(`Key ${keyIndex + 1} usage: ${keyUsage[keyIndex]}/${DAILY_LIMIT}`);
}

// API Routes

// Weather by city name
app.get('/weather', async (req, res) => {
    const { q, lat, lon } = req.query;
    
    const apiKeyData = getNextApiKey();
    if (!apiKeyData) {
        return res.status(429).json({ 
            error: 'All API keys have reached daily limit',
            resetTime: 'Tomorrow at midnight UTC'
        });
    }
    
    try {
        let apiUrl;
        if (lat && lon) {
            apiUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKeyData.key}&units=metric`;
        } else if (q) {
            apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${q}&appid=${apiKeyData.key}&units=metric`;
        } else {
            return res.status(400).json({ error: 'Missing parameters' });
        }
        
        const response = await axios.get(apiUrl);
        trackUsage(apiKeyData.index);
        
        // Add usage info to response
        response.data.apiUsage = {
            keyUsed: apiKeyData.index + 1,
            callsRemaining: DAILY_LIMIT - keyUsage[apiKeyData.index]
        };
        
        res.json(response.data);
        
    } catch (error) {
        console.error('Weather API Error:', error.message);
        
        if (error.response && error.response.status === 429) {
            // Rate limit exceeded, try next key
            const nextKey = getNextApiKey();
            if (nextKey) {
                // Retry with next key
                try {
                    const retryUrl = lat && lon 
                        ? `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${nextKey.key}&units=metric`
                        : `https://api.openweathermap.org/data/2.5/weather?q=${q}&appid=${nextKey.key}&units=metric`;
                    
                    const retryResponse = await axios.get(retryUrl);
                    trackUsage(nextKey.index);
                    
                    retryResponse.data.apiUsage = {
                        keyUsed: nextKey.index + 1,
                        callsRemaining: DAILY_LIMIT - keyUsage[nextKey.index]
                    };
                    
                    res.json(retryResponse.data);
                } catch (retryError) {
                    res.status(429).json({ error: 'All API keys rate limited' });
                }
            } else {
                res.status(429).json({ error: 'All API keys exhausted' });
            }
        } else {
            res.status(500).json({ error: 'Failed to fetch weather data' });
        }
    }
});

// Forecast data
app.get('/forecast', async (req, res) => {
    const { lat, lon } = req.query;
    
    if (!lat || !lon) {
        return res.status(400).json({ error: 'Latitude and longitude required' });
    }
    
    const apiKeyData = getNextApiKey();
    if (!apiKeyData) {
        return res.status(429).json({ 
            error: 'All API keys have reached daily limit',
            resetTime: 'Tomorrow at midnight UTC'
        });
    }
    
    try {
        const apiUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKeyData.key}&units=metric`;
        const response = await axios.get(apiUrl);
        trackUsage(apiKeyData.index);
        
        // Return only first 8 forecasts (24 hours)
        const limitedData = {
            ...response.data,
            list: response.data.list.slice(0, 8),
            apiUsage: {
                keyUsed: apiKeyData.index + 1,
                callsRemaining: DAILY_LIMIT - keyUsage[apiKeyData.index]
            }
        };
        
        res.json(limitedData);
        
    } catch (error) {
        console.error('Forecast API Error:', error.message);
        
        if (error.response && error.response.status === 429) {
            const nextKey = getNextApiKey();
            if (nextKey) {
                try {
                    const retryUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${nextKey.key}&units=metric`;
                    const retryResponse = await axios.get(retryUrl);
                    trackUsage(nextKey.index);
                    
                    const limitedRetryData = {
                        ...retryResponse.data,
                        list: retryResponse.data.list.slice(0, 8),
                        apiUsage: {
                            keyUsed: nextKey.index + 1,
                            callsRemaining: DAILY_LIMIT - keyUsage[nextKey.index]
                        }
                    };
                    
                    res.json(limitedRetryData);
                } catch (retryError) {
                    res.status(429).json({ error: 'All API keys rate limited' });
                }
            } else {
                res.status(429).json({ error: 'All API keys exhausted' });
            }
        } else {
            res.status(500).json({ error: 'Failed to fetch forecast data' });
        }
    }
});

// Reverse geocoding
app.get('/reverse', async (req, res) => {
    const { lat, lon } = req.query;
    
    if (!lat || !lon) {
        return res.status(400).json({ error: 'Latitude and longitude required' });
    }
    
    const apiKeyData = getNextApiKey();
    if (!apiKeyData) {
        return res.status(429).json({ error: 'All API keys exhausted' });
    }
    
    try {
        const apiUrl = `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${apiKeyData.key}`;
        const response = await axios.get(apiUrl);
        trackUsage(apiKeyData.index);
        
        response.data.apiUsage = {
            keyUsed: apiKeyData.index + 1,
            callsRemaining: DAILY_LIMIT - keyUsage[apiKeyData.index]
        };
        
        res.json(response.data);
        
    } catch (error) {
        console.error('Reverse Geocoding Error:', error.message);
        res.status(500).json({ error: 'Failed to get location name' });
    }
});

// API usage status
app.get('/status', (req, res) => {
    resetDailyUsage();
    
    const status = {
        totalKeys: API_KEYS.length,
        dailyLimit: DAILY_LIMIT,
        usage: keyUsage.map((usage, index) => ({
            keyNumber: index + 1,
            callsMade: usage,
            callsRemaining: Math.max(0, DAILY_LIMIT - usage),
            percentageUsed: Math.round((usage / DAILY_LIMIT) * 100)
        })),
        lastReset: lastResetDate,
        serverTime: new Date().toISOString()
    };
    
    res.json(status);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Start server
initializeUsage();
app.listen(PORT, () => {
    console.log(`🌤️ Weather Proxy Server running on port ${PORT}`);
    console.log(`📊 Daily limit per key: ${DAILY_LIMIT} calls`);
    console.log(`🔑 Total API keys: ${API_KEYS.length}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
    console.log(`📈 Status check: http://localhost:${PORT}/status`);
});