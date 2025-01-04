const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Create Express app
const app = express();

// Log startup information
console.log('Starting server...');
console.log('Node.js Version:', process.version);
console.log('Environment:', process.env.NODE_ENV);
console.log('Azure Website Name:', process.env.WEBSITE_SITE_NAME || 'Not running in Azure');

// Basic middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
// Body parser setup
app.use(express.text({
  type: ['text/plain', 'application/json']
}));

// Custom middleware to handle Copilot Studio format
app.use((req, res, next) => {
  if (req.method === 'POST' && req.body) {
    console.log('Received body:', req.body);
    try {
      // Remove any BOM and whitespace
      const cleanBody = req.body.trim().replace(/^\uFEFF/, '');
      
      // Handle Copilot Studio format
      if (cleanBody.startsWith('={')) {
        const jsonPart = cleanBody.slice(2);
        console.log('Extracted JSON part:', jsonPart);
        req.body = JSON.parse(jsonPart);
      } else {
        // Regular JSON
        req.body = JSON.parse(cleanBody);
      }
      console.log('Parsed body:', req.body);
    } catch (e) {
      console.error('Parse error:', e);
      return res.status(400).json({
        message: 'Parse error',
        error: e.message,
        receivedBody: req.body
      });
    }
  }
  next();
});

// Health check endpoint that doesn't depend on MongoDB
app.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    message: 'The server is running!',
    version: process.version,
    environment: process.env.NODE_ENV || 'development',
    azure: {
      website: process.env.WEBSITE_SITE_NAME || 'not in azure',
      instance: process.env.WEBSITE_INSTANCE_ID || 'not available'
    }
  });
});

// MongoDB setup
const uri = process.env.MONGODB_URI;
if (uri) {
  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });

  let db;
  let feedbackCollection;
  let isConnected = false;

  async function connectToMongo() {
    try {
      console.log('Attempting to connect to MongoDB...');
      await client.connect();
      console.log('Connected to MongoDB successfully');
      db = client.db('feedback');
      feedbackCollection = db.collection('feedback-data');
      isConnected = true;
    } catch (error) {
      console.error('MongoDB connection error:', error);
      isConnected = false;
    }
  }

  // Initial connection
  connectToMongo();

  // Middleware to ensure MongoDB is connected
  app.use(async (req, res, next) => {
    if (!isConnected) {
      try {
        await connectToMongo();
        if (!isConnected) {
          return res.status(503).json({ 
            message: 'Database connection unavailable',
            error: 'Please try again in a few moments'
          });
        }
      } catch (error) {
        return res.status(503).json({ 
          message: 'Database connection error',
          error: error.message
        });
      }
    }
    next();
  });

  // Feedback POST route
  app.post('/feedback', async (req, res) => {
    try {
      // Body is already parsed in middleware
      const parsedBody = req.body;

      // Function to recursively search for a value in an object
      function findValueInObject(obj, keys) {
        if (!obj || typeof obj !== 'object') return null;
        
        // Try direct matches first
        for (const key of keys) {
          if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
            return obj[key];
          }
        }
        
        // Search in nested objects
        for (const value of Object.values(obj)) {
          if (typeof value === 'object') {
            const found = findValueInObject(value, keys);
            if (found) return found;
          }
        }
        
        return null;
      }

      // Define possible keys for each field
      const fieldKeys = {
        userMessage: ['userMessage', 'text', 'query', 'message', 'input'],
        botResponse: ['botResponse', 'lastBotResponse', 'response', 'answer', 'output'],
        feedback: ['feedback', 'userFeedback', 'comment', 'text'],
        rating: ['rating', 'score', 'stars', 'value'],
        userId: ['userId', 'conversationId', 'id', 'user_id', 'from.id'],
        userName: ['userName', 'user', 'name', 'from.name']
      };

      // Extract values using the recursive search from parsed body
      const userMessage = findValueInObject(parsedBody, fieldKeys.userMessage) || '';
      const botResponse = findValueInObject(parsedBody, fieldKeys.botResponse) || '';
      const feedback = findValueInObject(parsedBody, fieldKeys.feedback) || '';
      const rating = findValueInObject(parsedBody, fieldKeys.rating) || '';
      const userId = findValueInObject(parsedBody, fieldKeys.userId) || '';
      const userName = findValueInObject(parsedBody, fieldKeys.userName) || 'anonymous';

      // Log individual fields for debugging
      console.log('Extracted fields:', {
        userMessage,
        botResponse,
        feedback,
        rating,
        userId,
        userName
      });

      // Validate required fields
      const missingFields = [];
      if (!botResponse) missingFields.push('botResponse');
      if (!feedback) missingFields.push('feedback');
      if (!rating) missingFields.push('rating');
      if (!userMessage) missingFields.push('userMessage');
      if (!userId) missingFields.push('userId');

      if (missingFields.length > 0) {
        return res.status(400).json({
          message: 'Missing required fields',
          message: 'Missing required fields',
          missingFields,
          receivedBody: req.body,
          parsedBody: parsedBody,
          extractedFields: {
            userMessage,
            botResponse,
            feedback,
            rating,
            userId,
            userName
          }
        });
      }

      const newFeedback = {
        userMessage,
        botResponse,
        feedback,
        rating: parseInt(rating),
        userId,
        userName,
        createdAt: new Date().toISOString(),
      };

      await feedbackCollection.insertOne(newFeedback, { maxTimeMS: 5000 });
      res.status(201).json({ message: 'Feedback saved successfully', data: newFeedback });
    } catch (error) {
      console.error('Error saving feedback:', error);
      res.status(500).json({ message: 'Error saving feedback', error: error.message });
    }
  });

  // Feedback GET route
  app.get('/feedback', async (req, res) => {
    try {
      const feedback = await feedbackCollection.find({}).maxTimeMS(5000).toArray();
      res.json(feedback);
    } catch (error) {
      console.error('Error retrieving feedback:', error);
      res.status(500).json({ message: 'Error retrieving feedback', error: error.message });
    }
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error', error: err.message });
});

// Start the server
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
