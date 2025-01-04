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
app.use(express.json());

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
  const client = new MongoClient(uri);
  let db;
  let feedbackCollection;

  async function connectToMongo() {
    try {
      console.log('Attempting to connect to MongoDB...');
      await client.connect();
      console.log('Connected to MongoDB successfully');
      db = client.db('feedback');
      feedbackCollection = db.collection('feedback-data');
    } catch (error) {
      console.error('MongoDB connection error:', error);
    }
  }

  connectToMongo();

  // Feedback POST route
  app.post('/feedback', async (req, res) => {
    try {
      const { userMessage, botResponse, feedback, rating, userId, userName } = req.body;

      if (!userMessage || !botResponse || !feedback || !rating || !userId || !userName) {
        return res.status(400).json({
          message: 'Missing required fields',
          required: ['userMessage', 'botResponse', 'feedback', 'rating', 'userId', 'userName']
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

      await feedbackCollection.insertOne(newFeedback);
      res.status(201).json({ message: 'Feedback saved successfully', data: newFeedback });
    } catch (error) {
      console.error('Error saving feedback:', error);
      res.status(500).json({ message: 'Error saving feedback', error: error.message });
    }
  });

  // Feedback GET route
  app.get('/feedback', async (req, res) => {
    try {
      const feedback = await feedbackCollection.find({}).toArray();
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
